# The sweep removes Vite optimizer temp folders older than an hour

`sweep` (`cli/scratch.ts`), given the Vite cache folder, also removes the optimizer's `deps_temp_<hash>` folders older than `VITE_TEMP_AGE` (an hour). Those folders carry no owner to check, but Vite renames a live one into place within seconds, so one an hour old belongs to a server that died; Vite sweeps its own only after a day, while each killed render can leave one.
