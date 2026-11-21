# Page props in the URL are parsed without URLSearchParams

`pageProps` in `src/engine/engine.ts` reads `?props=<JSON>` with a regular expression and `decodeURIComponent`, not `URLSearchParams`. `URLSearchParams` decodes `+` as a space, so a `+` typed by hand into the JSON in a preview URL would change the value. With the regex only percent-escapes are decoded: a `&` or `%` inside the JSON is typed `%26` or `%25`, and a malformed escape is reported as such.
