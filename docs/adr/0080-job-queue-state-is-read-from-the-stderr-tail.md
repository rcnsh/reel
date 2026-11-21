# A job's queue state is read from the tail of its stderr

`jobView` in `cli/jobs.ts` reads only the last 16 KB of a job's stderr (`tail`). In that stream, progress is one JSON line per update and anything else is the job's output. The export's queue lines are written before any progress. So when the tail does not reach the start of the file, the job is past its queue lines and counts as running, not queued.
