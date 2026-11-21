# Export-slot claims survive races and pid reuse

The machine's one export slot (`cli/exports.ts`) is a set of claim files. Several rules keep it correct:

- **Liveness.** `alive` counts EPERM from `kill(pid, 0)` as alive: the process exists but belongs to another user. Treating EPERM as dead would clear a live claim.
- **Start-time checks.** A claim's process start time (from `ps`) is checked once. After that, a pid that is still alive is still that process, so polling stays cheap (the `checked` set).
- **Unreadable claims.** A claim that can't be parsed is removed only once it is older than 10 s, because it may be one being written by an older reel that did not write atomically.
- **Races.** `take` writes this process's claim and then looks again. When two exports found the slot free at the same moment, both see the other's claim, both take theirs back, and both retry after a random pause. At most one ever keeps the slot.
- **Grace period.** `claimExport` retries for a while before refusing. An export that has written its file may still be closing its browsers.
