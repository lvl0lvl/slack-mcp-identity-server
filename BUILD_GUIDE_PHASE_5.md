# Build Guide — Phase 5: Message Logger

## Phase Goal
Add optional JSONL message logging. Disabled by default. Enabled when `SLACK_MESSAGE_LOG` env var is set to a file path. Logs all outbound messages with timestamp, channel, agent identity, text, and delivery status.

## Project Context
- **Stack:** TypeScript, Node.js >= 20, MCP SDK 1.15.1, Vitest, Zod
- **Layout:** `src/` for source (multi-file: `index.ts`, `slack-client.ts`, `identity.ts`, `rate-limiter.ts`, `network.ts`, `types.ts`, `tools/`), `tests/unit/` for Vitest tests
- **Conventions:** Named exports, `import type` for type-only imports, `.js` extensions in imports, `apiCall()` private helper pattern in `SlackClient`, tool registration via `registerXxxTools()` functions, identity resolved per-call

## What Exists
- **src/slack-client.ts** (374 lines) — `SlackClient` class with `postMessage(opts, priority?)`, `postReply(channel_id, thread_ts, text, username?, icon_emoji?, icon_url?, priority?)`, and 13 other API methods. All go through private `apiCall()` method which wraps `rateLimiter.enqueue(() => fetchWithRetry())`.
- **src/identity.ts** (64 lines) — `loadAgentConfig()`, `resolveIdentity()` with 4-tier resolution
- **src/rate-limiter.ts** — `SlackRateLimiter` with per-method tracking, priority queue, 429 handling
- **src/network.ts** — `fetchWithRetry()` with exponential backoff
- **src/types.ts** (82 lines) — `PostMessageOptions`, `UpdateMessageOptions`, `AgentIdentity`, `AgentConfig`, and tool arg interfaces
- **src/tools/messages.ts** (171 lines) — `registerMessageTools()` — handles `slack_post_message`, `slack_reply_to_thread`, `slack_get_channel_history`, `slack_get_thread_replies`, `slack_update_message`, `slack_search_messages`
- **src/index.ts** (314 lines) — Entry point, `createSlackServer()`, `main()`, stdio + HTTP transports, auth.test on startup
- **tests/unit/** — 5 test files, 51 total tests (all passing)
- **No `src/message-logger.ts`** — this file does not exist yet (Phase 5 deliverable)

## Prior Phase Status
- **Tests:** 51 passing, 0 failing
- **Build:** Clean (`npm run build` succeeds)
- **Blockers from prior work:** None
- **Deferred items landing here:** None

## Open Issues (Beads)
No beads tracking in this project.

## Prior Plan Patterns
Phases 1-4 used the same plan format:
- Waves with ASCII dependency graphs
- Tasks with Description, Files, Dependencies, Context Needed, Implementation Notes, Smoke Tests, Done When
- File Ownership Guarantee table proving zero write conflicts for parallel tasks
- Parallelization Map with justification
- Test Plan with expected counts
- Risk Assessment (probability/impact/mitigation)
- Git Checkpoints (conventional commit messages)
- Verification Commands (runnable bash)

## Blockers
None. Phase 5 is ready to plan.

## Unclear Requirements

1. **Logger integration points:** The build plan says "Wire into `SlackClient.postMessage()` and `SlackClient.postReply()`." Since `postReply` delegates to `postMessage`, logging in `postMessage` alone would capture both. However, if we log in `postMessage`, we need access to the resolved identity (username, icon_emoji) which is resolved in the tool handlers (`tools/messages.ts`), not in `SlackClient`. Options:
   - Log inside `SlackClient.postMessage()` using the identity fields already on `PostMessageOptions` (`username`, `icon_emoji`)
   - This works because `tools/messages.ts` spreads `identity.username` etc. into the `postMessage` opts before calling `client.postMessage()`

2. **What constitutes "all outbound messages"?** The spec says log all outbound messages. `postMessage` is the primary outbound method (postReply delegates to it). `updateMessage` is also outbound but edits existing messages. The build plan only mentions `postMessage()` and `postReply()`. Recommendation: log `postMessage` calls only (covers both post and reply), skip `updateMessage`.

## Technical Unknowns

1. **Write failure handling:** R8 says "Logger does not throw on write failure (logs warning instead)." The `fs.appendFileSync` will throw on disk errors. The logger must wrap this in a try/catch and log the warning to stderr.

2. **JSONL entry fields:** The fork spec (Section 4.6, lines 713-728) defines the entry shape:
   ```
   timestamp, channel_id, agent_id?, username?, text, thread_ts?, slack_ts?, delivered, error?
   ```
   The `agent_id` is NOT available in `SlackClient.postMessage()` — it's resolved in the tool handler. The `username` IS available via `PostMessageOptions.username`. The `slack_ts` comes from the API response. The `delivered` boolean comes from `response.ok`. The `error` comes from `response.error` on failure.

3. **No-op when disabled:** When `SLACK_MESSAGE_LOG` is not set, the logger should have zero overhead. A class with methods that immediately return (no file operations, no object construction) is sufficient.

## Preflight Notes
No preflight or cascade notes from prior phases relevant to Phase 5.
