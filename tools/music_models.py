# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "beat-this==1.1.0",
#   "torch>=2.6",
#   "torchaudio>=2.6",
#   "soundfile>=0.13",
#   "demucs-mlx==1.6.1; sys_platform == 'darwin' and platform_machine == 'arm64'",
#   "demucs==4.1.0; sys_platform != 'darwin' or platform_machine != 'arm64'",
#   "numpy>=2.0",
# ]
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# [tool.uv.sources]
# torch = [{ index = "pytorch-cpu", marker = "sys_platform == 'linux'" }]
# torchaudio = [{ index = "pytorch-cpu", marker = "sys_platform == 'linux'" }]
# ///
"""The models behind `reel analyze` (tools/analyze.py runs this unless --fast):

    uv run tools/music_models.py <song> <out folder>
    uv run tools/music_models.py --cached     (exits 0 when both models are on disk, so a run fetches nothing)

Writes <out>/beats.json ({"beats", "downbeats"} in seconds, from Beat This!, Foscarin, Schlüter and Widmer,
ISMIR 2024, checkpoint final0, without DBN post-processing) and <out>/{drums,bass,other,vocals}.wav, stems
separated by Demucs (htdemucs): through demucs-mlx on Apple Silicon, through the reference PyTorch demucs elsewhere
(on Linux with PyTorch's CPU wheels, which install anywhere without CUDA's gigabytes; a 3-minute song takes a
few minutes on four cores). Models are fetched on first use: the Beat This! checkpoint (81 MB, into torch hub's
cache; from the authors' server, else the mirror one of them hosts, checked against the MD5 they published) and the
htdemucs weights (about 80 MB, into ~/.cache/demucs-mlx or torch hub's cache, checked by demucs).
"""
import hashlib
import json
import os
import platform
import subprocess
import sys
import tempfile
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


def have_checkpoint() -> Path | None:
    import torch

    f = Path(torch.hub.get_dir()) / "checkpoints" / CKPT
    return f if f.exists() and hashlib.md5(f.read_bytes()).hexdigest() == CKPT_MD5 else None


def checkpoint() -> Path:
    import torch

    if f := have_checkpoint():
        return f
    d = Path(torch.hub.get_dir()) / "checkpoints"
    f = d / CKPT
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
        except Exception as e:
            errors.append(f"{url}: {e}")
    sys.exit("music_models: could not fetch the Beat This! checkpoint:\n  " + "\n  ".join(errors) + "\n(reel analyze --fast works without it)")


def mlx():
    return sys.platform == "darwin" and platform.machine() == "arm64"


def cached():
    import torch

    hub = Path(torch.hub.get_dir()) / "checkpoints"
    if not have_checkpoint():
        return False
    if mlx():
        from demucs_mlx.model_converter import get_mlx_cache_dir

        return all((get_mlx_cache_dir() / f).exists() for f in ("htdemucs.safetensors", "htdemucs_config.json"))
    return any(hub.glob("955717e8-*.th"))


def separate(song):
    """{stem: (channels, samples)} and the sample rate, from htdemucs."""
    if mlx():
        from demucs_mlx import Separator

        sep = Separator(model="htdemucs", seed=0)
        _, stems = sep.separate_audio_file(song)
        return stems, sep.samplerate

    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    model = get_model("htdemucs")
    model.eval()
    sr = model.samplerate
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "song.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-i", song, "-ac", str(model.audio_channels), "-ar", str(sr), "-c:a", "pcm_f32le", wav], check=True)
        x, _ = sf.read(wav, dtype="float32", always_2d=True)
    mix = torch.from_numpy(x.T.copy())
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    torch.manual_seed(0)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    with torch.no_grad():
        y = apply_model(model, ((mix - mean) / std)[None], device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
    y = y * std + mean
    return {name: y[i].cpu().numpy() for i, name in enumerate(model.sources)}, sr


def main():
    if sys.argv[1:] == ["--cached"]:
        sys.exit(0 if cached() else 1)
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    song, out = sys.argv[1], Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)

    import torch
    from beat_this.inference import File2Beats

    device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    beats, downbeats = File2Beats(checkpoint_path=str(checkpoint()), device=device, dbn=False)(song)
    json.dump({"beats": [float(x) for x in beats], "downbeats": [float(x) for x in downbeats]}, open(out / "beats.json", "w"))

    stems, sr = separate(song)
    for name, a in stems.items():
        sf.write(out / f"{name}.wav", np.asarray(a, dtype=np.float32).T, sr, subtype="FLOAT")
    print(f"music_models: {len(beats)} beats, {len(downbeats)} downbeats, stems {', '.join(stems)}", file=sys.stderr)


if __name__ == "__main__":
    main()
