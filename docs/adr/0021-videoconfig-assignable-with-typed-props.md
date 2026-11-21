# A config with typed props stays a VideoConfig

A project types its props with an interface (`export interface Props { title: string }`) and passes `props: { … } as Props` to `defineVideo`. `VideoConfig<P>` in `src/config.ts` must still accept that config wherever a plain `VideoConfig` (with the default `Props`) is expected: the engine and the CLI take `VideoConfig`.

Two typing choices make that hold. `Props` is `Record<string, any>`, not `Record<string, unknown>`: an interface has no index signature, so it is not assignable to a `Record<string, unknown>`, but it is to one of `any`. And `VideoConfig.sounds` is typed through a method signature (`{ fn(src: Sources<P>): SoundClip[] }['fn']`) rather than a plain function type, as `timeline(src)` is a method: method parameters are checked bivariantly, so a function of `Sources<MyProps>` is still assignable where `Sources<Props>` is expected. A plain arrow type there would be checked contravariantly and reject the project's config.

## Consequences

Changing `Props` to `unknown` values or `sounds` to an arrow type looks like a tightening but breaks every project that types its props.
