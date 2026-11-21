# Review notes change by re-reading the file under a lock

The review page, the CLI, the MCP tools and an agent editing the file by hand all change `review/notes.json`. `updateNotes` in `cli/notes.ts` makes every change in four steps. It re-reads the file, applies itself to the notes by id, writes the result atomically (a temp file renamed over it), and holds a short lock throughout (`locked`, `review/.notes.lock`, taken over when older than 10 s). That way no writer loses another's change.

The lock is waited for synchronously (`nap`, `Atomics.wait`), not with an event-loop sleep, so a change is one uninterrupted step. A notes file that cannot be read, or that holds something other than notes, is never overwritten (`NotesError`).
