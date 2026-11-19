// An export's scratch files, and the sweep of the ones a dead export left. An export never writes the file at --out:
// it writes a partial beside it (`<name>.partial-<pid>-<ms><ext>`, the extension kept so ffmpeg picks the container)
// and renames it onto --out only once it is finished, so a failed, cancelled or killed export leaves the previous file
// as it was. Spool and frame folders in the temp folder are named the same way (`reel-spool-<pid>-<ms>`,
// `reel-webp-<pid>-<ms>`). On SIGINT or SIGTERM the export removes its scratch itself; a SIGKILL leaves it, and the
// next export (or `reel daemon stop --all`) sweeps every scratch name whose process is gone. The name says which
// process made it: one whose pid is dead, or now belongs to a program other than bun (the pid reused), is gone. (The
// <ms> only keeps names unique: a start time compared with it misreads a live export as gone after a clock step.)
import { chmodSync, lstatSync, readdirSync, readlinkSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { alive } from './exports';

let last = 0;
/** A moment for a scratch name: now, and never the same twice in this process (it keeps names unique). */
const stamp = () => (last = Math.max(Date.now(), last + 1));

/** The partial an output is written to: beside it, with its extension (a folder of frames: no extension needed). */
export function partialOf(file: string): string {
  const ext = path.extname(file), stem = ext ? file.slice(0, -ext.length) : file;
  return `${stem}.partial-${process.pid}-${stamp()}${ext}`;
}

/** A scratch folder's path in `dir`: `<prefix>-<pid>-<ms>`. */
export const scratchDir = (dir: string, prefix: string) => path.join(dir, `${prefix}-${process.pid}-${stamp()}`);

/**
 * The file an output really is: a symlink's target, followed even when it is missing (renamed onto, the link would
 * become a plain file), else itself.
 */
export function destOf(file: string, depth = 0): string {
  try {
    return depth < 16 && lstatSync(file).isSymbolicLink() ? destOf(path.resolve(path.dirname(file), readlinkSync(file)), depth + 1) : file;
  } catch { return file; }
}

/**
 * Put a finished partial in place of `file`, with the old file's permissions: one rename, so a reader sees the old
 * file or the new one, never half. (A new file: other hard links to the old one keep the old render.)
 */
export function commit(partial: string, file: string) {
  try { chmodSync(partial, statSync(file).mode & 0o7777); } catch {}
  renameSync(partial, file);
}

/**
 * Move the frames in the folder `from` into `to` (a frame of the same name replaced), then remove `from`. Each move
 * is a rename, so a frame in `to` is always a whole one.
 */
export function commitFrames(from: string, to: string) {
  for (const n of readdirSync(from)) renameSync(path.join(from, n), path.join(to, n));
  rmSync(from, { recursive: true, force: true });
}

const aborts = new Set<() => void>();
const SIGNALS = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;
const onSignal = (sig: NodeJS.Signals) => {
  for (const f of [...aborts]) { try { f(); } catch {} }
  process.exit(SIGNALS[sig as keyof typeof SIGNALS] ?? 130);
};
/**
 * Run `f` if the process is stopped by SIGINT, SIGTERM or SIGHUP (Ctrl-C, the MCP's video_cancel, a closed terminal), then exit
 * 128 + the signal's number, as the signal would have.
 * Returns the unregister. Several exports' cleanups share one handler, so each one runs.
 */
export function onAbort(f: () => void): () => void {
  if (!aborts.size) for (const s of Object.keys(SIGNALS)) process.on(s, onSignal);
  aborts.add(f);
  return () => {
    aborts.delete(f);
    if (!aborts.size) for (const s of Object.keys(SIGNALS)) process.off(s, onSignal);
  };
}

/**
 * A scratch name's owner, when the name is one: `<stem>.partial-<pid>-<ms>[.<ext>]`, `reel-spool-<pid>-<ms>`,
 * `reel-webp-<pid>-<ms>` (anchored: a name another program made is very unlikely to be one).
 */
export function ownerOf(name: string): { pid: number } | null {
  const m = /^(?:reel-(?:spool|webp)|.+\.partial)-(\d+)-\d{13}(?:\.[A-Za-z0-9]+)?$/.exec(name);
  return m ? { pid: +m[1]! } : null;
}

/** The program a process runs (`ps -o comm`, its file name), or null when that cannot be read. */
export function processName(pid: number): string | null {
  try {
    const p = Bun.spawnSync(['ps', '-o', 'comm=', '-p', String(pid)], { stderr: 'ignore' });
    const s = p.stdout.toString().trim();
    return p.exitCode === 0 && s ? path.basename(s) : null;
  } catch { return null; }
}

/**
 * The process that made a scratch name is gone: dead, or its pid now runs a program other than bun (reused). No
 * clock is compared, so a clock step (a VM resumed) never makes a live export look gone; a pid reused by another bun
 * keeps the scratch until that one exits. A name that cannot be read counts as alive.
 */
export function ownerGone(o: { pid: number }, name: (pid: number) => string | null = processName): boolean {
  if (!alive(o.pid)) return true;
  const n = name(o.pid);
  return n !== null && !/^bun/i.test(n);
}

/** Vite's optimizer folders (`deps_temp_<hash>`) are renamed into place within seconds; one this old is a dead server's. */
const VITE_TEMP_AGE = 3600_000;

/**
 * Remove the scratch that dead exports left in `dirs` (partials beside outputs, spool and frame folders in the temp
 * folder), and with `viteCache` Vite's optimizer folders under it that are over an hour old (they hold no owner; Vite
 * renames a live one into place within seconds, and sweeps its own only after a day). Returns what it removed.
 */
export function sweep(dirs: string[], viteCache?: string): string[] {
  const removed: string[] = [];
  const gone = new Map<string, boolean>();
  for (const dir of new Set(dirs)) {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const o = ownerOf(n);
      if (!o) continue;
      const k = String(o.pid);
      if (!gone.has(k)) gone.set(k, ownerGone(o));
      if (!gone.get(k)) continue;
      const f = path.join(dir, n);
      try { rmSync(f, { recursive: true, force: true }); removed.push(f); } catch {}
    }
  }
  if (viteCache) {
    let names: string[] = [];
    try { names = readdirSync(viteCache); } catch {}
    for (const n of names.filter((x) => x.includes('_temp_'))) {
      const f = path.join(viteCache, n);
      try {
        if (Date.now() - statSync(f).mtimeMs < VITE_TEMP_AGE) continue;
        rmSync(f, { recursive: true, force: true });
        removed.push(f);
      } catch {}
    }
  }
  return removed;
}
