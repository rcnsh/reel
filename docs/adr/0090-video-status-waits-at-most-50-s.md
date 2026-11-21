# video_status waits at most 50 s

`MAX_WAIT_S` in `cli/jobs.ts` caps `waitJob`, and so the MCP `video_status` tool's `wait_s`, at 50 s. That stays under the 60 s request timeout MCP clients commonly use, so a wait returns a view instead of the client abandoning the call.
