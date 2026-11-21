# One warm renderer per project, decided by a lock file

Two clients can start a project's daemon at the same moment. `serve` in `cli/daemon.ts` lets whoever creates the lock file exclusively (`wx`) run. A lock left by a dead process is taken over. On the client side, `ensure` simply spawns a daemon: if another client started one meanwhile, the new one sees the lock and exits, and the client waits for and uses the running one's state file.
