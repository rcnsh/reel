# The analyze model tests run one song at a time

The default-path test in `tests/analyze.test.ts` runs `reel analyze` on its synthesised songs one after another (a `for` loop of `run(c, false)`), not with `Promise.all` as the `--fast` cases and the readiness probes can. Each run loads both models (Beat This! and Demucs), which take the machine's GPU and a few GB of memory: about 3 s a song on Apple Silicon, tens of seconds on a CPU. Running them together would contend for the GPU and memory rather than save time.
