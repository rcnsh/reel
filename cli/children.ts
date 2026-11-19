// Child processes that cannot outlive reel. A process killed by a signal it does not handle (SIGALRM from a
// `perl -e 'alarm N; exec …'` time limit, SIGQUIT, SIGKILL) runs no cleanup of its own, and macOS has no
// parent-death signal, so its ffmpeg (or uv and the Python under it) kept running, ignoring a later SIGTERM mid-graph.
//
// Each child is registered with a watchdog: one `/bin/sh` per reel process, in a process group of its own (so a
// Ctrl-C to reel's group does not end it first), reading "+<pid>" and "-<pid>" lines from a pipe whose only writer
// is reel. When reel ends, however it ends, the kernel closes that pipe; the watchdog sends SIGTERM to every child
// still registered and everything under it (uv's Python, the Python's own subprocesses), waits up to KILL_AFTER_S
// for them to go, then sends SIGKILL. Children stay in reel's process group, so the terminal's Ctrl-C and Ctrl-Z
// reach them as before.
import type { SpawnOptions, Subprocess } from 'bun';

const KILL_AFTER_S = 1.5;
// (POSIX sh: dash, /bin/sh on Debian, takes no `--` after kill's signal)
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
/** Started before the first child, so no child exists without one. */
function startWatchdog() {
  if (watchdog) return;
  watchdog = Bun.spawn(['/bin/sh', '-c', WATCHDOG], { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore', detached: true });
  // (it must not keep reel's event loop alive: reel's exit is what it waits for)
  watchdog.unref();
  watchdog.stdin.unref();
}
function tell(line: string) {
  try { watchdog?.stdin.write(`${line}\n`); watchdog?.stdin.flush(); } catch {}
}

/** `Bun.spawn` for a child that is killed, with everything under it, when reel ends, however reel ends. */
export function spawnChild<const In extends SpawnOptions.Writable = 'ignore', const Out extends SpawnOptions.Readable = 'pipe', const Err extends SpawnOptions.Readable = 'inherit'>(cmd: string[], opts: SpawnOptions.SpawnOptions<In, Out, Err> = {}): Subprocess<In, Out, Err> {
  startWatchdog();
  const p = Bun.spawn(cmd, opts);
  tell(`+${p.pid}`);
  void p.exited.then(() => tell(`-${p.pid}`));
  return p;
}

/**
 * Run a command to completion with `spawnChild`: its exit code, stdout (unless `stdout: 'inherit'`) and stderr,
 * which is also shown as it comes unless `quiet`. Throws on a non-zero exit unless `nothrow`
 * (then a command that is not there exits 127, as in a shell).
 */
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
  // (the end of stderr goes in the error unless it was just shown)
  if (exitCode !== 0 && !o.nothrow) throw new Error(`${cmd[0]} exited with code ${exitCode}${stderr && o.quiet ? `: ${stderr.trim().slice(-1500)}` : ''}`);
  return { exitCode, stdout: new Uint8Array(stdout), text: () => new TextDecoder().decode(stdout), stderr };
}
