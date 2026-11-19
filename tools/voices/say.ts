// macOS `say`: an instant scratch voice with no download. Its word times come from the forced aligner.
import { $ } from 'bun';
import path from 'node:path';
import type { VoiceSource } from './voice';

export const say: VoiceSource = {
  about: 'say[:<name>]          macOS scratch voice (default Daniel); words timed by the forced aligner',
  hosted: false,
  create(arg) {
    if (process.platform !== 'darwin') throw new Error('the say voice needs macOS: use kokoro or a hosted voice');
    const name = arg || 'Daniel';
    return {
      id: `say:${name}`,
      async synth(reqs, work, each) {
        for (const [i, r] of reqs.entries()) {
          const file = path.join(work, `say${i}.aiff`);
          const res = await $`say -v ${name} -r ${Math.round(175 * r.speed)} -o ${file} ${r.text}`.quiet().nothrow();
          if (res.exitCode !== 0) throw new Error(`say -v ${name}: ${res.stderr.toString().trim() || 'failed'} (\`say -v '?'\` lists the voices)`);
          await each(i, { file });
        }
      },
    };
  },
};
