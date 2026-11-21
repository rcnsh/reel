# The review server accepts only local Host headers

`serveReview` (`cli/review.ts`) listens on 127.0.0.1 and also rejects, with 403, any request whose `Host` header is not `127.0.0.1` or `localhost`. Binding to loopback alone does not stop DNS rebinding: a page on another site can resolve its own name to 127.0.0.1 and drive the notes API from the browser. The Host check closes that.
