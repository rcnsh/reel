
import os, re, sys, json, wave, numpy as np
from faster_whisper import WhisperModel

SR = 16000
CHUNK = float(os.environ.get("CHUNK", 24))


def vocabulary(script):
    """Words with digits or capitals, each once, in script order, as Whisper's prompt."""
    seen, vocab = set(), []
    for t in script.split():
        t = t.strip(".,;:!?\"'()")
        if t and (re.search(r"\d", t) or t[0].isupper()) and t.lower() not in seen:
            seen.add(t.lower()); vocab.append(t)
    return " ".join(vocab)[:600] or None


def chunks(a):
    """Cut points: the quietest 0.3 s window within 6 s before each CHUNK boundary."""
    hop = int(0.05 * SR)
    rms = np.sqrt(np.convolve(a ** 2, np.ones(hop) / hop, mode="same")[::hop] + 1e-12)
    win = int(0.3 * SR / hop)
    quiet = np.convolve(rms, np.ones(win) / win, mode="same")
    cuts, t = [0.0], CHUNK
    dur = len(a) / SR
    while t < dur - 4:
        lo, hi = int((t - 6) * SR / hop), int(t * SR / hop)
        k = lo + int(np.argmin(quiet[lo:hi]))
        cuts.append(k * hop / SR)
        t = cuts[-1] + CHUNK
    cuts.append(dur)
    return cuts


def transcribe(m, path, script):
    with wave.open(path) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    prompt, cuts, out = vocabulary(script), chunks(a), []
    for c0, c1 in zip(cuts, cuts[1:]):
        seg = a[int(c0 * SR):int(c1 * SR)]
        segs, _ = m.transcribe(seg, word_timestamps=True, initial_prompt=prompt, condition_on_previous_text=False)
        for s in segs:
            for x in s.words:
                out.append({"w": x.word.strip(), "s": round(c0 + x.start, 3), "e": round(c0 + x.end, 3)})
    return out, len(cuts) - 1


jobs = json.load(open(sys.argv[1]))
m = WhisperModel("small.en", device="cpu", compute_type="int8")
for j in jobs:
    words, n = transcribe(m, j["audio"], j.get("script", ""))
    with open(j["out"], "w") as f:
        json.dump(words, f)
    print(f"whisper: {os.path.basename(j['audio'])}: {n} chunks, {len(words)} words", file=sys.stderr)
