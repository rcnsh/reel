# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["librosa>=0.11", "numpy>=2.0", "scipy>=1.13"]
# ///
"""Music analysis -> data/audio.json, for videos cut to a song.

    uv run tools/analyze.py <song> [--sections sections.json] [--keep-sections] [--offset 0] [--free-tempo]
                                   [--onset-delta 0.5,0.4,0.25]

Writes what the engine's audio helpers read (AudioData: beatAt, barAt, env, hit, f.a, f.beat, ...):

  * a beat grid: librosa's beat tracker, then (unless --free-tempo) one constant tempo fitted through it,
    which is what produced music has and what cuts snap to cleanly, its phase moved onto the strong kicks;
  * downbeats, bars of 4 beats: kicks on 1 and 3 against snares on 2 and 4 pick the pair of phases, then
    the one with more low end and more harmonic change (chords move on the bar line) is the one;
  * 100 fps envelopes, each normalised to 0..1 at its 99th percentile, with a fast-attack, slower-release
    follower: rms, low (<200 Hz), mid (200 Hz-2 kHz), high (>2 kHz) of the mix; drums (percussive part),
    other (harmonic part), bass (harmonic <200 Hz) and vocal (harmonic 300 Hz-3.4 kHz) from a
    harmonic/percussive split. The last three are proxies, not separated stems;
  * kick / snare / hat onsets from the percussive part (low, mid and high bands), and vocal onsets from the
    harmonic 300 Hz-3.4 kHz band (a proxy like the vocal envelope), strengths 0..1; raise a
    band's --onset-delta (peak-picking threshold) if it fires on other instruments, lower it if it misses;
  * sections: from --sections (a JSON list of {"name", "bar"} or {"name", "start"} in seconds, in order),
    else kept from the existing data/audio.json with --keep-sections (a narrated video with a music bed),
    else found by structural segmentation and named part1, part2, ... on downbeats.

The timeline shows each section with the scene of the same name, so name sections after your scenes.
Without --keep-sections the song becomes the video's sound: it is copied to audio/ and data/audio.json
names it as the `track` the preview plays and the export muxes. With --keep-sections the track, duration and
sections stay as they were and --offset places the song's start on the video's timeline (where the mix lays it).
"""
import argparse
import json
import math
import re
import shutil
import sys
from pathlib import Path

import librosa
import numpy as np
from scipy.signal import butter, sosfiltfilt

ROOT = Path(__file__).resolve().parent.parent
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


def norm01(x, pct=99.0):
    top = np.percentile(x, pct)
    return np.clip(x / top, 0, 1) if top > 1e-9 else np.zeros_like(x)


def envelope(x, n):
    return [round(float(v), 3) for v in follow(norm01(frame_rms(x, n)))]


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


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("song")
    ap.add_argument("--sections", help="JSON list of {name, bar} or {name, start}")
    ap.add_argument("--keep-sections", action="store_true", help="keep track, duration and sections of the existing data/audio.json")
    ap.add_argument("--offset", type=float, default=0.0, help="video time the song starts at (with --keep-sections)")
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

    harm, perc = librosa.effects.hpss(y)
    bpm, beats = beat_grid(y, duration, a.free_tempo)
    # (a free-tempo grid from a shifted song starts at its first beat; a fitted one extends back to 0)
    dk, ds, dh = (float(x) for x in a.onset_delta.split(","))
    kick = onsets(band(perc, None, 150), delta=dk, min_gap=0.10)
    snare = onsets(band(perc, 150, 2500), delta=ds, min_gap=0.10)
    hat = onsets(band(perc, 6000, None), delta=dh, min_gap=0.05)
    vocal = onsets(band(harm, 300, 3400), delta=0.3, min_gap=0.12)
    beats = refine_phase(beats, kick, a.free_tempo, duration)
    p = downbeat_phase(y, harm, beats, kick, snare)
    downbeats = beats[p::4]

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
        "time_signature": 4,
        "beats": [round(b, 3) for b in beats],
        "downbeats": [round(b, 3) for b in downbeats],
        "sections": sections,
        "fps": FPS,
        "features": {
            "rms": envelope(y, n),
            "low": envelope(band(y, None, 200), n),
            "mid": envelope(band(y, 200, 2000), n),
            "high": envelope(band(y, 2000, None), n),
            "drums": envelope(perc, n),
            "other": envelope(harm, n),
            "bass": envelope(band(harm, None, 200), n),
            "vocal": envelope(band(harm, 300, 3400), n),
        },
        "onsets": {"kick": kick, "snare": snare, "hat": hat, "vocal": vocal},
        "notes": f"tools/analyze.py on {song.name}" + (f", placed at {off} s" if off else ""),
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
    out.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"{out.relative_to(ROOT)}: {bpm:.2f} BPM, {len(beats)} beats, {len(downbeats)} bars, "
          f"{len(kick)} kick / {len(snare)} snare / {len(hat)} hat / {len(vocal)} vocal onsets, sections: {', '.join(s['name'] for s in sections)}")


if __name__ == "__main__":
    main()
