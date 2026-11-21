# keys() checks key order as it walks, not up front

`keys` in `src/engine/util.ts` is called every frame (often per item), so it does not validate the whole key list before answering. It checks each pair of keys as the walk reads them and throws on one out of time order (or with a non-finite time). Every key the walk has read is in order whenever it returns, so the answer is always right; a key out of order past the segment containing t is only reported once a time reaches it.
