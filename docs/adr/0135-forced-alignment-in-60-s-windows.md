# Long takes are force-aligned in overlapping 60 s windows

Qwen3-ForcedAligner drifts on long audio. On a 220 s take, 60 s windows hold and 150 s windows drift by seconds, so `WINDOW` defaults to 60 in `tools/forced_align.py`. In `align`, each window starts half a second before the last `CONTEXT` (5) words placed; those words are aligned again as context and not kept. It is given about as many new words as its length holds at the take's average rate, times `OVER` (1.3), and at least 20. It keeps only the words that end more than `EDGE` (8) seconds before its end, except in the last window.

The aligner keeps one token per word that has a letter or a digit. `align` filters the text the same way before it windows, so the word counts line up with what comes back.
