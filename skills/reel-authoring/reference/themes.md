# Themes

A project picks its look with `theme` in `reel.config.ts`; `--theme <name>` swaps in a built-in one for a single command (handy to compare). A theme is plain data: a palette, default post-processing and an optional overlay.

## Built-in themes

- `print`: ink on paper (`bg` paper, `fg` ink, `accent` signal red); no glow, faint grain, vignette and chromatic aberration.
- `film`: the same inks the other way round (`bg` ink, `fg` bone); a dark grade with bloom, red-orange halation, aberration, heavy grain and vignette, and crop marks over everything (its overlay).
- `neutral` (the default): greys (`bg`, `fg`, `surface`, `muted`, `line`) and one blue `accent`; no grain, vignette, aberration or overlay.

`print` and `film` add `ink`, `ink2`, `graphite`, `ash`, `bone`, `paper`, `rule`, `signal`, `ember`, `blood`.

## The palette

- Every palette has `bg`, `fg` and `accent`, plus `accentHi` and `accentLo` (a lighter and a darker accent; derived from `accent` when a theme leaves them out). The engine's own colours come from these: the flash (the lighter of `bg` and `fg`), `invert` (swaps `bg` and `fg`), the heat ramp and the spark.
- Write scenes against those keys and they follow any theme; a theme's own keys tie a scene to that theme.
- In code: `C_<KEY>` in GLSL (camelCase becomes `C_ACCENT_HI`), `LIN.<key>` (linear RGB triplet for uniforms), `rgba('<key>', alpha)` (CSS for Canvas2D; also takes a `#rrggbb`). A key the palette lacks throws in `LIN` and `rgba` and fails to compile in GLSL; either fails the command.
- `THEME` (from `reel`): the resolved theme, `THEME.name`, `THEME.palette` (hex per key). `TONE.light` / `TONE.dark` say which of `bg` and `fg` is the light one.

## A theme of your own

```ts
import { defineVideo, extendTheme } from 'reel/config';
export default defineVideo({
  theme: extendTheme('print', { palette: { accent: '#1F6F5C', note: '#E8D9A8' }, post: { grain: 0 }, overlay: { marks: true, fly: 0 } }),
  timeline: () => [/* … */],
});
```

`extendTheme(base, over)` merges palette and post over the base's and replaces the overlay when given; a new `accent` without its own `accentHi`/`accentLo` gets them derived from it. A theme object written out in full is `{ palette, post?, overlay? }`. Palette values are `#rrggbb`, `#rgb` or another key's name; keys are identifiers starting with a lowercase letter. The theme is checked when a command starts: a bad colour, a loop of names, an unknown post parameter or overlay key is an error that names it.

## Post-processing

A scene's `render()` may return overrides; a clip's `post` sets defaults while it shows; the theme's `post` is the base (over the neutral defaults: no glow, grain, vignette or aberration). Parameters: `exposure`, `bloom`, `bloomThreshold`, `bloomKnee`, `bloomRadius`, `halation`, `ca` (chromatic aberration, px at the edge), `grain`, `vignette`, `fade` (to black), `flash` (in the theme's light colour), `shake: [x, y]` (px), `zoom` (punch-ins), `invert` (swaps `bg` and `fg`). Another theme's grade for one scene: `return { ...themes.film.post, bloom: 0.8 }` (`themes` from `reel`).

## The overlay

A theme's `overlay` is the HUD scene's params (`marks`, `fly`, `caption`, `tone`; toolbox.md). The engine places it over the whole video as a clip called `overlay` on a track above every other and loads it with any `--only`; a clip of your own cannot be called `overlay`.
