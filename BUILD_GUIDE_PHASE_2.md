# Build Guide — Phase 2: Identity System

## Phase Goal
Add per-message agent identity switching. Consumers provide a JSON config mapping agent IDs to Slack display names/icons. The server resolves identity per tool call using a 3-tier hierarchy: explicit params > agent_id config lookup > default identity.

## Project Context
- **Stack:** TypeScript (ES2022, Node16 module resolution), MCP SDK 1.15.1 (pinned), Vitest
- **Layout:** `src/` with `tools/` subdirectory, `tests/unit/`, `config/` (to be created)
- **Conventions:** Classes for API clients, function exports for tool registration (`registerXTools(server, client)`), Zod schemas for MCP tool inputs, `vi.fn()` mock patterns in tests

## What Exists

| File | Purpose | Lines |
|------|---------|-------|
| `src/index.ts` | Entry point, server factory, transport (stdio/HTTP), auth.test on startup | 300 |
| `src/slack-client.ts` | `SlackClient` class — `authTest`, `getChannels`, `postMessage(channel_id, text)`, `postReply(channel_id, thread_ts, text)`, `addReaction`, `getChannelHistory`, `getThreadReplies`, `getUsers`, `getUserProfile` | 177 |
| `src/types.ts` | Shared interfaces: `PostMessageArgs`, `ReplyToThreadArgs`, etc. | 41 |
| `src/tools/channels.ts` | `registerChannelTools` — `slack_list_channels` | ~40 |
| `src/tools/messages.ts` | `registerMessageTools` — `slack_post_message`, `slack_reply_to_thread`, `slack_get_channel_history`, `slack_get_thread_replies` | 78 |
| `src/tools/reactions.ts` | `registerReactionTools` — `slack_add_reaction` | ~40 |
| `src/tools/users.ts` | `registerUserTools` — `slack_list_users`, `slack_get_user_profile` | ~50 |
| `tests/unit/slack-client.test.ts` | 11 tests covering all `SlackClient` methods | 274 |

**Phase 2 touches:** `src/slack-client.ts` (modify `postMessage`/`postReply` signatures), `src/tools/messages.ts` (add identity params to schemas), `src/types.ts` (add `PostMessageOptions`, `AgentIdentity`, `AgentConfig` interfaces). **New files:** `src/identity.ts`, `config/agent-identities.example.json`, `config/agent-identity-schema.json`, `tests/unit/identity.test.ts`.

## Prior Phase Status
- **Tests:** 11 passing, 0 failing
- **Build:** Compiles cleanly
- **Git tag:** v0.1.0-phase-1
- **Blockers from prior work:** None
- **Deferred items landing here:** None

## Open Issues (Beads)
No beads tracking in this project.

## Prior Plan Patterns
Phase 1 used wave-based execution (3 waves). Tasks were grouped by dependency ordering. Unit tests were in the final wave since they depend on source files being written.

## Blockers
None. Phase 1 is complete and all tests pass.

## Unclear Requirements
1. The fork-spec `postMessage` (Section 2.2) includes `unfurl_links`, `unfurl_media`, `blocks`, `reply_broadcast`, `metadata` parameters which go beyond the Phase 2 identity scope. The build-plan Phase 2 only mentions `username`, `icon_emoji`, `icon_url`, `metadata` for the PostMessageOptions change. The planner should decide whether to add only the identity-related fields now or include the full PostMessageOptions from the spec (recommended: add the full interface now since Phase 4 tools will need `thread_ts`, `reply_broadcast` etc., and the interface should be stable).
2. The fork-spec shows `postReply` delegating to `postMessage` (Section 2.4). Current `postReply` has its own `fetch` call. Phase 2 should refactor `postReply` to call `postMessage` with `thread_ts` set.
3. The existing tests for `postMessage` and `postReply` assert the current positional-argument signatures. These tests must be updated when the signatures change.

## Technical Unknowns
1. Config loading uses `readFileSync` from `node:fs`. This is synchronous and runs at startup — acceptable for a config file, but tests will need to mock `readFileSync` or use temp files.
2. The `resolveIdentity` function in the spec uses module-level `agentConfig` state. For testability, consider passing config as a parameter (the spec's function signature already supports this: `resolveIdentity(args)` checks `agentConfig` as module state). The planner should decide the injection pattern.

## Preflight Notes
No preflight notes from prior sessions. HANDOFF.md deferred issues table is empty.

## Key Spec References for Planning
- **Identity interfaces/resolution:** fork-spec.md lines 380-437 (Section 3.2)
- **PostMessageOptions interface:** fork-spec.md lines 128-171 (Section 2.2)
- **Tool schema updates:** fork-spec.md lines 176-225 (Section 2.3) and lines 449-455 (Section 3.3)
- **postReply delegation:** fork-spec.md lines 234-255 (Section 2.4)
- **JSON Schema:** build-plan.md lines 190-243 (Section 4.1)
- **Example config:** build-plan.md lines 248-266 (Section 4.2)
- **Phase 2 task list:** build-plan.md lines 551-569
