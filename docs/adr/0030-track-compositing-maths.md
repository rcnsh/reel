# Track grades and blends work on unpremultiplied colour by the W3C formula

`src/engine/tracks.ts` composites tracks in premultiplied linear HDR, with these choices:

- `TrackFx` unpremultiplies the colour before grading and premultiplies it again afterwards, because contrast (a power curve around linear 0.18) is not linear in the colour, so grading premultiplied values would change edges and soft alpha.
- `BlendPass` blends `top` over `base` by the W3C compositing formula: `Cs·(1-αb) + Cb·(1-αs) + αs·αb·B(Cb, Cs)`, with `α = αs + αb - αs·αb`, `B` being the mode's blend function on unpremultiplied colour.
- `opacityOf` accepts a track opacity up to 64, not 1, because above 1 an opacity strengthens an `add` or `screen` blend.
