# SceneCtx.props is typed with any, not unknown

`SceneCtx.props` in `src/engine/scene.ts` is `Readonly<Record<string, any>>`. Scenes cast it to the project's own type (`this.ctx.props as Props`, the type `reel.config.ts` exports). With `unknown` values that cast compiles when `Props` is a type alias but fails when it is an interface, since an interface has no implicit index signature; `any` lets both compile.

## Considered options

- `Readonly<Record<string, unknown>>`: stricter, but rejects the cast to an interface `Props`.
