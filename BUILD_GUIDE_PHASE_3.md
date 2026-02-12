# Build Guide — Phase 3: Rate Limiter + Network Retry

## Phase Goal
Add a priority-based rate limiter with per-method tracking and 429 handling, plus `fetchWithRetry()` for network failure resilience. The call chain is: `rateLimiter.enqueue(method, () => fetchWithRetry(url, opts))` — network retries stay within the same rate limit slot.

## Project Context
- **Stack:** TypeScript (ES2022, Node16 module resolution), MCP SDK 1.15.1 (pinned exact), Vitest 3.x
- **Layout:** `src/` with `tools/` subdirectory, `tests/unit/`, `config/`, `docs/`
- **Module type:** ESM (`"type": "module"` in package.json, `.js` extension in imports)
- **Conventions:** Classes for API clients (`SlackClient`), function exports for tool registration (`registerXTools(server, client, config)`), Zod schemas for MCP tool inputs, `vi.fn()` mock patterns in tests, `vi.spyOn(globalThis, 'fetch')` for fetch mocking

## What Exists

| File | Purpose | Lines |
|------|---------|-------|
| `src/index.ts` | Entry point, `createSlackServer()`, transport (stdio/HTTP), auth.test on startup, graceful shutdown | 310 |
| `src/slack-client.ts` | `SlackClient` class — `authTest`, `getChannels`, `postMessage(opts: PostMessageOptions)`, `postReply(...)`, `addReaction`, `getChannelHistory`, `getThreadReplies`, `getUsers`, `getUserProfile`. All methods use raw `fetch()` directly. | 191 |
| `src/identity.ts` | `loadAgentConfig()`, `resolveIdentity()` — 3-tier identity resolution | ~70 |
| `src/types.ts` | Shared interfaces: `PostMessageOptions`, `AgentIdentity`, `AgentConfig`, arg interfaces | 71 |
| `src/tools/channels.ts` | `registerChannelTools` — `slack_list_channels` | ~40 |
| `src/tools/messages.ts` | `registerMessageTools` — `slack_post_message`, `slack_reply_to_thread`, `slack_get_channel_history`, `slack_get_thread_replies`. No priority parameter yet. | 113 |
| `src/tools/reactions.ts` | `registerReactionTools` — `slack_add_reaction` | ~40 |
| `src/tools/users.ts` | `registerUserTools` — `slack_list_users`, `slack_get_user_profile` | ~50 |
| `tests/unit/slack-client.test.ts` | 13 tests covering all `SlackClient` methods, uses `vi.spyOn(globalThis, 'fetch')` | ~280 |
| `tests/unit/identity.test.ts` | 13 tests covering identity resolution and config loading | ~200 |
| `vitest.config.ts` | Vitest config | ~10 |
| `package.json` | ESM, Vitest, MCP SDK 1.15.1 (exact), no runtime deps beyond SDK + Zod | 38 |

**Phase 3 touches:**
- `src/slack-client.ts` — All API methods must route through `rateLimiter.enqueue()` with `fetchWithRetry()` inside the callback
- `src/tools/messages.ts` — `slack_post_message` and `slack_reply_to_thread` gain `priority` parameter (0-3, default 2)

**Phase 3 creates:**
- `src/rate-limiter.ts` — `SlackRateLimiter` class
- `src/network.ts` — `fetchWithRetry()` function
- `tests/unit/rate-limiter.test.ts` — Rate limiter unit tests
- `tests/unit/network.test.ts` — Network retry unit tests

## Prior Phase Status
- **Tests:** 26 passing, 0 failing (13 in `slack-client.test.ts`, 13 in `identity.test.ts`)
- **Build:** Compiles cleanly (`npm run build` succeeds)
- **Git tag:** v0.1.0-phase-2
- **Blockers from prior work:** None
- **Deferred items landing here:** None (HANDOFF.md deferred issues table is empty)

## Open Issues (Beads)
No beads tracking in this project.

## Prior Plan Patterns
Phases 1 and 2 used wave-based execution (3 waves per phase). Tasks grouped by dependency ordering:
- Wave 1: New source files (no dependencies on each other)
- Wave 2: Modified source files (depend on new files from wave 1)
- Wave 3: Unit tests (depend on source files from waves 1-2)

Post-wave: code shortening (Phase E), then code review + security review (Phase F).

## Blockers
None. Phase 2 is complete, all 26 tests pass, build compiles cleanly.

## Unclear Requirements

1. **Queue delay warning mechanism:** The fork-spec (Section 4.7) shows a queue delay warning returned as tool content when `estimatedWait > 10_000`. This implies the rate limiter needs to surface estimated wait time back to the caller. The spec shows this as inline tool response content, but the `enqueue()` method signature returns `Promise<T>` where T is the API response. The planner needs to decide whether the warning is:
   - (a) Logged to stderr only (simpler, consistent with other logging)
   - (b) Returned as part of the tool response (requires the tool handler to check estimated wait before enqueuing)
   - The ROADMAP says "queue delay warning logging" suggesting option (a).

2. **429 propagation via `_retryAfter`:** The fork-spec shows checking `result._retryAfter` on the parsed JSON response body. However, Slack returns `Retry-After` as an HTTP header, not in the JSON body. Since `fetchWithRetry` returns a `Response` object (not parsed JSON), the rate limiter's `execute` callback returns parsed JSON (from `response.json()`). The planner must decide how to propagate the `Retry-After` header value:
   - (a) Have `fetchWithRetry` attach `_retryAfter` to the parsed JSON before returning (as spec shows)
   - (b) Have `fetchWithRetry` return a wrapper object with both the parsed body and the header value
   - The fork-spec uses approach (a): the SlackClient methods parse JSON and attach `_retryAfter` from the response headers.

3. **SlackClient constructor change:** The rate limiter needs to be instantiated once and shared across all `SlackClient` methods. The planner must decide whether:
   - (a) `SlackClient` constructor creates its own `SlackRateLimiter` internally
   - (b) `SlackRateLimiter` is passed into `SlackClient` via constructor injection
   - Option (a) is simpler and matches the existing pattern where `SlackClient` manages its own state.

4. **Existing `slack-client.test.ts` updates:** All 13 existing tests mock `fetch` directly. After Phase 3, `SlackClient` methods call `rateLimiter.enqueue()` which calls `fetchWithRetry()` which calls `fetch()`. Existing tests should still work since `vi.spyOn(globalThis, 'fetch')` intercepts at the bottom layer, but the tests may need adjustments if the rate limiter introduces async timing changes.

## Technical Unknowns

1. **Timer management in tests:** The rate limiter uses `Date.now()` and `setTimeout` for window tracking and sleep. Tests will need `vi.useFakeTimers()` for deterministic behavior. The planner should ensure test setup/teardown properly manages fake timers to avoid interference between test files.

2. **`processQueue` re-entrancy:** The fork-spec's `processQueue` uses a `this.processing` guard. When `enqueue` is called while the queue is already processing, the new item is added and sorted but `processQueue` returns immediately. The item will be picked up by the existing processing loop. This is correct but tests must account for the async nature — items are not processed synchronously.

3. **Interaction with existing `postReply` method:** `postReply` delegates to `postMessage`. If `postMessage` goes through the rate limiter, `postReply` does too (via `postMessage`). This is correct — no double-enqueue.

## Preflight Notes
No preflight notes from prior sessions. HANDOFF.md deferred issues table is empty.

## Key Spec References for Planning
- **Rate limiter class:** fork-spec.md lines 493-628 (Section 4.2)
- **Priority levels:** fork-spec.md lines 631-643 (Section 4.3)
- **429 handling:** fork-spec.md lines 646-660 (Section 4.4)
- **fetchWithRetry:** fork-spec.md lines 661-696 (Section 4.5)
- **Queue delay warning:** fork-spec.md lines 733-752 (Section 4.7)
- **Priority tool parameter:** fork-spec.md line 643 (Zod schema for priority)
- **SlackClient wiring (conceptual):** fork-spec.md Section 2.1 — all methods go through `rateLimiter.enqueue(method, () => fetchWithRetry(url, opts))`
- **Build plan Phase 3:** build-plan.md (Phase 3 section)
- **Requirements R5, R6:** REQUIREMENTS.md
