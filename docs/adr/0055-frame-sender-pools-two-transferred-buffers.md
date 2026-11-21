# The frame sender transfers two pooled buffers to a worker

`sender` in `src/main.ts` writes export frames to the WebSocket from a worker thread. Each frame buffer is transferred to the worker (no copy) and the worker transfers it straight back after `ws.send`, because `send` copies the bytes: the buffer is free again as soon as it is handed to the socket, not when the receiver acknowledges it. So the pool holds two buffers, one being filled while the other is with the worker; acknowledgements bound only how many frames are in flight (`inflight`).
