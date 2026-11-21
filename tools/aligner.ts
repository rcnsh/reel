import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../cli/children';
import { snapToPauses, timeScript } from './align-words';
import { levels, SR, writeAudio } from './audio-io';
import type { TimedWord } from './script';

export async function forcedAlign(passages: { pcm: Float32Array; words: { w: string }[] }[], work: string, language = 'English'): Promise<TimedWord[][]> {
  if (!passages.length) return [];
  mkdirSync(work, { recursive: true });
  const jobs = await Promise.all(passages.map(async (p, i) => {
    const w48 = path.join(work, `fa${i}.f32.wav`), w16 = path.join(work, `fa${i}.wav`);
    await writeAudio(p.pcm, w48);
    await run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', w48, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', w16]);
    return { audio: w16, text: p.words.map((x) => x.w).join(' '), out: path.join(work, `fa${i}.json`) };
  }));
  const jf = path.join(work, 'jobs.json');
  await Bun.write(jf, JSON.stringify(jobs));
  const r = await run(['uv', 'run', '-q', path.join(import.meta.dir, 'forced_align.py'), jf], { stdout: 'inherit', nothrow: true, env: { ...process.env, LANGUAGE: language } });
  if (r.exitCode !== 0) throw new Error(`forced alignment failed (Qwen3-ForcedAligner; --method whisper transcribes instead):\n${r.stderr.slice(-1500)}`);
  return passages.map((p, i) => {
    const tokens = JSON.parse(readFileSync(jobs[i]!.out, 'utf8')) as TimedWord[];
    return refine(p.words, tokens, p.pcm);
  });
}

export function refine(words: { w: string }[], tokens: TimedWord[], pcm: Float32Array): TimedWord[] {
  const len = pcm.length / SR;
  return snapToPauses(timeScript(words, tokens, 0, len), levels(pcm));
}
