# Subtitle line breaks never leave an empty line

An empty line ends a cue in an SRT file. So `breakLines` in `tools/subtitles.ts` never returns one. A single word too long for a line stays whole, except CJK text, which has no spaces and breaks between characters.
