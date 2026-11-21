# The spectrum's top level is at least the loudest moment less 30 dB

`spectrum` in `tools/analyze.py` scales band levels to 0..1 over the 60 dB below a top level. The top is the 99.5th percentile of the band levels, but never less than the loudest level minus 30 dB. Without that floor, a short sound in a long silence would put the silence at the top of the range. So would a bed placed with `--offset`, which is silent until it enters. A silent track (everything under -100 dB) stays at 0.
