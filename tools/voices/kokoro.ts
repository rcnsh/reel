// Kokoro-82M, a local model (tools/voices/kokoro_tts.py through uv): a natural voice with no key and nothing sent
// anywhere. Runs through MLX on Apple Silicon and PyTorch elsewhere; its duration predictor gives the word times.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../../cli/children';
import type { VoiceSource } from './voice';

export const kokoro: VoiceSource = {
  about: 'kokoro[:<voice>]      local model, Kokoro-82M (default af_heart; am_michael, bf_emma, bm_george, …)',
  hosted: false,
  create(arg) {
    const voice = arg || 'af_heart';
    if (!/^[ab][fm]_[a-z]+$/.test(voice)) throw new Error(`kokoro:${voice}: expected an English Kokoro voice such as af_heart, am_michael, bf_emma or bm_george`);
    return {
      id: `kokoro:${voice}`,
      async synth(reqs, work, each) {
        const items = reqs.map((r, i) => ({ text: r.text, speed: r.speed, out: path.join(work, `kokoro${i}.wav`) }));
        const jf = path.join(work, 'kokoro.json');
        await Bun.write(jf, JSON.stringify({ voice, items }));
        const r = await run(['uv', 'run', '-q', path.join(import.meta.dir, 'kokoro_tts.py'), jf], { stdout: 'inherit', nothrow: true });
        if (r.exitCode !== 0) throw new Error(`kokoro failed:\n${r.stderr.slice(-1500)}`);
        // (one process voices every passage, so its model loads once; they are handed on when it ends)
        for (const [i, it] of items.entries()) await each(i, { file: it.out, words: JSON.parse(readFileSync(`${it.out}.json`, 'utf8')) });
      },
    };
  },
};
