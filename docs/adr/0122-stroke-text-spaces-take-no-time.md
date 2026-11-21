# Written stroke text gives each space a zero-length time

In `examples/demo/scenes/written.ts` (`Written.init`), `charTimes` holds one `[start, end]` per character of the row's stroke text, which includes the spaces between words. Each character of a word is written during that word's spoken time, split evenly; after each word a `[w.end, w.end]` entry stands for the space, which takes no time. Removing that entry would shift every later character's timing by one and desynchronise the pen from the narration.
