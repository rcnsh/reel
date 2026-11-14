# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "beat-this==1.1.0",
#   "torch>=2.6",
#   "torchaudio>=2.6",
#   "soundfile>=0.13",
#   "demucs-mlx==1.6.1",
#   "numpy>=2.0",
# ]
# ///
"""The models behind `reel analyze` (tools/analyze.py runs this unless --fast):

    uv run tools/music_models.py <song> <out folder>

Writes <out>/beats.json ({"beats", "downbeats"} in seconds, from Beat This!, Foscarin, Schlüter and Widmer,
ISMIR 2024, checkpoint final0, without DBN post-processing) and <out>/{drums,bass,other,vocals}.wav, stems
separated by Demucs (htdemucs) through demucs-mlx on Apple Silicon. Models are fetched on first use: the Beat This!
checkpoint (81 MB, into torch hub's cache; from the authors' server, else the mirror one of them hosts, checked
against the MD5 they published) and the htdemucs weights (160 MB, into ~/.cache/demucs-mlx, checked by demucs-mlx).
"""
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

CKPT = "beat_this-final0.ckpt"
CKPT_MD5 = "9fdf5e3f69b9996870e7aecd69527b08"
CKPT_URLS = [
    "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt",
    "https://f0k.de/pubs/2024_ismir/beat_this-final0.ckpt",
]


def checkpoint() -> Path:
    import torch

    d = Path(torch.hub.get_dir()) / "checkpoints"
    f = d / CKPT
    if f.exists() and hashlib.md5(f.read_bytes()).hexdigest() == CKPT_MD5:
        return f
    d.mkdir(parents=True, exist_ok=True)
    errors = []
    for url in CKPT_URLS:
        try:
            print(f"music_models: fetching the Beat This! checkpoint from {url.split('/')[2]}", file=sys.stderr)
            data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "reel-analyze"}), timeout=120).read()
            if hashlib.md5(data).hexdigest() != CKPT_MD5:
                raise ValueError("MD5 does not match the published one")
            tmp = f.with_suffix(".part")
            tmp.write_bytes(data)
            os.replace(tmp, f)
            return f
        except Exception as e:  # (the next source)
            errors.append(f"{url}: {e}")
    sys.exit("music_models: could not fetch the Beat This! checkpoint:\n  " + "\n  ".join(errors) + "\n(reel analyze --fast works without it)")


def main():
    song, out = sys.argv[1], Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)

    import torch
    from beat_this.inference import File2Beats

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    beats, downbeats = File2Beats(checkpoint_path=str(checkpoint()), device=device, dbn=False)(song)
    json.dump({"beats": [float(x) for x in beats], "downbeats": [float(x) for x in downbeats]}, open(out / "beats.json", "w"))

    from demucs_mlx import Separator

    sep = Separator(model="htdemucs", seed=0)
    _, stems = sep.separate_audio_file(song)
    for name, a in stems.items():
        sf.write(out / f"{name}.wav", np.asarray(a, dtype=np.float32).T, sep.samplerate, subtype="FLOAT")
    print(f"music_models: {len(beats)} beats, {len(downbeats)} downbeats, stems {', '.join(stems)}", file=sys.stderr)


if __name__ == "__main__":
    main()
