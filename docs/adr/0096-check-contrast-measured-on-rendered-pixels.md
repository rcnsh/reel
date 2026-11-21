# Check measures text contrast on the rendered pixels

`measureText` (`src/check.ts`) reads the background from a ring just outside the text box (and the box's pixels that look unlike the text), and the text from the box's pixels nearest the colour the scene reported, taking the closer half as its solid core. Measuring the final frame this way puts grading, opacity and post-processing into the number, rather than trusting the colours a scene asked for.

`findingsOf` measures only boxes that can be measured: one smaller than a glyph (under half the font size wide or 0.3 of it tall, such as a word's first stroke) is too few pixels, and text under 0.9 opacity is fading in or out, where low contrast is meant.
