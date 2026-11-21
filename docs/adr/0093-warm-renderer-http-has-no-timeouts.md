# Warm renderer HTTP has no timeouts

A request to the warm renderer can render for minutes before it answers, for example a `check` of a long video. So neither side times out. The client's `fetch` in `ask` (`cli/daemon.ts`) passes `timeout: false`, and the daemon's `Bun.serve` in `serve` sets `idleTimeout: 0`. Either default would cut off a long check partway through.
