# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "mlx-audio==0.6.5; sys_platform == 'darwin' and platform_machine == 'arm64'",
#   "kokoro==0.9.4; sys_platform != 'darwin' or platform_machine != 'arm64'",
#   "misaki[en]==0.9.4",
#   "torch>=2.6; sys_platform == 'linux'",
#   "soundfile>=0.13",
#   "en-core-web-sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
# ]
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# [tool.uv.sources]
# torch = [{ index = "pytorch-cpu", marker = "sys_platform == 'linux'" }]
# ///
"""Kokoro-82M text to speech, with word times from its duration predictor: through MLX on Apple Silicon, through
the reference PyTorch package elsewhere (CPU wheels on Linux).

    uv run tools/voices/kokoro_tts.py <jobs.json>

jobs.json: {"voice": "af_heart", "items": [{"text", "speed", "out": <wav path>}]}. Each item writes its WAV
(24 kHz mono) and <out>.json, a list of {"w", "start", "end"} for the tokens Kokoro spoke (punctuation tokens left
out). The voice's first letter is its language: a American English, b British English. The model (about 350 MB)
comes from Hugging Face on first use.
"""
import json
import platform
import sys

import numpy as np
import soundfile as sf

SR = 24000
APPLE = sys.platform == "darwin" and platform.machine() == "arm64"


def pipeline(lang):
    if APPLE:
        from mlx_audio.tts.models.kokoro import KokoroPipeline
        from mlx_audio.tts.utils import load_model

        repo = "mlx-community/Kokoro-82M-bf16"
        return KokoroPipeline(lang_code=lang, model=load_model(repo), repo_id=repo)
    from kokoro import KPipeline

    return KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")


def main():
    jobs = json.load(open(sys.argv[1]))
    voice = jobs["voice"]
    if voice[:1] not in "ab":
        sys.exit(f"kokoro: voice '{voice}': only English voices (a…, b…) are supported, e.g. af_heart, am_michael, bf_emma, bm_george")
    pipe = pipeline(voice[0])
    for it in jobs["items"]:
        audio, words, off = [], [], 0.0
        for r in pipe(it["text"], voice=voice, speed=float(it["speed"]), split_pattern=None):
            for t in r.tokens or []:
                if t.start_ts is not None and t.end_ts is not None and any(c.isalnum() for c in t.text):
                    words.append({"w": t.text, "start": round(off + t.start_ts, 4), "end": round(off + t.end_ts, 4)})
            a = np.asarray(r.audio, dtype=np.float32).reshape(-1)
            audio.append(a)
            off += len(a) / SR
        if not audio:
            sys.exit(f"kokoro: nothing spoken for: {it['text'][:80]}")
        sf.write(it["out"], np.concatenate(audio), SR, subtype="PCM_16")
        json.dump(words, open(it["out"] + ".json", "w"))
    print(f"kokoro: {len(jobs['items'])} passage(s) as {voice}", file=sys.stderr)


if __name__ == "__main__":
    main()
