# Outputs are committed by one rename onto the real file

`commit` (`cli/scratch.ts`) puts a finished partial in place with a single `rename`, so a reader sees the old file or the new one, never half. It first copies the old file's permissions onto the partial. The result is a new file: other hard links to the old one keep the old render.

`destOf` resolves the output path through symlinks (up to 16 levels), following a link even when its target is missing, and the partial is written beside that target. Renaming onto the link itself would replace the link with a plain file.

`commitFrames` moves an image sequence into place frame by frame, each by rename, so a frame in the output folder is always a whole one.
