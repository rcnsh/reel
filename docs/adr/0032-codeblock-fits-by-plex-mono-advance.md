# CodeBlock fits its font by IBM Plex Mono's fixed advance

`CodeBlock` in `src/kit/code.ts` always sets code in IBM Plex Mono, whose advance is 0.6 em for every character. The constructor computes the font size that fits the longest line (plus line numbers) across the box as `width / (longest * 0.6 + 0.5)`, alongside the size that fits every line in its height, without measuring any text. No line wraps (`white-space: pre`). The 0.6 is a property of the font: changing the family means changing the factor.
