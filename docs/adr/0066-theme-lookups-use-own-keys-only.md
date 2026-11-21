# Theme and palette lookups use own keys only

`has` in `src/themes.ts` checks `Object.prototype.hasOwnProperty` for every theme-name and palette-key lookup (`isThemeName`, `extendTheme`, `resolveTheme`). A plain `in` or index lookup would find `Object.prototype` members, so a theme named `'constructor'` or a palette key such as `'toString'` would resolve to a function instead of failing as unknown.
