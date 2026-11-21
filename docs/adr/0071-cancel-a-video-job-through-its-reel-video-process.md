# Cancelling a job signals reel video, not the encoder

`cancelJob` in `cli/jobs.ts` sends SIGTERM to the job's `reel video` process, which kills its encoder at once. An encoder sent SIGTERM directly would instead finish a playable, cut-short file. If the command has not started yet, the whole process group gets SIGTERM. If the job has not ended by the timeout (15 s), the group gets SIGKILL.
