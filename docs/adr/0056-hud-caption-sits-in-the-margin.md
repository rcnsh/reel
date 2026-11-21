# The HUD caption sits in the margin, with a halo only on dark pictures

`Hud` in `src/scenes/hud.ts` places its caption in the frame's margin and its figure label small on purpose, so `reportCaption` exempts them from `reel check`'s `safeArea` (and the label from `minSize`) instead of moving them.

`Hud.caption` gives the caption a soft dark halo (`shadowBlur` 10) on a dark picture, which keeps it legible over a busy picture; on a light picture it draws none, because there the halo reads as a pale patch.
