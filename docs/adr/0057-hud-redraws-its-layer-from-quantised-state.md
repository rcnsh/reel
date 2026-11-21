# The HUD redraws its layer only when its quantised state changes

`Hud.render` in `src/scenes/hud.ts` runs once per sub-frame, but its Canvas2D layer is drawn and uploaded again only when its key changes (`drawn`: the marks' progress, the caption's alpha and its revealed letter count). The marks' progress and the caption's alpha are quantised to thousandths (`q`) and the layer is drawn from the quantised values, so what the layer holds depends on `t` alone and is the same however the frame was reached, while most sub-frames skip the redraw.
