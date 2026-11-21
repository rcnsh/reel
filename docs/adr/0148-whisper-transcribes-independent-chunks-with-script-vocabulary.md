# Whisper transcribes independent chunks, primed with the script's vocabulary

`tools/whisper_words.py` transcribes each recording in chunks of about `CHUNK` seconds (24 by default). Each cut falls in the quietest 0.3 s window within 6 s before a chunk boundary (`chunks`). Each chunk is transcribed on its own, with `condition_on_previous_text=False`. In one pass over the whole file, a mishearing carries forward and squashes later lines; chunks contain it. The initial prompt is the script's vocabulary: words with digits or capitals, each once (`vocabulary`), so names and figures come back spelled as the script spells them.

Whisper splits figures into tokens such as "152" ",000" and "2" ".06". `joinFigures` in `tools/align.ts` joins them back into one word before matching.
