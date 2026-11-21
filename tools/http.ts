
export interface HttpEnv {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export async function httpError(service: string, r: Response): Promise<Error> {
  const body = (await r.text().catch(() => '')).slice(0, 400);
  return new Error(`${service}: HTTP ${r.status}${body ? `: ${body}` : ''}`);
}

export const RETRY = { tries: 5, maxWaitMs: 60_000 };

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

export function retryAfter(h: string | null, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const ms = /^\s*\d+(\.\d+)?\s*$/.test(h) ? Number(h) * 1000 : Date.parse(h) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}
