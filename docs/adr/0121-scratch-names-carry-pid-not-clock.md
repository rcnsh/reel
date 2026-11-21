# Scratch names identify their owner by pid and program, never by clock

An export's scratch (`cli/scratch.ts`) is named `<stem>.partial-<pid>-<ms><ext>`, `reel-spool-<pid>-<ms>` or `reel-webp-<pid>-<ms>`. The partial keeps the output's extension so ffmpeg picks the container from it. The `<ms>` (`stamp`, never the same twice in a process) only keeps names unique.

`ownerGone` judges a name's owner by its pid alone: gone when the pid is dead, or now runs a program other than bun (the pid was reused). No clock is compared: a start time checked against `<ms>` would misread a live export as gone after a clock step (a VM resumed). A pid reused by another bun keeps the scratch until that process exits, and a name whose program cannot be read counts as alive, so a live export's scratch is never swept.

`ownerOf`'s pattern is anchored and wants a 13-digit time, so a name another program made is very unlikely to match and be deleted.
