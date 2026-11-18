# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["librosa>=0.11", "numpy>=2.0", "scipy>=1.13"]
# ///
"""Music analysis -> data/audio.json, for videos cut to a song.

    uv run tools/analyze.py <song> [--fast] [--sections sections.json] [--keep-sections] [--offset 0]
                                   [--free-tempo] [--onset-delta 0.5,0.4,0.25]

Writes what the engine's audio helpers read (AudioData: beatAt, barAt, env, hit, f.a, f.beat, ...):

  * beats and downbeats from Beat This! (a transformer beat tracker; tools/music_models.py). Where they keep one
    tempo (produced music: a residual under 20 ms) a constant grid is fitted through them, which fills beats the
    tracker missed in breaks and puts every beat between its frames; otherwise (a live tempo, or --free-tempo)
    the tracked beats are kept. The bar length and the downbeat's place in it are what most of the tracked
    downbeats agree on;
  * 100 fps envelopes, each normalised to 0..1 at its 99th percentile, with a fast-attack, slower-release
    follower: rms, low (<200 Hz), mid (200 Hz-2 kHz) and high (>2 kHz) of the mix, and drums, bass, other and
    vocal from stems separated by Demucs (htdemucs through demucs-mlx);
  * a waveform (peak and RMS of the mix per 1/100 s, on one scale, 0..1 at the loudest peak) and a spectrum (24
    log-spaced bands, 40 Hz-11 kHz, per 1/100 s, 0..1 over a 60 dB range below the song's loudest band, with the
    same follower), each stored as base64 bytes so they add about as much to the file as the envelopes do;
  * kick / snare / hat onsets from the drum stem (low, mid and high bands) and vocal onsets from the vocal stem,
    strengths 0..1; raise a band's --onset-delta (peak-picking threshold) if it fires on other sounds;
  * sections: from --sections (a JSON list of {"name", "bar"} or {"name", "start"} in seconds, in order),
    else kept from the existing data/audio.json with --keep-sections (a narrated video with a music bed),
    else found by structural segmentation and named part1, part2, ... on downbeats.

--fast skips the models (no download, seconds instead of tens of seconds): librosa's beat tracker with one
fitted tempo and a kick/snare heuristic for the bar phase, and harmonic/percussive proxies for the stems. Good
for drafts; it loses its place where the tempo moves.

The timeline shows each section with the scene of the same name, so name sections after your scenes.
Without --keep-sections the song becomes the video's sound: it is copied to audio/ and data/audio.json
names it as the `track` the preview plays and the export muxes. With --keep-sections the track, duration and
sections stay as they were and --offset places the song's start on the video's timeline (where the mix lays it).
"""
import argparse
import base64
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

import librosa
import numpy as np
from scipy.signal import butter, sosfiltfilt

# the project folder: the one `reel` was pointed at, else the current folder
ROOT = Path(os.environ.get("REEL_PROJECT", ".")).resolve()
SR = 22050
FPS = 100


def band(x, lo, hi):
    if lo and hi:
        sos = butter(4, [lo, hi], btype="band", fs=SR, output="sos")
    elif hi:
        sos = butter(4, hi, btype="low", fs=SR, output="sos")
    else:
        sos = butter(4, lo, btype="high", fs=SR, output="sos")
    return sosfiltfilt(sos, x)


def frame_rms(x, n):
    hop = SR / FPS
    win = 1024
    pad = np.pad(x, (win // 2, win // 2 + int(hop) + 2))
    idx = (np.arange(n) * hop).astype(int)
    c = np.concatenate([[0.0], np.cumsum(pad.astype(np.float64) ** 2)])
    return np.sqrt(np.maximum((c[idx + win] - c[idx]) / win, 0))


def follow(x, attack=0.010, release=0.090):
    """One-pole follower: fast attack, slower release (reads well on screen)."""
    aa, ar = math.exp(-1 / (attack * FPS)), math.exp(-1 / (release * FPS))
    y, s = np.empty_like(x), 0.0
    for i, v in enumerate(x):
        a = aa if v > s else ar
        s = a * s + (1 - a) * v
        y[i] = s
    return y


def follow_rows(x, attack=0.010, release=0.090):
    """follow() down each column of a (frames, bands) array at once."""
    aa, ar = math.exp(-1 / (attack * FPS)), math.exp(-1 / (release * FPS))
    y, s = np.empty_like(x), np.zeros(x.shape[1])
    for i in range(len(x)):
        a = np.where(x[i] > s, aa, ar)
        s = a * s + (1 - a) * x[i]
        y[i] = s
    return y


def norm01(x, pct=99.0):
    top = np.percentile(x, pct)
    return np.clip(x / top, 0, 1) if top > 1e-9 else np.zeros_like(x)


def envelope(x, n):
    return [round(float(v), 3) for v in follow(norm01(frame_rms(x, n)))]


def b64bytes(x):
    """0..1 values as base64 bytes (0-255): about a third of the size of rounded JSON numbers."""
    return base64.b64encode(np.round(np.clip(x, 0, 1) * 255).astype(np.uint8).tobytes()).decode("ascii")


def waveform(x, n):
    """Peak and RMS per frame of 1/FPS s (each frame's own samples), both divided by the loudest peak."""
    if n == 0:
        return {"fps": FPS, "peak": "", "rms": ""}
    idx = (np.arange(n + 1) * (SR / FPS)).astype(int)
    x = np.pad(np.abs(x.astype(np.float64)), (0, max(0, idx[-1] - len(x))))[: idx[-1]]
    peak = np.maximum.reduceat(x, idx[:-1])
    c = np.concatenate([[0.0], np.cumsum(x ** 2)])
    rms = np.sqrt(np.maximum((c[idx[1:]] - c[idx[:-1]]) / np.diff(idx), 0))
    top = peak.max()
    if top > 1e-9:
        peak, rms = peak / top, rms / top
    return {"fps": FPS, "peak": b64bytes(peak), "rms": b64bytes(rms)}


SPECTRUM_BANDS, SPECTRUM_LO, SPECTRUM_HI = 24, 40.0, 11000.0


def spectrum(x, n):
    """Log-spaced band levels per frame of 1/FPS s: band power from a 2048-point STFT, in dB, 0..1 over the 60 dB
    below the song's loudest band (its 99.5th percentile), through the envelopes' follower. Frames are byte rows
    of SPECTRUM_BANDS, lowest band first."""
    if n == 0:
        return {"fps": FPS, "bands": [], "data": ""}
    nfft, hop = 2048, 220
    S = np.abs(librosa.stft(x, n_fft=nfft, hop_length=hop, center=True)) ** 2
    freqs = librosa.fft_frequencies(sr=SR, n_fft=nfft)
    edges = np.geomspace(SPECTRUM_LO, SPECTRUM_HI, SPECTRUM_BANDS + 1)
    centres = np.sqrt(edges[:-1] * edges[1:])
    P = np.empty((SPECTRUM_BANDS, S.shape[1]))
    for b in range(SPECTRUM_BANDS):
        m = (freqs >= edges[b]) & (freqs < edges[b + 1])
        if m.any():
            P[b] = S[m].mean(axis=0)
        else:
            # a band narrower than a bin: the power at its centre, between the bins around it
            j = int(np.clip(np.searchsorted(freqs, centres[b]), 1, len(freqs) - 1))
            w = (centres[b] - freqs[j - 1]) / (freqs[j] - freqs[j - 1])
            P[b] = S[j - 1] * (1 - w) + S[j] * w
    db = 10 * np.log10(P + 1e-12)
    # (at least the loudest moment less 30 dB: a short sound in a long silence, a bed placed with --offset, must not
    # put the silence at the top of the range; a silent track stays at 0)
    top = max(np.percentile(db, 99.5), db.max() - 30)
    if db.max() < -100:
        top = np.inf
    lvl = np.clip((db - (top - 60)) / 60, 0, 1)
    # onto the envelopes' frames
    tf = np.arange(S.shape[1]) * hop / SR
    t = np.arange(n) / FPS
    out = follow_rows(np.stack([np.interp(t, tf, lvl[b]) for b in range(SPECTRUM_BANDS)], axis=1))
    return {"fps": FPS, "bands": [round(float(c), 1) for c in centres], "data": b64bytes(out.reshape(-1))}


def onsets(x, delta, min_gap):
    """Onset times and 0..1 strengths (dB of the onset envelope, 5th-95th percentile)."""
    hop = 256
    env = librosa.onset.onset_strength(y=x, sr=SR, hop_length=hop)
    fr = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=hop, delta=delta, wait=int(min_gap * SR / hop), backtrack=False)
    if len(fr) == 0:
        return []
    db = 20 * np.log10(env[fr] + 1e-9)
    lo, hi = np.percentile(db, 5), np.percentile(db, 95)
    s = np.clip((db - lo) / max(hi - lo, 1e-6), 0, 1) * 0.8 + 0.2
    t = librosa.frames_to_time(fr, sr=SR, hop_length=hop)
    return [[round(float(a), 3), round(float(b), 3)] for a, b in zip(t, s)]


def beat_grid(y, duration, free):
    tempo, fr = librosa.beat.beat_track(y=y, sr=SR, hop_length=256, units="frames", tightness=200)
    raw = librosa.frames_to_time(fr, sr=SR, hop_length=256)
    if len(raw) < 4:
        sys.exit("analyze: too few beats found; is this music?")
    if free:
        return float(np.atleast_1d(tempo)[0]), [float(b) for b in raw]
    # one constant tempo through the tracked beats (least squares of time against beat index)
    k = np.arange(len(raw))
    period, phase = np.polyfit(k, raw, 1)
    phase = phase % period
    grid = np.arange(phase, duration, period)
    return 60.0 / period, [float(b) for b in grid]


def refine_phase(beats, kick, free, duration):
    """Move a fitted grid onto the strong kicks: the median offset of kicks within 60 ms of a beat."""
    if free or not kick:
        return beats
    b = np.array(beats)
    strong = [t for t, s in kick if s >= 0.5]
    d = [t - b[np.abs(b - t).argmin()] for t in strong]
    d = [x for x in d if abs(x) < 0.06]
    if len(d) < 4:
        return beats
    shift = float(np.median(d))
    period = b[1] - b[0]
    return [float(x) for x in np.arange((b[0] + shift) % period, duration, period)]


def at_beats(onsets_, beats, tol=0.05):
    """Onset strength landing on each beat (0 where none does)."""
    out = np.zeros(len(beats))
    if not onsets_:
        return out
    ot = np.array([o[0] for o in onsets_]); os_ = np.array([o[1] for o in onsets_])
    for i, b in enumerate(beats):
        m = np.abs(ot - b) < tol
        out[i] = os_[m].max() if m.any() else 0
    return out


def downbeat_phase(y, harm, beats, kick, snare):
    """The bar phase (of 4) on the one: kicks on 1 and 3 against snares on 2 and 4 choose the pair of phases,
    then low-end energy plus harmonic change at the beat choose within it."""
    k, s = at_beats(kick, beats), at_beats(snare, beats)
    pair = lambda p: np.r_[k[p::4], k[p + 2::4]].mean() - np.r_[s[p::4], s[p + 2::4]].mean()
    p0 = 0 if pair(0) >= pair(1) else 1
    # low end: rms below 200 Hz in the 100 ms after each beat (raw, so a louder kick on the one counts)
    lowb = band(y, None, 200)
    low = np.array([np.sqrt(np.mean(lowb[int(b * SR):int((b + 0.1) * SR)] ** 2) + 1e-12) for b in beats])
    # harmonic change: chroma distance between the beat before and the beat after
    hop = 512
    ch = librosa.util.normalize(librosa.feature.chroma_stft(y=harm, sr=SR, hop_length=hop), axis=0)
    fr = librosa.time_to_frames(beats, sr=SR, hop_length=hop).clip(0, ch.shape[1] - 1)
    seg = librosa.util.sync(ch, np.r_[0, fr, ch.shape[1]], aggregate=np.mean)
    nov = np.r_[np.linalg.norm(np.diff(seg, axis=1), axis=0)[: len(beats)], np.zeros(len(beats))][: len(beats)]
    n01 = lambda x: x / x.max() if x.max() > 0 else x
    score = lambda p: n01(low)[p::4].mean() + n01(nov)[p::4].mean()
    return p0 if score(p0) >= score(p0 + 2) else p0 + 2


def auto_sections(y, downbeats, duration):
    """Structural segmentation (chroma + MFCC, agglomerative), boundaries snapped to downbeats."""
    hop = 512
    feat = np.vstack([
        librosa.util.normalize(librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=hop), axis=0),
        librosa.util.normalize(librosa.feature.mfcc(y=y, sr=SR, hop_length=hop, n_mfcc=13), axis=1),
    ])
    k = int(np.clip(round(duration / 25), 2, 12))  # about one section per 25 s
    bounds = librosa.frames_to_time(librosa.segment.agglomerative(feat, k), sr=SR, hop_length=hop)
    db = np.array(downbeats) if downbeats else np.array([0.0])
    starts = sorted({0.0} | {float(db[np.abs(db - b).argmin()]) for b in bounds[1:]})
    return [{"name": f"part{i + 1}", "start": s} for i, s in enumerate(starts)]


def load_on_timeline(path, lead, n_samples):
    """A file's mono samples at SR, shifted by `lead` samples and cut or padded to n_samples."""
    x, _ = librosa.load(path, sr=SR, mono=True)
    x = np.concatenate([np.zeros(max(lead, 0)), x[max(-lead, 0):]])[:n_samples]
    return np.pad(x, (0, max(0, n_samples - len(x))))


def run_models(song, work):
    """Beat This! beats and Demucs stems (tools/music_models.py in its own environment)."""
    script = Path(__file__).with_name("music_models.py")
    r = subprocess.run(["uv", "run", "-q", str(script), str(song), str(work)])
    if r.returncode != 0:
        sys.exit("analyze: the models failed (see above); --fast analyses without them")
    return json.loads((Path(work) / "beats.json").read_text())


def regularize(beats, downbeats, free, duration):
    """Tracked beats as a constant-tempo grid where they keep one tempo; downbeats where most tracked ones fall."""
    b = np.array(beats, dtype=float)
    if len(b) < 8:
        sys.exit("analyze: too few beats found; is this music?")
    # beat indices from the intervals (a gap of two periods is a missed beat)
    d = np.diff(b)
    idx = np.r_[0, np.cumsum(np.maximum(1, np.round(d / np.median(d))))]
    grid = None
    if not free:
        period, phase = np.polyfit(idx, b, 1)
        res = b - (phase + period * idx)
        inl = np.abs(res) < 0.05
        if inl.sum() >= 8:
            period, phase = np.polyfit(idx[inl], b[inl], 1)
            res = b[inl] - (phase + period * idx[inl])
            if np.sqrt(np.mean(res ** 2)) < 0.02:
                k = np.arange(idx[inl].min(), idx[inl].max() + 1)
                grid = phase + period * k
                grid = grid[(grid >= 0) & (grid < duration)]
    out = grid if grid is not None else b
    # bar length and phase: the tracked downbeats' places on the beats
    on = [int(np.abs(out - t).argmin()) for t in downbeats if np.abs(out - t).min() < 0.07]
    if len(on) >= 2:
        steps = [y - x for x, y in zip(on, on[1:]) if 2 <= y - x <= 7]
        meter = Counter(steps).most_common(1)[0][0] if steps else 4
        ph = Counter(i % meter for i in on).most_common(1)[0][0]
    else:
        meter, ph = 4, 0
    return [float(x) for x in out], [float(x) for x in out[ph::meter]], meter, grid is not None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("song")
    ap.add_argument("--sections", help="JSON list of {name, bar} or {name, start}")
    ap.add_argument("--keep-sections", action="store_true", help="keep track, duration and sections of the existing data/audio.json")
    ap.add_argument("--offset", type=float, default=0.0, help="video time the song starts at (with --keep-sections)")
    ap.add_argument("--fast", action="store_true", help="no models: librosa beats and harmonic/percussive proxies for the stems")
    ap.add_argument("--free-tempo", action="store_true", help="keep the tracked beats instead of fitting one tempo")
    ap.add_argument("--onset-delta", default="0.5,0.4,0.25", help="kick,snare,hat peak-picking thresholds")
    a = ap.parse_args()
    if a.offset and not a.keep_sections:
        sys.exit("analyze: --offset places a music bed on a narrated video's timeline; it needs --keep-sections")

    song = Path(a.song).resolve()
    out = ROOT / "data/audio.json"
    prev = json.loads(out.read_text()) if a.keep_sections and out.exists() else None
    if a.keep_sections and not prev:
        sys.exit("analyze: --keep-sections needs an existing data/audio.json")
    off = a.offset if prev else 0.0

    y, _ = librosa.load(song, sr=SR, mono=True)
    song_dur = len(y) / SR
    duration = prev["duration"] if prev else song_dur
    # the song on the video's timeline: shifted by the offset, cut or padded to the video's length
    lead = int(round(off * SR))
    y = np.concatenate([np.zeros(max(lead, 0)), y[max(-lead, 0):]])[: int(math.ceil(duration * SR))]
    y = np.pad(y, (0, max(0, int(math.ceil(duration * SR)) - len(y))))
    n = int(math.ceil(duration * FPS))

    dk, ds, dh = (float(x) for x in a.onset_delta.split(","))
    meter = 4
    if a.fast:
        harm, perc = librosa.effects.hpss(y)
        bpm, beats = beat_grid(y, duration, a.free_tempo)
        # (a free-tempo grid from a shifted song starts at its first beat; a fitted one extends back to 0)
        kick = onsets(band(perc, None, 150), delta=dk, min_gap=0.10)
        snare = onsets(band(perc, 150, 2500), delta=ds, min_gap=0.10)
        hat = onsets(band(perc, 6000, None), delta=dh, min_gap=0.05)
        vocal = onsets(band(harm, 300, 3400), delta=0.3, min_gap=0.12)
        beats = refine_phase(beats, kick, a.free_tempo, duration)
        p = downbeat_phase(y, harm, beats, kick, snare)
        downbeats = beats[p::4]
        stems = {"drums": perc, "other": harm, "bass": band(harm, None, 200), "vocal": band(harm, 300, 3400)}
        how = "librosa beats, harmonic/percussive proxies"
    else:
        with tempfile.TemporaryDirectory(prefix="reel-analyze-") as work:
            tracked = run_models(song, work)
            n_samples = len(y)
            stems = {k: load_on_timeline(Path(work) / f"{f}.wav", lead, n_samples) for k, f in [("drums", "drums"), ("bass", "bass"), ("other", "other"), ("vocal", "vocals")]}
        shift = lambda ts: [t + off for t in ts if 0 <= t + off < duration]
        beats, downbeats, meter, gridded = regularize(shift(tracked["beats"]), shift(tracked["downbeats"]), a.free_tempo, duration)
        bpm = 60.0 / float(np.median(np.diff(beats)))
        kick = onsets(band(stems["drums"], None, 150), delta=dk, min_gap=0.10)
        snare = onsets(band(stems["drums"], 150, 2500), delta=ds, min_gap=0.10)
        hat = onsets(band(stems["drums"], 6000, None), delta=dh, min_gap=0.05)
        vocal = onsets(stems["vocal"], delta=0.3, min_gap=0.12)
        if gridded:
            # the tracker works in 20 ms frames: move the grid onto the strong kicks of the drum stem (the median
            # offset of those within 60 ms of a beat), which measured more consistent on songs with known beats
            b = np.array(beats)
            dd = [t - b[np.abs(b - t).argmin()] for t, st in kick if st >= 0.5]
            dd = [x for x in dd if abs(x) < 0.06]
            if len(dd) >= 4:
                sh = float(np.median(dd))
                beats = [x + sh for x in beats if 0 <= x + sh < duration]
                downbeats = [x + sh for x in downbeats if 0 <= x + sh < duration]
        how = f"Beat This! beats ({'one tempo' if gridded else 'as tracked'}), Demucs stems"

    if a.sections:
        starts = []
        for s in json.loads(Path(a.sections).read_text()):
            if "start" in s:
                t = float(s["start"])
            else:
                bar = int(s["bar"])
                if not 0 <= bar < len(downbeats):
                    sys.exit(f"analyze: section '{s['name']}' is at bar {bar}; the song has bars 0-{len(downbeats) - 1}")
                t = downbeats[bar]
            if not 0 <= t < duration or (starts and t <= starts[-1]["start"]):
                sys.exit(f"analyze: section '{s['name']}' starts at {t:.3f} s: sections must start inside the song ({duration:.3f} s) and in order")
            starts.append({"name": s["name"], "start": t})
    elif prev:
        starts = None
    else:
        starts = auto_sections(y, downbeats, duration)
    if starts is not None:
        sections = [{"name": s["name"], "start": round(float(s["start"]), 3), "end": round(float(starts[i + 1]["start"] if i + 1 < len(starts) else duration), 3)} for i, s in enumerate(starts)]
    else:
        sections = prev["sections"]

    doc = {
        "duration": round(duration, 3),
        "bpm": round(bpm, 3),
        "beat_period": round(60 / bpm, 4),
        "time_signature": meter,
        "beats": [round(b, 3) for b in beats],
        "downbeats": [round(b, 3) for b in downbeats],
        "sections": sections,
        "fps": FPS,
        "features": {
            "rms": envelope(y, n),
            "low": envelope(band(y, None, 200), n),
            "mid": envelope(band(y, 200, 2000), n),
            "high": envelope(band(y, 2000, None), n),
            "drums": envelope(stems["drums"], n),
            "other": envelope(stems["other"], n),
            "bass": envelope(stems["bass"], n),
            "vocal": envelope(stems["vocal"], n),
        },
        "wave": waveform(y, n),
        "spectrum": spectrum(y, n),
        "onsets": {"kick": kick, "snare": snare, "hat": hat, "vocal": vocal},
        "notes": f"reel analyze on {song.name}: {how}" + (f", placed at {off} s" if off else ""),
    }
    if prev:
        if "track" in prev:
            doc["track"] = prev["track"]
    else:
        # (a plain file name: the preview fetches it by URL, where '#', '?' and '%' would break it)
        dest = ROOT / "audio" / re.sub(r"[^A-Za-z0-9._-]+", "-", song.name)
        if dest.resolve() != song:
            dest.parent.mkdir(exist_ok=True)
            shutil.copyfile(song, dest)
        doc["track"] = f"audio/{dest.name}"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"{out.relative_to(ROOT)}: {bpm:.2f} BPM, {len(beats)} beats, {len(downbeats)} bars, "
          f"{len(kick)} kick / {len(snare)} snare / {len(hat)} hat / {len(vocal)} vocal onsets, sections: {', '.join(s['name'] for s in sections)}")


if __name__ == "__main__":
    main()
