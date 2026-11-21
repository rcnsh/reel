# The preview's props script escapes `<`

For `reel dev --props`, the `reel-props` plugin in `startServer` (`cli/server.ts`) injects `window.__REEL_PROPS__ = <JSON>` into `index.html` as an inline script. Every `<` in the JSON is written as `<`: the props may hold the text `</script>`, which would otherwise end the script element early and break the page (or inject markup).
