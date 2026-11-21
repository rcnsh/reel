# Transitions clamp the eased progress only for fades

A transition's progress runs through its easing curve (`transitionEase` in `src/engine/transitions.ts`), and a curve such as `outBack` or `outElastic` overshoots 0..1. For the kinds that mix the two clips by the progress (`crossfade`, `zoom`, `dip`, `flash`: `fade: true` in `KINDS`), a mix past its ends extrapolates colours, so `TransitionPass.draw` clamps the eased progress before it reaches the shader. The other kinds (wipe, slide, whip, iris, clock) get the unclamped value: there an overshooting curve moves an edge or a push past its end and back, which is what the author asked for.

## Consequences

Clamping every kind would flatten overshooting curves on edges and pushes; clamping none would make an overshooting crossfade produce colours outside both clips.
