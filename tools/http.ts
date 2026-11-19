// Requests to hosted services (voices in tools/voices/, asset providers in tools/providers/): one line per HTTP
// error, and retries for what a later attempt can fix.

export interface HttpEnv {
  env: Record<string, string | undefined>;
  /** fetch, replaceable in tests. */
  fetch: typeof fetch;
  /** The wait between retries (default a timer), replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** An HTTP error from a hosted service as one line, with the service's message. */
export async function httpError(service: string, r: Response): Promise<Error> {
  const body = (await r.text().catch(() => '')).slice(0, 400);
  return new Error(`${service}: HTTP ${r.status}${body ? `: ${body}` : ''}`);
}

/** Attempts per request, and the longest wait between them (a service asking for longer fails at once). */
export const RETRY = { tries: 5, maxWaitMs: 60_000 };

/**
 * A request to a hosted service and its body, `read` from the response (r.json(), r.arrayBuffer()), retrying what
 * a later attempt can fix: HTTP 429, 5xx and network errors before an answer. Each retry waits for the service's
 * Retry-After when it sends one, else 1, 2, 4, 8 s. Any other status, a Retry-After longer than RETRY.maxWaitMs,
 * or the last failure throws as one line. Once a request has succeeded it is never sent again (it was billed),
 * so a body that fails to read throws.
 */
export async function fetchRetry<T>(service: string, ctx: Pick<HttpEnv, 'fetch' | 'sleep'>, url: string, init: RequestInit, read: (r: Response) => Promise<T>): Promise<T> {
  const sleep = ctx.sleep ?? ((ms: number) => Bun.sleep(ms));
  for (let attempt = 1; ; attempt++) {
    const last = attempt >= RETRY.tries;
    let res: Response;
    try { res = await ctx.fetch(url, init); } catch (e) {
      if (last) throw new Error(`${service}: ${(e as Error).message} (after ${attempt} attempts)`);
      await sleep(backoff(attempt));
      continue;
    }
    if (res.ok) {
      try { return await read(res); } catch (e) { throw new Error(`${service}: the response could not be read: ${(e as Error).message}`); }
    }
    if ((res.status !== 429 && res.status < 500) || last) throw await httpError(service, res);
    const wait = retryAfter(res.headers.get('retry-after')) ?? backoff(attempt);
    if (wait > RETRY.maxWaitMs) throw new Error(`${(await httpError(service, res)).message} (it asks to wait ${Math.round(wait / 1000)} s: try again later)`);
    await res.body?.cancel().catch(() => {});
    await sleep(wait);
  }
}

const backoff = (attempt: number) => 1000 * 2 ** (attempt - 1);

/** A Retry-After header (seconds, or an HTTP date) in ms; undefined when absent or unreadable. */
export function retryAfter(h: string | null, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const ms = /^\s*\d+(\.\d+)?\s*$/.test(h) ? Number(h) * 1000 : Date.parse(h) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}
