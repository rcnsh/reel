# Kit colours fail loudly, and when the component is made

A kit colour is a palette key or any CSS colour. `cssColor` in `src/kit/common.ts` turns a key into its custom property (`accentHi` to `var(--accent-hi)`) and passes CSS colours through, but throws on a bare word that is neither, listing the theme's keys. An unknown key would otherwise become a custom property that does not exist, and the text would silently inherit its colour instead. The bare-word test includes hyphens, because `'accent-hi'` and `'dark-blue'` are not CSS colours either and must throw too.

Components check their colours in their constructors, not while drawing. `AudioVis` in `src/kit/audio-vis.ts` calls `linearColor` on `color` and `restColor` and discards the result: the call exists only so a colour that is no palette key fails once, when the scene loads, rather than on every frame. It is not dead code.
