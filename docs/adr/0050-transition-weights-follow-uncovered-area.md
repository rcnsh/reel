# Transition weights for reel check follow the uncovered area

`transitionWeights` in `src/engine/transitions.ts` gives each clip's share of the frame at an overlap's progress, which `reel check` scales the alpha of their text by. For an iris the share is the area the circle uncovers, which grows with the square of its radius, so the incoming weight is `e * e` for an opening iris and `1 - (1 - e)^2` for a closing one, not the eased progress itself. A dip splits the progress into halves (out, then in) and a flash dims each side by `flashAt`.
