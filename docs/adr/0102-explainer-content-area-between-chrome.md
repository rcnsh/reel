# The explainer's content area sits between its chrome

`examples/explainer/scenes/_script.ts` exports `TOP = 0.15` and `BOTTOM = 0.74`: the share of the frame's height that bounds every content scene's boxes. They are the band below the progress bar and timer (drawn by `chrome.ts` on the track above) and above the captions, so no content scene runs under the always-on chrome. Changing the chrome's layout means changing these two numbers with it.
