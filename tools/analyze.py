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
    tracker missed in breaks and puts every beat between its frames, then moved onto the drum stem's hits;
    otherwise (a drift, a live tempo) each beat sits on a line through its neighbours, which follows the tempo,
    and moves onto a kick or snare within 30 ms (where drums mark the beats). --free-tempo keeps the tracked beats
    as they are. The bar length and the downbeat's place in it are what most of the tracked downbeats agree on;
  * 100 fps envelopes, each normalised to 0..1 at its 99th percentile, with a fast-attack, slower-release
    follower: rms, low (<200 Hz), mid (200 Hz-2 kHz) and high (>2 kHz) of the mix, and drums, bass, other and
    vocal from stems separated by Demucs (htdemucs through demucs-mlx);
  * kick / snare / hat onsets from the drum stem (low, mid and high bands) and vocal onsets from the vocal stem,
    strengths 0..1, each placed on its attack in the waveform; raise a band's --onset-delta (peak-picking
    threshold) if it fires on other sounds;
  * sections: from --sections (a JSON list of {"name", "bar"} or {"name", "start"} in seconds, in order),
    else kept from the existing data/audio.json with --keep-sections (a narrated video with a music bed),
    else found by structural segmentation and named part1, part2, ... on downbeats.

--fast skips the models (no download, seconds instead of tens of seconds): librosa's beat tracker with one
fitted tempo set on the kicks and a kick/snare heuristic for the bar phase, and harmonic/percussive proxies for
the stems. Good for drafts; one tempo loses its place where the tempo moves (--free-tempo follows it).
tests/analyze.test.ts checks both paths against tools/synth_song.py's songs.

The timeline shows each section with the scene of the same name, so name sections after your scenes.
Without --keep-sections the song becomes the video's sound: it is copied to audio/ and data/audio.json
names it as the `track` the preview plays and the export muxes. With --keep-sections the track, duration and
sections stay as they were and --offset places the song's start on the video's timeline (where the mix lays it).
"""
import argparse
import fcntl
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import librosa
import numpy as np
from scipy.fft import next_fast_len
from scipy.ndimage import median_filter, uniform_filter1d
from scipy.signal import butter, hilbert, sosfiltfilt

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


def norm01(x, pct=99.0):
    top = np.percentile(x, pct)
    return np.clip(x / top, 0, 1) if top > 1e-9 else np.zeros_like(x)


def envelope(x, n):
    return [round(float(v), 3) for v in follow(norm01(frame_rms(x, n)))]


def hpss(y, kernel=31):
    """librosa.effects.hpss (kernel 31, margin 1) with its two median filters run in threads over slices of the
    spectrogram (each slice whole along the filtered axis, so the result is the same to the bit): the filters
    are nearly all of its time, and single-threaded they took 7 s of a 4-minute song."""
    S, phase = librosa.magphase(librosa.stft(y))

    def med(size, axis):
        n = S.shape[1 - axis]
        cuts = np.linspace(0, n, min(n, os.cpu_count() or 1) + 1).astype(int)
        take = (lambda a, b: S[a:b]) if axis == 1 else (lambda a, b: S[:, a:b])
        with ThreadPoolExecutor() as ex:
            out = list(ex.map(lambda ab: median_filter(take(*ab), size=size, mode="reflect"), zip(cuts[:-1], cuts[1:])))
        return np.concatenate(out, axis=1 - axis)

    harm, perc = med((1, kernel), 1), med((kernel, 1), 0)
    mask = librosa.util.softmask(harm, perc, power=2, split_zeros=True)
    back = lambda m: librosa.istft((S * m) * phase, dtype=y.dtype, length=len(y))
    return back(mask), back(1.0 - mask)


def attack(x, times, before=0.04, after=0.02, smooth=0.005):
    """Each onset moved to the steepest rise of the band's amplitude (its Hilbert envelope, smoothed over 5 ms)
    from 40 ms before it to 20 ms after, and no further than halfway to its neighbours. The onset envelope's peaks come late by an amount that depends on the
    sound (its log-mel flux sees an attack frames after it starts; 14 to 18 ms on drums with librosa's
    framing), so peak picking finds the hits and the waveform says when they start."""
    if len(times) == 0:
        return np.array([])
    e = np.abs(hilbert(x, N=next_fast_len(len(x)))[: len(x)])
    slope = np.diff(uniform_filter1d(e, max(1, int(smooth * SR))))
    out = []
    for i, t in enumerate(times):
        lo = max(t - before, (times[i - 1] + t) / 2 if i else 0.0)
        hi = min(t + after, (t + times[i + 1]) / 2 if i + 1 < len(times) else t + after)
        i0, i1 = max(0, int(lo * SR)), min(len(slope), int(hi * SR))
        j = i0 + int(np.argmax(slope[i0:i1])) if i1 > i0 else -1
        out.append(j / SR if j >= 0 and slope[j] > 0 else t)  # (no rise in reach: left where it was found)
    return np.array(out)


def onsets(x, delta, min_gap):
    """Onset times (on the waveform: attack()) and 0..1 strengths (dB of the onset envelope, 5th-95th percentile)."""
    hop = 256
    env = librosa.onset.onset_strength(y=x, sr=SR, hop_length=hop)
    fr = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=hop, delta=delta, wait=int(min_gap * SR / hop), backtrack=False)
    if len(fr) == 0:
        return []
    db = 20 * np.log10(env[fr] + 1e-9)
    lo, hi = np.percentile(db, 5), np.percentile(db, 95)
    s = np.clip((db - lo) / max(hi - lo, 1e-6), 0, 1) * 0.8 + 0.2
    t = attack(x, librosa.frames_to_time(fr, sr=SR, hop_length=hop))
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


def drum_offset(beats, hits):
    """How far the hits (onsets) sit from the beats: the median offset of those within 60 ms of one (None under
    4). Every hit counts: strengths are relative, so on a song of even kicks a strength cut keeps a handful."""
    b = np.array(beats)
    d = [t - b[np.abs(b - t).argmin()] for t, _ in hits] if len(b) else []
    d = [x for x in d if abs(x) < 0.06]
    return float(np.median(d)) if len(d) >= 4 else None


def snap(beats, hits, tol=0.03):
    """Each beat moved onto the kick or snare hit within 30 ms of it, if there is one: for beats that follow the
    tempo, which are only as good as the tracker's around them (its first beats come a frame or two later than the
    rest, and the smoothing line leans on the beats it tracked in a lead-in)."""
    b = np.array(beats, dtype=float)
    ht = np.sort(np.array([t for t, _ in hits], dtype=float))
    if not len(ht) or not len(b):
        return b
    j = np.searchsorted(ht, b)
    lo, hi = ht[np.clip(j - 1, 0, len(ht) - 1)], ht[np.clip(j, 0, len(ht) - 1)]
    near = np.where(np.abs(lo - b) <= np.abs(hi - b), lo, hi)
    return np.where(np.abs(near - b) < tol, near, b)


def shifted(times, shift, duration):
    return [float(x + shift) for x in times if 0 <= x + shift < duration]


def drum_shift(beats, kick, snare):
    """drum_offset of the kicks, else (too few near a beat) of the snares, else None."""
    shift = drum_offset(beats, kick)
    return shift if shift is not None else drum_offset(beats, snare)


def refine_phase(beats, kick, snare, free, duration):
    """Move the beats onto the drums (drum_shift): a fitted grid is laid again from its shifted phase, tracked
    beats all move by it. librosa's beats come 30 ms or so late; onsets() puts the drums on their attacks."""
    shift = drum_shift(beats, kick, snare)
    if shift is None:
        return beats
    b = np.array(beats)
    if free:
        return shifted(b, shift, duration)
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
    """The bar phase (of 4) on the one: the phase with most kick and least snare on its beats and the one two beats
    on are the candidates (kicks on 1 and 3 with snares on 2 and 4 leave them level; a half-time snare on 3 keeps 1
    ahead), and low-end energy and harmonic change at the beat choose between them."""
    if len(beats) < 4:
        return 0
    k, s = at_beats(kick, beats), at_beats(snare, beats)
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
    drums = [(k - s)[p::4].mean() for p in range(4)]
    p0 = int(np.argmax(drums))
    score = lambda p: drums[p] + n01(low)[p::4].mean() + n01(nov)[p::4].mean()
    return max((p0, (p0 + 2) % 4), key=score)


def auto_sections(y, beats, downbeats, duration):
    """Structural segmentation (chroma + MFCC averaged over each beat, agglomerative), boundaries snapped to
    downbeats. Clustering beats rather than frames keeps it quick on a long song (it grows with the square)."""
    hop = 512
    feat = np.vstack([
        librosa.util.normalize(librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=hop), axis=0),
        librosa.util.normalize(librosa.feature.mfcc(y=y, sr=SR, hop_length=hop, n_mfcc=13), axis=1),
    ])
    edges = librosa.util.fix_frames(librosa.time_to_frames(beats, sr=SR, hop_length=hop), x_min=0, x_max=feat.shape[1])
    feat = librosa.util.sync(feat, edges, aggregate=np.mean)
    k = int(np.clip(round(duration / 25), 2, 12))  # about one section per 25 s
    k = min(k, feat.shape[1])
    bounds = librosa.frames_to_time(edges[librosa.segment.agglomerative(feat, k)], sr=SR, hop_length=hop)
    db = np.array(downbeats) if downbeats else np.array([0.0])
    starts = sorted({0.0} | {float(db[np.abs(db - b).argmin()]) for b in bounds[1:]})
    return [{"name": f"part{i + 1}", "start": s} for i, s in enumerate(starts)]


def load_on_timeline(path, lead, n_samples):
    """A file's mono samples at SR, shifted by `lead` samples and cut or padded to n_samples."""
    x, _ = librosa.load(path, sr=SR, mono=True)
    x = np.concatenate([np.zeros(max(lead, 0)), x[max(-lead, 0):]])[:n_samples]
    return np.pad(x, (0, max(0, n_samples - len(x))))


def take_turns():
    """Holds a lock (in the user's own runtime or cache folder) until the process exits. librosa's numba functions
    cache their compiled code beside the package (in the user's uv cache), and two processes compiling at once leave
    a cache on which every later run segfaults, so a user's analyses take turns at the librosa work (a warm run
    holds it a second or two)."""
    d = Path(os.environ.get("XDG_RUNTIME_DIR") or Path.home() / ".cache" / "reel")
    d.mkdir(parents=True, exist_ok=True)
    f = open(d / "reel-analyze.lock", "a")
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("analyze: waiting for another analysis to finish", file=sys.stderr)
        fcntl.flock(f, fcntl.LOCK_EX)
    return f


def run_models(song, work):
    """Beat This! beats and Demucs stems (tools/music_models.py in its own environment)."""
    script = Path(__file__).with_name("music_models.py")
    r = subprocess.run(["uv", "run", "-q", str(script), str(song), str(work)])
    if r.returncode != 0:
        sys.exit("analyze: the models failed (see above); --fast analyses without them")
    return json.loads((Path(work) / "beats.json").read_text())


def follow_beats(beats, free, duration):
    """Tracked beats as a constant-tempo grid where they keep one tempo (a residual under 20 ms), else each on a
    line fitted through its neighbours (smooth_beats()); either fills the beats the tracker missed. With --free-tempo
    the tracked beats as they are. Returns the beats and which of those it is: "grid", "followed" or "tracked"."""
    b = np.array(beats, dtype=float)
    if len(b) < 8:
        sys.exit("analyze: too few beats found; is this music?")
    # beat indices from the intervals (a gap of two periods is a missed beat)
    d = np.diff(b)
    idx = np.r_[0, np.cumsum(np.maximum(1, np.round(d / np.median(d))))]
    if free:
        return b, "tracked"
    period, phase = np.polyfit(idx, b, 1)
    res = b - (phase + period * idx)
    inl = np.abs(res) < 0.05
    if inl.sum() >= 8:
        period, phase = np.polyfit(idx[inl], b[inl], 1)
        res = b[inl] - (phase + period * idx[inl])
        if np.sqrt(np.mean(res ** 2)) < 0.02:
            grid = phase + period * np.arange(idx[inl].min(), idx[inl].max() + 1)
            return grid[(grid >= 0) & (grid < duration)], "grid"
    out = smooth_beats(idx, b)
    return out[(out >= 0) & (out < duration)], "followed"


# the most RMS a line through 7 tracked beats leaves where the tempo is smooth: their rounding to 20 ms frames
# leaves about 5 ms
SMOOTH = 0.007


def smooth_beats(idx, b, n=7):
    """Beats whose tempo moves (a drift, a live drummer). Beat This! places beats on 20 ms frames; where the tempo
    is smooth, a line through the n tracked beats nearest a beat (across a gap: the ones each side) fits them to
    within that rounding (an RMS of SMOOTH or less), and its time for the beat averages the rounding away, where
    one tempo for the whole song was up to 40 ms off a 6% drift. Where that line fits worse, the n beats before it
    or the n after it may fit (a sudden change of tempo, followed on each side of it). Where none fits, the tempo
    moves faster than a line follows (a live player's push and pull) and the tracked beat stays as it is. A beat
    the tracker missed takes the nearest line's time whatever its fit."""
    n = min(n, len(idx))

    def fit(w):
        m = np.zeros(len(idx), bool)
        m[w] = True
        # (the window's error is over all its beats: one whose line fits after dropping half of them is no fit)
        line = np.polyfit(idx[m], b[m], 1)
        err = float(np.sqrt(np.mean((b[m] - np.polyval(line, idx[m])) ** 2)))
        keep = m & (np.abs(b - np.polyval(line, idx)) < 0.03)
        if keep.sum() >= 3:
            line = np.polyfit(idx[keep], b[keep], 1)
        return line, err

    out = []
    for j in range(int(idx[0]), int(idx[-1]) + 1):
        line, err = fit(np.argsort(np.abs(idx - j), kind="stable")[:n])
        if err > SMOOTH:
            k = int(np.searchsorted(idx, j))  # (the first tracked beat at or after j)
            end = k + 1 if k < len(idx) and idx[k] == j else k  # (the before window: up to j, with j if tracked)
            lo = min(k, len(idx) - n)
            side = min((fit(np.arange(max(0, end - n), max(n, end))), fit(np.arange(lo, lo + n))), key=lambda f: f[1])
            if side[1] < err:
                line, err = side
        here = np.flatnonzero(idx == j)
        out.append(float(b[here[0]]) if len(here) and err > SMOOTH else float(np.polyval(line, j)))
    return np.array(out)


def bar_of(beats, downbeats):
    """Downbeats and meter where most tracked downbeats fall on the beats: the bar length is the commonest step
    between them, the phase the commonest place."""
    out = np.array(beats)
    on = [int(np.abs(out - t).argmin()) for t in downbeats if len(out) and np.abs(out - t).min() < 0.07]
    meter, ph = 4, 0
    if len(on) >= 2:
        steps = []
        for x, y in zip(on, on[1:]):
            st = y - x
            if 2 <= st <= 7:
                steps.append(st)
        meter = Counter(steps).most_common(1)[0][0] if steps else 4
        ph = Counter(i % meter for i in on).most_common(1)[0][0]
    return [float(x) for x in out[ph::meter]], meter


def percussion(bands, times, tol=0.035):
    """Percussion on each time: for each band given, the strongest onset within 35 ms of it, summed."""
    tot = np.zeros(len(times))
    for band_ in bands:
        if band_:
            tot += at_beats(band_, times, tol)
    return tot


def drums_on(beats, bands):
    """Whether drums mark the beats: they carry half as much percussion again as the quarter-beat points between
    them (steady sixteenth hats leave about twice). The onsets of a song without drums are peaks of a near-silent
    stem, as likely anywhere as on a beat."""
    b = np.asarray(beats, dtype=float)
    if len(b) < 4:
        return False
    q = np.median(np.diff(b)) / 4
    return percussion(bands, b).mean() > 1.5 * percussion(bands, np.r_[b - q, b + q]).mean()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("song")
    ap.add_argument("--sections", help="JSON list of {name, bar} or {name, start}")
    ap.add_argument("--keep-sections", action="store_true", help="keep track, duration and sections of the existing data/audio.json")
    ap.add_argument("--offset", type=float, default=0.0, help="video time the song starts at (with --keep-sections)")
    ap.add_argument("--fast", action="store_true", help="no models: librosa beats and harmonic/percussive proxies for the stems")
    ap.add_argument("--free-tempo", action="store_true", help="keep the tracked beats instead of fitting one tempo or, where it moves, smoothing them")
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
        turn = take_turns()
        harm, perc = hpss(y)
        bpm, beats = beat_grid(y, duration, a.free_tempo)
        # (a free-tempo grid from a shifted song starts at its first beat; a fitted one extends back to 0)
        kick = onsets(band(perc, None, 150), delta=dk, min_gap=0.10)
        snare = onsets(band(perc, 150, 2500), delta=ds, min_gap=0.10)
        hat = onsets(band(perc, 6000, None), delta=dh, min_gap=0.05)
        vocal = onsets(band(harm, 300, 3400), delta=0.3, min_gap=0.12)
        beats = refine_phase(beats, kick, snare, a.free_tempo, duration)
        p = downbeat_phase(y, harm, beats, kick, snare)
        downbeats = beats[p::4]
        stems = {"drums": perc, "other": harm, "bass": band(harm, None, 200), "vocal": band(harm, 300, 3400)}
        how = "librosa beats, harmonic/percussive proxies"
    else:
        with tempfile.TemporaryDirectory(prefix="reel-analyze-") as work:
            tracked = run_models(song, work)
            n_samples = len(y)
            stems = {k: load_on_timeline(Path(work) / f"{f}.wav", lead, n_samples) for k, f in [("drums", "drums"), ("bass", "bass"), ("other", "other"), ("vocal", "vocals")]}
        turn = take_turns()  # (after the models, which run for tens of seconds and need no turn)
        shift = lambda ts: [t + off for t in ts if 0 <= t + off < duration]
        beats, kind = follow_beats(shift(tracked["beats"]), a.free_tempo, duration)
        kick = onsets(band(stems["drums"], None, 150), delta=dk, min_gap=0.10)
        snare = onsets(band(stems["drums"], 150, 2500), delta=ds, min_gap=0.10)
        hat = onsets(band(stems["drums"], 6000, None), delta=dh, min_gap=0.05)
        vocal = onsets(stems["vocal"], delta=0.3, min_gap=0.12)
        # the tracker works in 20 ms frames and its beats come late by up to one: move them onto the drum stem's
        # hits (drum_shift), which measured more consistent on songs with known beats, where drums mark the beats
        # (--free-tempo keeps the tracked beats where they are)
        drums = kind != "tracked" and drums_on(beats, [kick, snare, hat])
        sh = (drum_shift(beats, kick, snare) or 0.0) if drums else 0.0
        beats = shifted(beats, sh, duration)
        if kind == "followed" and drums:
            beats = [float(x) for x in snap(beats, kick + snare)]
        downbeats, meter = bar_of(beats, [t + sh for t in shift(tracked["downbeats"])])
        bpm = 60.0 / float(np.median(np.diff(beats)))
        how = f"Beat This! beats ({ {'grid': 'one tempo', 'followed': 'following the tempo', 'tracked': 'as tracked'}[kind]}), Demucs stems"

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
        starts = auto_sections(y, beats, downbeats, duration)
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
