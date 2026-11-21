import type { SpawnOptions, Subprocess } from 'bun';

const KILL_AFTER_S = 1.5;
const WATCHDOG = `trap '' INT TERM HUP QUIT ALRM PIPE
ids=' '
while IFS= read -r l; do
  case $l in
    +*) ids="$ids\${l#+} " ;;
    -*) n=' '; for p in $ids; do [ "$p" = "\${l#-}" ] || n="$n$p "; done; ids=$n ;;
  esac
done
[ "$ids" = ' ' ] && exit 0
tree() { for c in $(pgrep -P "$1"); do tree "$c"; done; echo "$1"; }
all=; for p in $ids; do all="$all $(tree "$p")"; done
kill -TERM $all 2>/dev/null
i=0
while [ $i -lt ${Math.round(KILL_AFTER_S * 10)} ]; do
  up=; for p in $all; do kill -0 "$p" 2>/dev/null && up=1; done
  [ -z "$up" ] && exit 0
  sleep 0.1; i=$((i + 1))
done
kill -KILL $all 2>/dev/null`;

let watchdog: Subprocess<'pipe', 'ignore', 'ignore'> | null = null;
function startWatchdog() {
  if (watchdog) return;
  watchdog = Bun.spawn(['/bin/sh', '-c', WATCHDOG], { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore', detached: true });
  watchdog.unref();
  watchdog.stdin.unref();
}
function tell(line: string) {
  try { watchdog?.stdin.write(`${line}\n`); watchdog?.stdin.flush(); } catch {}
}

export function spawnChild<const In extends SpawnOptions.Writable = 'ignore', const Out extends SpawnOptions.Readable = 'pipe', const Err extends SpawnOptions.Readable = 'inherit'>(cmd: string[], opts: SpawnOptions.SpawnOptions<In, Out, Err> = {}): Subprocess<In, Out, Err> {
  startWatchdog();
  const p = Bun.spawn(cmd, opts);
  tell(`+${p.pid}`);
  void p.exited.then(() => tell(`-${p.pid}`));
  return p;
}

export async function run(cmd: string[], o: { quiet?: boolean; nothrow?: boolean; stdout?: 'pipe' | 'inherit'; env?: Record<string, string | undefined> } = {}) {
  let p;
  try { p = spawnChild(cmd, { stdout: o.stdout ?? 'pipe', stderr: 'pipe', env: o.env }); } catch (e) {
    if (!o.nothrow) throw e;
    return { exitCode: 127, stdout: new Uint8Array(0), text: () => '', stderr: `${cmd[0]}: ${(e as Error).message}` };
  }
  const dec = new TextDecoder();
  const err = (async () => {
    let s = '';
    for await (const c of p.stderr) { if (!o.quiet) process.stderr.write(c); s = (s + dec.decode(c, { stream: true })).slice(-65536); }
    return s;
  })();
  const [stdout, stderr, exitCode] = await Promise.all([p.stdout ? new Response(p.stdout).arrayBuffer() : new ArrayBuffer(0), err, p.exited]);
  if (exitCode !== 0 && !o.nothrow) throw new Error(`${cmd[0]} exited with code ${exitCode}${stderr && o.quiet ? `: ${stderr.trim().slice(-1500)}` : ''}`);
  return { exitCode, stdout: new Uint8Array(stdout), text: () => new TextDecoder().decode(stdout), stderr };
}
