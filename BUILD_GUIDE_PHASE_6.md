# Build Guide -- Phase 6: Dual-Token Support for Search

## Phase Goal
Add optional user token (`SLACK_USER_TOKEN`) support. The user token is used exclusively for `slack_search_messages` (Slack's `search.messages` API requires a user token, not a bot token).

## Project Context
- **Stack:** TypeScript, Node.js 20+, MCP SDK 1.15.1, Vitest, Zod
- **Layout:** `src/` (8 source files), `tests/unit/` (6 test files), `src/tools/` (5 tool modules)
- **Conventions:** Vitest imports, `vi.fn()`/`vi.spyOn()` mocking, `mockFetch`/`mockResponse` helpers, `apiCall()` private method pattern in SlackClient

## What Exists
- `src/slack-client.ts` — `searchMessages()` accepts `userToken` as a 5th parameter (DD-013 decision)
- `src/tools/messages.ts` — `registerMessageTools()` accepts `userToken` param, passes to `searchMessages()`
- `src/index.ts` — reads `process.env.SLACK_USER_TOKEN`, passes through `createSlackServer()` -> `registerMessageTools()`
- `tests/unit/tools.test.ts` — 4 tests covering searchMessages: no-token error, sort params, user token auth header, count cap at 100
- `tests/unit/slack-client.test.ts` — 13 tests, but NONE cover `searchMessages()`

## Prior Phase Status
- **Tests:** 59 passing, 0 failing
- **Blockers from prior work:** None
- **Deferred items landing here:** DD-013 stated "Phase 6 will wire SLACK_USER_TOKEN env var" — this wiring was completed in Phase 5 (commit 0ba50e2)

## Open Issues (Beads)
No beads tracking.

## Prior Plan Patterns
- PHASE_5_PLAN.md: 3 sequential waves, single-task per wave, File Ownership Guarantee table, smoke tests as bash commands, numbered "Done When" criteria

## Blockers
None. The functional implementation is already complete from Phases 4-5.

## Unclear Requirements
- Build plan Phase 6 originally called for modifying `SlackClient` constructor to accept `userToken` and store `userHeaders`. DD-013 chose a different approach (pass userToken per-call to `searchMessages`). The current approach is functionally equivalent and already tested. The question is: should Phase 6 refactor to the constructor approach, or just add the missing `slack-client.test.ts` coverage for searchMessages?

**Recommendation:** Keep the current per-call approach (DD-013). It is simpler, already tested, and avoids storing a second token as class state. Phase 6 should add `searchMessages` tests to `slack-client.test.ts` for completeness.

## Technical Unknowns
None. The implementation is straightforward.

## Preflight Notes
From HANDOFF.md DD-013: "searchMessages takes userToken as parameter (not stored on class) -- Phase 6 will wire SLACK_USER_TOKEN env var"
The env var wiring is already in place (index.ts line 257).
