# Props travel as checked JSON text

`--props` names a JSON file or holds inline JSON. `cli/reel.ts` reads and checks it up front (`readProps` in `cli/args.ts`), so a request carries the JSON itself, never a path the warm renderer would have to resolve from another folder. The MCP server checks its `props` object with its own schema. So `pageOf` copies the props text without parsing it again.
