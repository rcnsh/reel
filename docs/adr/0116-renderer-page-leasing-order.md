# The renderer leases pages one at a time and orders its bookkeeping around awaits

`Renderer.page` (`cli/renderer.ts`) chains every call through `opening`, so leasing runs one at a time: it may start the dev server or Chrome, or close pages, and two overlapping leases could do that twice or close a page the other just chose. The requests themselves, once leased, overlap freely.

When the dev server is replaced while the other lane holds pages (`Renderer.server`), the old server and its busy pages are pushed onto `retiring` before any `await`: the other request may finish meanwhile, and its `release` must find the entry to stop the old server.

`lease` clears a page's logs only when it was used before (`h.used`): a freshly opened page keeps what it said while loading, so its load errors reach the first request.
