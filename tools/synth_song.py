# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["numpy>=2.0", "soundfile"]
# ///
"""A synthetic song whose beats are known, to check `reel analyze` against (and a licence-free track to cut to).

    uv run tools/synth_song.py <out> <bpm> <lead-in s> <bars> [--break a,b] [--human ms] [--drift 0.06]
                               [--syncopate] [--halftime] [--vocal] [--seed n]

Kick on 1 and 3 (plus the 'and' of 2 with --syncopate; on 1 and the 'and' of 2 with the snare on 3 with
--halftime), snare on 2 and 4, hats on eighths, a bass line, a chord pad changing every bar, and with --vocal a
vowel-like melody. The lead-in is the pad alone, so the first downbeat is at the lead-in time. --break lists bars
without drums, --human jitters hits by that many ms, --drift speeds the tempo up by that share across the song.
Writes <out>.wav (44.1 kHz stereo) and <out>.json (bpm, beats, downbeats).
"""
import json, argparse
import numpy as np, soundfile as sf
ap = argparse.ArgumentParser()
ap.add_argument('out'); ap.add_argument('bpm', type=float); ap.add_argument('lead', type=float); ap.add_argument('bars', type=int)
ap.add_argument('--break', dest='brk', default=''); ap.add_argument('--human', type=float, default=0); ap.add_argument('--seed', type=int, default=1)
ap.add_argument('--syncopate', action='store_true'); ap.add_argument('--halftime', action='store_true'); ap.add_argument('--drift', type=float, default=0); ap.add_argument('--vocal', action='store_true')
a = ap.parse_args()
SR = 44100; rng = np.random.default_rng(a.seed)
P = 60 / a.bpm
dur = a.lead + a.bars * 4 * P + 2.5
L = int(dur * SR); mix = np.zeros((L, 2))
brk = [int(x) for x in a.brk.split(',')] if a.brk else []
def add(sig, t, pan=0.0, g=1.0):
    i = int(round(t * SR))
    if i >= L: return
    n = min(len(sig), L - i)
    mix[i:i+n, 0] += sig[:n] * g * (1 - pan) ; mix[i:i+n, 1] += sig[:n] * g * (1 + pan)
def env(n, a_, d): t = np.arange(n) / SR; return np.minimum(1, t / max(a_, 1e-4)) * np.exp(-t / d)
def kick():
    n = int(0.4 * SR); t = np.arange(n) / SR; f = 50 + 110 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.12) * 0.9
def snare():
    n = int(0.25 * SR); t = np.arange(n) / SR
    return (rng.standard_normal(n) * env(n, 0.001, 0.06) * 0.5 + np.sin(2 * np.pi * 190 * t) * env(n, 0.001, 0.05) * 0.4)
def hat():
    n = int(0.06 * SR); x = rng.standard_normal(n); x = np.diff(np.r_[0, x]); return x * env(n, 0.0005, 0.015) * 0.25
def tone(freq, n, kind='saw', decay=1.0):
    t = np.arange(n) / SR; ph = (freq * t) % 1
    w = 2 * ph - 1 if kind == 'saw' else np.sin(2 * np.pi * freq * t)
    return w * env(n, 0.01, decay)
chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 293.7]]
bassn = [55, 49, 43.65, 49]
def H(): return rng.normal(0, a.human / 1000) if a.human else 0
beats, downs = [], []
NB = a.bars * 4
def bt(k):
    # time of beat k (fractional ok): period ramps from P to P*(1-drift) across the song
    return a.lead + P * (k - a.drift * k * k / (2 * NB))
# lead-in: a pad swelling into the first bar (no drums)
n = int(a.lead * SR)
if n > 0:
    pad = sum(tone(f, n, 'sin', 9) for f in chords[0]) * np.linspace(0, 1, n) * 0.12
    add(pad, 0)
for bar in range(a.bars):
    t0 = bt(bar * 4)
    downs.append(t0)
    c = chords[bar % 4]
    padlen = int(4 * P * SR)
    add(sum(tone(f, padlen, 'saw', 3.0) for f in c) * 0.035, t0, 0.3)
    drums = bar not in brk
    for b in range(4):
        tb = bt(bar * 4 + b); beats.append(tb)
        if drums:
            if a.halftime:
                if b == 0: add(kick(), tb + H())
                if b == 1: add(kick(), bt(bar * 4 + 1.5) + H(), 0, 0.8)
                if b == 2: add(snare(), tb + H(), -0.1)
            else:
                if b in (0, 2): add(kick(), tb + H())
                if b in (1, 3): add(snare(), tb + H(), -0.1)
            if a.syncopate and b == 1: add(kick(), bt(bar * 4 + 1.5) + H(), 0, 0.7)
            add(hat(), tb + H(), 0.4); add(hat(), bt(bar * 4 + b + (0.62 if a.halftime else 0.5)) + H(), 0.4, 0.6)
        if drums or b == 0:
            add(tone(bassn[bar % 4], int(P * 0.9 * SR), 'saw', 0.4) * 0.18, tb + H())
    if a.vocal and drums:
        # a vowel-like melody: a few notes per bar with formant-ish harmonics and vibrato
        for k, (off, f) in enumerate([(0, 440), (1.5, 494), (2, 523), (3, 494)]):
            nn = int(P * 0.9 * SR); t = np.arange(nn) / SR; vib = 1 + 0.01 * np.sin(2 * np.pi * 5.5 * t)
            v = sum(np.sin(2 * np.pi * f * h * np.cumsum(vib) / SR) * g for h, g in [(1, 1), (2, .5), (3, .6), (4, .2), (5, .3)])
            add(v * env(nn, 0.05, 0.6) * 0.06, bt(bar * 4 + off))
mix /= max(1e-9, np.abs(mix).max()) / 0.89
sf.write(a.out + '.wav', mix, SR, subtype='PCM_16')
json.dump({'bpm': a.bpm, 'beats': beats, 'downbeats': downs, 'lead': a.lead, 'breaks': brk}, open(a.out + '.json', 'w'))
print(a.out, f'{dur:.1f}s', len(beats), 'beats')
