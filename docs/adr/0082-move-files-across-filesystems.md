# Moving renders handles EXDEV

A rename fails with EXDEV when the temp folder is on another filesystem than the checkout (on a cloud box, `/tmp` and `/data`). `moveFile` in `cli/golden.ts` falls back to copying beside the destination, renaming that copy into place, and removing the source, so the destination is never half written. Its `rename` is a parameter so the tests can simulate EXDEV.
