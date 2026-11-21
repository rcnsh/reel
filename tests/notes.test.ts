import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { addNote, clipsAt, deleteNote, formatNotes, frameOf, newId, NotesError, notesPath, patchNote, readNotes, stillCommand, updateNotes, type NewNote } from '../cli/notes';
import { isDraft, latestRender, writeTimelineCache } from '../cli/review';
import { ENGINE, reel, removeTempDirs, tempDir } from './helpers';

afterAll(removeTempDirs);

const TIMELINE = [{ id: 'intro', start: 0, end: 2, track: 0 }, { id: 'body', start: 1.5, end: 4, track: 0 }, { id: 'title', start: 0.5, end: 3, track: 1 }, { id: 'overlay', start: 0, end: 4, track: 2 }];
const base: NewNote = { t: 1, frame: 30, clips: ['intro'], text: 'first', render: { file: 'out/video.mp4', mtime: '2026-01-01T00:00:00.000Z' } };

test('add, edit, resolve and delete notes; the file is sorted by time and readable JSON', () => {
  const p = tempDir('reel-notes-');
  expect(readNotes(p)).toEqual([]);
  const a = addNote(p, { ...base, t: 2, frame: 60, text: '  later  ', rect: { x: 10.04, y: 20, w: 30, h: 40 } });
  const b = addNote(p, base);
  expect(a.text).toBe('later');
  expect(a.rect).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  expect(a.status).toBe('open');
  expect(readNotes(p).map((n) => n.id)).toEqual([b.id, a.id]);
  const edited = patchNote(p, a.id, { text: 'changed', rect: null }, new Date('2030-01-01'));
  expect(edited.text).toBe('changed');
  expect(edited.rect).toBeUndefined();
  expect(edited.updated).toBe('2030-01-01T00:00:00.000Z');
  expect(edited.created).toBe(a.created);
  expect(patchNote(p, b.id, { status: 'done' }).status).toBe('done');
  expect(patchNote(p, b.id, { moved: { t: 2.5, frame: 75, clips: ['x'] } })).toMatchObject({ t: 2.5, frame: 75, clips: ['x'], status: 'done' });
  deleteNote(p, b.id);
  expect(readNotes(p).map((n) => n.id)).toEqual([a.id]);
  expect(JSON.parse(readFileSync(notesPath(p), 'utf8')).notes[0].text).toBe('changed');
  expect(() => patchNote(p, 'nope', { status: 'done' })).toThrow(/no note nope .*notes: /);
  expect(() => addNote(p, { ...base, text: '   ' })).toThrow(NotesError);
  expect(() => patchNote(p, a.id, { status: 'maybe' as never })).toThrow(/expected open or done/);
});

test('a change merges into the file as it is now: a concurrent edit by another writer is kept', () => {
  const p = tempDir('reel-notes-');
  const a = addNote(p, base);
  const seen = readNotes(p);
  const disk = JSON.parse(readFileSync(notesPath(p), 'utf8'));
  disk.notes[0].text = 'reworded by the agent';
  disk.notes.push({ ...disk.notes[0], id: 'agnt', t: 3, frame: 90, text: 'added by hand' });
  writeFileSync(notesPath(p), JSON.stringify(disk));
  expect(seen[0]!.text).toBe('first');
  patchNote(p, a.id, { status: 'done' });
  const now = readNotes(p);
  expect(now.map((n) => [n.id, n.text, n.status])).toEqual([[a.id, 'reworded by the agent', 'done'], ['agnt', 'added by hand', 'open']]);
  updateNotes(p, (ns) => { ns.splice(ns.findIndex((n) => n.id === 'agnt'), 1); });
  expect(() => patchNote(p, 'agnt', { text: 'x' })).toThrow(/no note agnt/);
  expect(readNotes(p).length).toBe(1);
});

test('two processes adding notes at once lose none of them', async () => {
  const p = tempDir('reel-notes-');
  const script = `import { addNote } from ${JSON.stringify(path.join(ENGINE, 'cli/notes.ts'))};
for (let i = 0; i < 40; i++) addNote(${JSON.stringify(p)}, { t: i, frame: i, clips: [], text: process.argv[2] + i, render: null });`;
  const file = path.join(p, 'add.ts');
  writeFileSync(file, script);
  const procs = ['a', 'b'].map((w) => Bun.spawn(['bun', file, w], { stdout: 'ignore', stderr: 'pipe' }));
  for (const pr of procs) expect(await pr.exited, await new Response(pr.stderr).text()).toBe(0);
  const notes = readNotes(p);
  expect(notes.length).toBe(80);
  expect(new Set(notes.map((n) => n.id)).size).toBe(80);
}, 30_000);

test('a corrupt notes file is reported clearly and never overwritten', () => {
  const p = tempDir('reel-notes-');
  mkdirSync(path.join(p, 'review'));
  const cases: [string, RegExp][] = [
    ['{ "notes": [ { "id": "a", ', /notes\.json is not valid JSON .*will not overwrite/],
    ['[]', /has no "notes" list/],
    ['{ "notes": [ { "id": "a", "t": "soon", "frame": 1, "clips": [], "text": "x", "status": "open" } ] }', /note 1 \(a\): t "soon" is not seconds/],
    ['{ "notes": [ { "id": "a", "t": 1, "frame": 1, "clips": [], "text": "x", "status": "wip" } ] }', /status "wip" is not open or done/],
    [JSON.stringify({ notes: [1, 2].map(() => ({ id: 'a', t: 1, frame: 1, clips: [], text: 'x', status: 'open', render: null, created: '', updated: '' })) }), /two notes have the id a/],
  ];
  for (const [text, err] of cases) {
    writeFileSync(notesPath(p), text);
    expect(() => readNotes(p)).toThrow(err);
    expect(() => addNote(p, base)).toThrow(NotesError);
    expect(readFileSync(notesPath(p), 'utf8')).toBe(text);
  }
});

test('ids are short and unique; clips at a time leave the overlay out; frames and the still command', () => {
  let i = 0;
  const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
  const fixed = () => seq[i++ % seq.length]!;
  const first = newId([], fixed);
  expect(first).toMatch(/^[a-z2-9]{4}$/);
  expect(newId([{ id: first } as never], fixed)).not.toBe(first);
  expect(clipsAt(TIMELINE, 1.6)).toEqual(['intro', 'body', 'title']);
  expect(clipsAt(TIMELINE, 3.5)).toEqual(['body']);
  expect(clipsAt([{ id: 'overlay', start: 0, end: 1, track: 2 }], 0.5)).toEqual(['overlay']);
  expect(frameOf(0.2333, 30)).toEqual({ frame: 6, start: 0.2 });
  expect(frameOf(7 / 30, 30).frame).toBe(7);
  expect(stillCommand('/p/my video', { t: 2.5 })).toBe("reel still --t 2.5 --project '/p/my video'");
  const listing = formatNotes('/p', [{ ...base, rect: undefined, id: 'abcd', status: 'open', clips: ['intro'], created: '', updated: '' }]);
  expect(listing).toContain('OPEN  abcd  1.000 s  frame 30  intro');
  expect(listing).toContain('see it: reel still --t 1 --project /p');
});

test('the newest render under out/ is the default; drafts are known by name or comment', () => {
  const p = tempDir('reel-notes-');
  expect(latestRender(p)).toBeNull();
  mkdirSync(path.join(p, 'out/stills'), { recursive: true });
  for (const [f, age] of [['out/video.mp4', 30], ['out/a.picture.mp4', 0], [`out/video.partial-1-${Date.now()}.mp4`, 0], ['out/stills/x.png', 0], ['out/video.draft.mp4', 10]] as const) {
    writeFileSync(path.join(p, f), '');
    const t = new Date(Date.now() - age * 1000);
    utimesSync(path.join(p, f), t, t);
  }
  expect(latestRender(p)).toBe(path.join(p, 'out/video.draft.mp4'));
  expect(isDraft('/x/out/video.draft.mp4', '')).toBe(true);
  expect(isDraft('/x/out/cut.mp4', 'reel draft: half size, one sample, not for delivery')).toBe(true);
  expect(isDraft('/x/out/video.mp4', '')).toBe(false);
});

function project() {
  const p = realpathSync(tempDir('reel-notes-cli-'));
  writeFileSync(path.join(p, 'reel.config.ts'), `import { defineVideo } from 'reel/config';\nexport default defineVideo({ size: [1280, 720], fps: 25, timeline: () => [] });\n`);
  writeTimelineCache(p, { size: [1280, 720], fps: 25, duration: 4, timeline: TIMELINE });
  return p;
}
const NO_CHROME = { CHROME_PATH: '/nonexistent/chrome', REEL_NO_DAEMON: '1' };

test('reel notes add, list, done and reopen', async () => {
  const p = project();
  const add = await reel(['notes', 'add', '--t', '1.6', 'Title overlaps the body', '--json', '--project', p], ENGINE, NO_CHROME);
  expect(add.code).toBe(0);
  const note = add.json().note;
  expect(add.json().warnings).toEqual([]);
  expect(note).toMatchObject({ t: 1.6, frame: 40, clips: ['intro', 'body', 'title'], text: 'Title overlaps the body', status: 'open', render: null });
  expect(note.still).toBe(`reel still --t 1.6 --project ${p}`);
  await reel(['notes', 'add', '--t', '3.5', 'Hold longer', '--project', p], ENGINE, NO_CHROME);

  const human = await reel(['notes', '--project', p], ENGINE, NO_CHROME);
  expect(human.code).toBe(0);
  expect(human.out).toContain('2 notes, 2 open');
  expect(human.out).toContain(`see it: reel still --t 1.6 --project ${p}`);

  const done = await reel(['notes', 'done', note.id, '--project', p], ENGINE, NO_CHROME);
  expect(done.code).toBe(0);
  expect(done.out).toContain(`${note.id} is done`);
  const open = (await reel(['notes', '--open', '--json', '--project', p], ENGINE, NO_CHROME)).json().notes;
  expect(open.map((n: { text: string }) => n.text)).toEqual(['Hold longer']);
  expect((await reel(['notes', '--json', '--project', p], ENGINE, NO_CHROME)).json().notes.length).toBe(2);
  expect((await reel(['notes', 'reopen', note.id, '--json', '--project', p], ENGINE, NO_CHROME)).json().note.status).toBe('open');
}, 60_000);

test('reel notes: bad command lines exit 2, a missing note or a corrupt file exits 1 with the reason', async () => {
  const p = project();
  for (const args of [['notes', 'add', 'no time'], ['notes', 'add', '--t', 'soon', 'x'], ['notes', 'done'], ['notes', 'shelve', 'x'], ['notes', '--t', '1'], ['notes', '--bogus']]) {
    const r = await reel([...args, '--project', p], ENGINE, NO_CHROME);
    expect(r.code, args.join(' ')).toBe(2);
  }
  const missing = await reel(['notes', 'done', 'zzzz', '--json', '--project', p], ENGINE, NO_CHROME);
  expect(missing.code).toBe(1);
  expect(missing.json().errors[0]).toContain('no note zzzz');
  mkdirSync(path.join(p, 'review'), { recursive: true });
  writeFileSync(notesPath(p), '{ nope');
  const bad = await reel(['notes', '--project', p], ENGINE, NO_CHROME);
  expect(bad.code).toBe(1);
  expect(bad.err).toContain('is not valid JSON');
}, 60_000);

test('reel notes add without a timeline: the note is still added, with a warning and no clips', async () => {
  const p = project();
  writeFileSync(path.join(p, 'reel.config.ts'), readFileSync(path.join(p, 'reel.config.ts'), 'utf8') + '\n');
  const r = await reel(['notes', 'add', '--t', '1', 'x', '--json', '--project', p], ENGINE, NO_CHROME);
  expect(r.code).toBe(0);
  expect(r.json().warnings.join('\n')).toContain('using the one cached');
  expect(r.json().note.clips).toEqual(['intro', 'title']);
}, 60_000);
