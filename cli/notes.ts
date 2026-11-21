import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type NoteStatus = 'open' | 'done';
export interface Rect { x: number; y: number; w: number; h: number }
export interface Note {
  id: string;
  t: number;
  frame: number;
  clips: string[];
  text: string;
  rect?: Rect;
  status: NoteStatus;
  render: { file: string; mtime: string; draft?: boolean } | null;
  created: string;
  updated: string;
}
export interface NotesFile { notes: Note[] }

export class NotesError extends Error {}

export const notesPath = (project: string) => path.join(project, 'review', 'notes.json');

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function noteProblem(n: any): string | null {
  if (!n || typeof n !== 'object') return 'not an object';
  if (typeof n.id !== 'string' || !n.id) return 'no id';
  if (!isNum(n.t) || n.t < 0) return `t ${JSON.stringify(n.t)} is not seconds`;
  if (!Number.isInteger(n.frame) || n.frame < 0) return `frame ${JSON.stringify(n.frame)} is not a frame number`;
  if (!Array.isArray(n.clips) || !n.clips.every((c: unknown) => typeof c === 'string')) return 'clips is not a list of clip ids';
  if (typeof n.text !== 'string') return 'text is not a string';
  if (n.status !== 'open' && n.status !== 'done') return `status ${JSON.stringify(n.status)} is not open or done`;
  if (n.rect !== undefined && n.rect !== null && !(isNum(n.rect.x) && isNum(n.rect.y) && isNum(n.rect.w) && isNum(n.rect.h) && n.rect.w >= 0 && n.rect.h >= 0)) return 'rect is not { x, y, w, h } in px';
  return null;
}

export function readNotes(project: string): Note[] {
  const file = notesPath(project);
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf8');
  if (!raw.trim()) return [];
  let data: any;
  try { data = JSON.parse(raw); } catch (e) { throw new NotesError(`${file} is not valid JSON (${(e as Error).message}): fix or remove it; reel will not overwrite it`); }
  if (!data || !Array.isArray(data.notes)) throw new NotesError(`${file} has no "notes" list: expected { "notes": [ … ] }; reel will not overwrite it`);
  const seen = new Set<string>();
  data.notes.forEach((n: any, i: number) => {
    const p = noteProblem(n);
    if (p) throw new NotesError(`${file}: note ${i + 1}${typeof n?.id === 'string' ? ` (${n.id})` : ''}: ${p}; reel will not overwrite the file`);
    if (seen.has(n.id)) throw new NotesError(`${file}: two notes have the id ${n.id}; reel will not overwrite the file`);
    seen.add(n.id);
  });
  return data.notes as Note[];
}

const byTime = (a: Note, b: Note) => a.t - b.t || a.created.localeCompare(b.created);

const nap = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function locked<T>(project: string, f: () => T): T {
  const lock = path.join(project, 'review', '.notes.lock');
  mkdirSync(path.dirname(lock), { recursive: true });
  for (let i = 0; ; i++) {
    try { closeSync(openSync(lock, 'wx')); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > 10_000) { rmSync(lock, { force: true }); continue; } } catch { continue; }
      if (i > 400) throw new NotesError(`${lock} has been held for over 4 s: another reel is changing the notes, or remove the file`);
      nap(10);
    }
  }
  try { return f(); } finally { rmSync(lock, { force: true }); }
}

export function updateNotes(project: string, edit: (notes: Note[]) => void): Note[] {
  return locked(project, () => {
    const notes = readNotes(project);
    edit(notes);
    notes.sort(byTime);
    const file = notesPath(project), tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ notes } satisfies NotesFile, null, 2) + '\n');
    renameSync(tmp, file);
    return notes;
  });
}

export function newId(notes: Note[], rand: () => number = Math.random): string {
  const taken = new Set(notes.map((n) => n.id));
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (let len = 4; ; len++) {
    for (let k = 0; k < 50; k++) {
      let id = '';
      for (let i = 0; i < len; i++) id += abc[Math.floor(rand() * abc.length)];
      if (!taken.has(id)) return id;
    }
  }
}

export interface NewNote { t: number; frame: number; clips: string[]; text: string; rect?: Rect | null; status?: NoteStatus; render: Note['render'] }

const round = (x: number, d = 6) => +x.toFixed(d);
const cleanRect = (r: Rect | null | undefined): Rect | undefined => (r ? { x: round(r.x, 1), y: round(r.y, 1), w: round(r.w, 1), h: round(r.h, 1) } : undefined);

export function addNote(project: string, n: NewNote, now = new Date()): Note {
  if (!n.text.trim()) throw new NotesError('a note needs text');
  let made!: Note;
  updateNotes(project, (notes) => {
    const ts = now.toISOString();
    made = { id: newId(notes), t: round(n.t), frame: n.frame, clips: n.clips, text: n.text.trim(), ...(n.rect ? { rect: cleanRect(n.rect) } : {}), status: n.status ?? 'open', render: n.render, created: ts, updated: ts };
    const p = noteProblem(made);
    if (p) throw new NotesError(`the note is not valid: ${p}`);
    notes.push(made);
  });
  return made;
}

export interface NotePatch { text?: string; rect?: Rect | null; status?: NoteStatus; moved?: { t: number; frame: number; clips: string[] } }

export function patchNote(project: string, id: string, patch: NotePatch, now = new Date()): Note {
  let out!: Note;
  updateNotes(project, (notes) => {
    const n = notes.find((x) => x.id === id);
    if (!n) throw new NotesError(`no note ${id} in ${notesPath(project)}${notes.length ? ` (notes: ${notes.map((x) => x.id).join(', ')})` : ''}`);
    if (patch.text !== undefined) {
      if (!patch.text.trim()) throw new NotesError('a note needs text');
      n.text = patch.text.trim();
    }
    if (patch.status !== undefined) {
      if (patch.status !== 'open' && patch.status !== 'done') throw new NotesError(`status ${patch.status}: expected open or done`);
      n.status = patch.status;
    }
    if (patch.rect !== undefined) { if (patch.rect) n.rect = cleanRect(patch.rect); else delete n.rect; }
    if (patch.moved) { n.t = round(patch.moved.t); n.frame = patch.moved.frame; n.clips = patch.moved.clips; }
    const p = noteProblem(n);
    if (p) throw new NotesError(`the note is not valid: ${p}`);
    n.updated = now.toISOString();
    out = { ...n };
  });
  return out;
}

export function deleteNote(project: string, id: string) {
  updateNotes(project, (notes) => {
    const i = notes.findIndex((x) => x.id === id);
    if (i < 0) throw new NotesError(`no note ${id} in ${notesPath(project)}`);
    notes.splice(i, 1);
  });
}

export interface TimelineClip { id: string; start: number; end: number; track: number }

export function clipsAt(timeline: TimelineClip[], t: number): string[] {
  const on = timeline.filter((c) => t >= c.start && t < c.end).sort((a, b) => a.track - b.track).map((c) => c.id);
  return on.length > 1 ? on.filter((c) => c !== 'overlay') : on;
}

export function frameOf(t: number, fps: number) {
  const frame = Math.max(0, Math.floor(t * fps + 1e-4));
  return { frame, start: round(frame / fps) };
}

export const stillCommand = (project: string, n: Pick<Note, 't'>) => `reel still --t ${String(n.t)} --project ${/[\s'"$`\\]/.test(project) ? `'${project.replace(/'/g, `'\\''`)}'` : project}`;

export const listed = (project: string, n: Note) => ({ ...n, still: stillCommand(project, n) });

export function formatNotes(project: string, notes: Note[], all: Note[] = notes): string {
  const open = all.filter((n) => n.status === 'open').length;
  const lines = [`${all.length} note${all.length === 1 ? '' : 's'}, ${open} open${notes.length < all.length ? ` (listing the open ones)` : ''}: ${path.relative(process.cwd(), notesPath(project)) || notesPath(project)}`];
  for (const n of notes) {
    const where = n.clips.length ? n.clips.join('+') : 'no clip';
    lines.push('', `${n.status.toUpperCase().padEnd(4)}  ${n.id}  ${n.t.toFixed(3)} s  frame ${n.frame}  ${where}`);
    for (const l of n.text.split('\n')) lines.push(`      ${l}`);
    const extra = [n.rect ? `area x ${Math.round(n.rect.x)} y ${Math.round(n.rect.y)}, ${Math.round(n.rect.w)}x${Math.round(n.rect.h)} px` : '', n.render ? `on ${n.render.file}${n.render.draft ? ' (a draft)' : ''} of ${n.render.mtime}` : ''].filter(Boolean);
    if (extra.length) lines.push(`      ${extra.join('; ')}`);
    if (n.status === 'open') lines.push(`      see it: ${stillCommand(project, n)}`);
  }
  return lines.join('\n');
}
