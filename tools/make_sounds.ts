import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { run } from '../cli/children';

const OUT = path.join(import.meta.dir, '..', 'sounds');

export const SOUNDS: Record<string, { about: string; input: string[]; filter: string }> = {
  tick: { about: 'a short bright tick (a pen, a counter)', input: ['-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*2600*t)*exp(-t*160)+0.4*sin(2*PI*5200*t)*exp(-t*260)':s=48000:d=0.06"], filter: 'anull' },
  click: { about: 'a dry UI click', input: ['-f', 'lavfi', '-i', 'anoisesrc=color=white:seed=7:sample_rate=48000:duration=0.03'], filter: "highpass=f=1800,aeval='val(0)*exp(-t*420)'" },
  pop: { about: 'a round pop (something appears)', input: ['-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*(180*t+(420/45)*(1-exp(-45*t))))*exp(-t*28)':s=48000:d=0.18"], filter: 'anull' },
  whoosh: { about: 'a soft whoosh (a transition, a fast move)', input: ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:seed=3:sample_rate=48000:duration=0.7'], filter: "aeval='val(0)*pow(sin(PI*t/0.7),3)',highpass=f=250,lowpass=f=3200,lowpass=f=3200" },
  swell: { about: 'a rising swell into a reveal', input: ['-f', 'lavfi', '-i', "aevalsrc='(sin(2*PI*220*t)+0.6*sin(2*PI*330*t)+0.4*sin(2*PI*440*t)+0.2*sin(2*PI*660*t))*pow(t/1.6,2.5)*if(lt(t,1.6),1,exp(-(t-1.6)*12))':s=48000:d=1.9"], filter: 'lowpass=f=2500' },
  impact: { about: 'a low impact (a title landing)', input: ['-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*(45*t+(80/18)*(1-exp(-18*t))))*exp(-t*3.2)':s=48000:d=1.4", '-f', 'lavfi', '-i', 'anoisesrc=color=brown:seed=11:sample_rate=48000:duration=0.25'], filter: "[1:a]aeval='val(0)*exp(-t*22)',lowpass=f=900[n];[0:a][n]amix=inputs=2:weights='1 0.6':normalize=0" },
};

if (import.meta.main) {
  mkdirSync(OUT, { recursive: true });
  for (const [name, s] of Object.entries(SOUNDS)) {
    const raw = path.join(OUT, `.${name}.wav`), out = path.join(OUT, `${name}.wav`);
    const graph = s.filter.includes('[') ? `${s.filter}[x]` : `[0:a]${s.filter}[x]`;
    await run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', ...s.input, '-filter_complex', graph, '-map', '[x]', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', raw]);
    const st = (await run(['ffmpeg', '-nostdin', '-hide_banner', '-i', raw, '-af', 'astats=measure_overall=Peak_level:measure_perchannel=none', '-f', 'null', '-'], { quiet: true, nothrow: true })).stderr;
    const peak = Number(/Peak level dB:\s*(-?[\d.]+)/.exec(st)?.[1] ?? 0);
    await run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', raw, '-af', `volume=${(-3 - peak).toFixed(2)}dB`, '-c:a', 'pcm_s16le', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-map_metadata', '-1', out]);
    rmSync(raw, { force: true });
    console.log(`${out}: ${s.about}`);
  }
}
