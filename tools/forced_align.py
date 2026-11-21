# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "mlx-qwen3-asr==0.4.4; sys_platform == 'darwin' and platform_machine == 'arm64'",
#   "qwen-asr==0.0.6; sys_platform != 'darwin' or platform_machine != 'arm64'",
#   "torch>=2.6; sys_platform == 'linux'",
#   "numpy>=2.0",
# ]
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# [tool.uv.sources]
# torch = [{ index = "pytorch-cpu", marker = "sys_platform == 'linux'" }]
# ///
"""Forced alignment of known text to speech: Qwen3-ForcedAligner-0.6B, through MLX on Apple Silicon and through the
Qwen team's PyTorch package elsewhere (CPU wheels on Linux, slower but the same model).

    uv run tools/forced_align.py <jobs.json>

jobs.json is a list of {"audio": <16 kHz mono wav>, "text": <what is said>, "out": <json path>}; each out gets a
list of {"w", "start", "end"}, one per token the aligner kept (the text split on spaces, punctuation removed).
The model (about 1.2 GB) is fetched from Hugging Face on first use into its normal cache. Audio longer than WINDOW
seconds is aligned in overlapping windows: each takes the words not yet placed and keeps those that end well
before its edge, with the last few words placed as context. LANGUAGE (default English) names the language for the aligner's tokenizer.
"""
import json
import os
import platform
import sys
import wave

import numpy as np

SR = 16000
WINDOW = float(os.environ.get("WINDOW", 60))
LANGUAGE = os.environ.get("LANGUAGE", "English")


def load(path):
    w = wave.open(path)
    if w.getframerate() != SR or w.getnchannels() != 1 or w.getsampwidth() != 2:
        sys.exit(f"forced_align: {path} must be 16 kHz mono 16-bit")
    return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768


def align(fa, audio, text):
    words = [w for w in text.split() if any(c.isalnum() for c in w)]
    dur = len(audio) / SR
    if dur <= WINDOW:
        return [{"w": x.text, "start": x.start_time, "end": x.end_time} for x in fa.align(audio, " ".join(words), LANGUAGE)]
    CONTEXT, EDGE, OVER = 5, 8.0, 1.3
    out, t0, i = [], 0.0, 0
    rate = len(words) / dur
    while i < len(words):
        t1 = min(dur, t0 + WINDOW)
        last = t1 >= dur
        ctx = min(CONTEXT, i)
        n = len(words) - i if last else max(20, int(rate * (t1 - t0) * OVER))
        chunk = words[i - ctx:i + n]
        got = fa.align(audio[int(t0 * SR):int(t1 * SR)], " ".join(chunk), LANGUAGE)[ctx:]
        keep = [x for x in got if last or x.end_time + t0 < t1 - EDGE] or got[:1]
        out += [{"w": x.text, "start": x.start_time + t0, "end": x.end_time + t0} for x in keep]
        i += len(keep)
        t0 = max(t0 + 1, out[max(0, len(out) - CONTEXT)]["start"] - 0.5)
    return out


def aligner():
    """An object whose align(audio, text, language) gives items with text, start_time and end_time."""
    if sys.platform == "darwin" and platform.machine() == "arm64":
        from mlx_qwen3_asr.forced_aligner import ForcedAligner

        return ForcedAligner()

    import torch
    from qwen_asr import Qwen3ForcedAligner

    class Torch:
        def __init__(self):
            gpu = torch.cuda.is_available()
            self.m = Qwen3ForcedAligner.from_pretrained("Qwen/Qwen3-ForcedAligner-0.6B", dtype=torch.bfloat16 if gpu else torch.float32, device_map="cuda:0" if gpu else "cpu")

        def align(self, audio, text, language):
            return self.m.align(audio=(audio, SR), text=text, language=language)[0]

    return Torch()


def main():
    jobs = json.load(open(sys.argv[1]))
    fa = aligner()
    for j in jobs:
        res = align(fa, load(j["audio"]), j["text"])
        json.dump([{"w": r["w"], "start": round(float(r["start"]), 3), "end": round(float(r["end"]), 3)} for r in res], open(j["out"], "w"))
    print(f"forced_align: {len(jobs)} passage{'s' if len(jobs) != 1 else ''} aligned", file=sys.stderr)


if __name__ == "__main__":
    main()
