# The jobs test follows a job from another process asynchronously

In `tests/jobs.test.ts` ("another process finds, follows and cancels a job it did not start"), the job's detached shell is a child of the test process, and Bun reaps a child only while the parent's event loop runs. The second process that finds and cancels the job is therefore started with `Bun.spawn` and awaited, never with `Bun.spawnSync`: blocking the event loop would leave the cancelled shell unreaped, so the other process would still see the job as alive.
