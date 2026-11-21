# Video jobs recognise their processes by start time and process group

A video job (`cli/jobs.ts`) records its shell's pid and start time. Pids are reused once free, so `running` checks that a live pid is still the shell that started, by its start time. A match is cached in `verified` but re-checked every few seconds (5 s), so a reused pid shows. If no start time could be read at spawn, the pid alone is trusted.

Once the shell is gone (killed), its command may outlive it. `orphan` finds the command by the pid in `child.pid` and accepts it only if it is still in the job's process group, the shell's pid. A reused pid is not in that group. `cancelJob` signals only processes that pass these checks: the shell by its start time, the command by its process group.
