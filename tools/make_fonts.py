# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools>=4.50"]
# ///
"""Static font instances for the renderer -> public/fonts/

    uv run tools/make_fonts.py

Canvas2D and opentype.js need static outlines, so the variable fonts in public/fonts/src/ are cut into the
width x weight instances src/engine/type.ts registers (Archivo widths 62-125 x weights 300-900, two italic
widths, Cormorant 400/600). Rerun after replacing a source font or changing the instances; keep the lists
here and in type.ts (ARCHIVO_WIDTHS, ARCHIVO_WEIGHTS, DEFS) in step. From upstream's analysis/make_fonts.py.
"""
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONTS = Path(__file__).resolve().parent.parent / "public/fonts"
SRC = FONTS / "src"

jobs = []
for wd in [62, 75, 87.5, 100, 112.5, 125]:
    for wt in [300, 500, 700, 900]:
        jobs.append(("Archivo[wdth,wght].ttf", {"wdth": wd, "wght": wt}, f"Archivo-w{int(wd * 10)}-{wt}.ttf"))
for wd in [75, 100]:
    for wt in [400, 800]:
        jobs.append(("Archivo-Italic[wdth,wght].ttf", {"wdth": wd, "wght": wt}, f"ArchivoItalic-w{int(wd * 10)}-{wt}.ttf"))
for wt in [400, 600]:
    jobs.append(("CormorantGaramond[wght].ttf", {"wght": wt}, f"Cormorant-{wt}.ttf"))
    jobs.append(("CormorantGaramond-Italic[wght].ttf", {"wght": wt}, f"CormorantItalic-{wt}.ttf"))

for src, loc, name in jobs:
    inst = instancer.instantiateVariableFont(TTFont(SRC / src), loc, updateFontNames=False)
    inst.save(FONTS / name)
print(len(jobs), "instances in", FONTS)
