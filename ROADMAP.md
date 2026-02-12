# Slack MCP Identity Server Roadmap

**Source**: Dev_Team `blueprint/specs/reusable-build-plan.md` + `blueprint/specs/slack-mcp-fork-spec.md`
**Package**: `slack-mcp-identity-server`
**Base**: Fork of `zencoderai/slack-mcp-server` (MIT, MCP SDK 1.15.1)

---

## Phase 1: Core Server — Fork Restructure + Build Infrastructure

**Goal**: Split the single-file Zencoder upstream into a multi-file layout, set up TypeScript build and Vitest test infrastructure, verify the 8 existing tools still work, and add startup token validation via `auth.test`.

**Deliverables**:
- `src/index.ts` — Entry point: server setup, transport selection (stdio default, HTTP via `--transport http`)
- `src/slack-client.ts` — `SlackClient` class extracted from upstream `index.ts`
- `src/types.ts` — Shared TypeScript interfaces
- `src/tools/channels.ts` — list channels tool
- `src/tools/messages.ts` — post message, reply, get history, get thread replies tools
- `src/tools/reactions.ts` — add reaction tool
- `src/tools/users.ts` — list users, get profile tools
- `tsconfig.json` — ES2022 target, Node16 module resolution, strict mode
- `vitest.config.ts` — Vitest configuration
- `package.json` — Updated with Vitest, build scripts, correct dependencies (MCP SDK pinned to `1.15.1` without caret)
- `tests/unit/slack-client.test.ts` — Unit tests for existing SlackClient methods
- Startup `auth.test` call to verify bot token on server start
- `.gitignore` — dist/, node_modules/, .env

**Validation**:
1. `npm run build` compiles without errors
2. `npm test` runs unit tests and all pass
3. All 8 existing tools are registered and respond to MCP `tools/list`
4. Server starts with valid `SLACK_BOT_TOKEN` and logs app name from `auth.test`
5. Server logs error and exits on invalid bot token
6. No behavioral regression from upstream — existing tools produce identical API calls

**Dependencies**: None. This is the foundation.

---

## Phase 2: Identity System

**Goal**: Add per-message agent identity switching. Consumers provide a JSON config mapping agent IDs to Slack display names/icons. The server resolves identity per tool call using a 3-tier hierarchy: explicit params > agent_id config lookup > default identity.

**Deliverables**:
- `src/identity.ts` — `loadAgentConfig()` reads and validates config, `resolveIdentity()` implements 3-tier resolution (returns `null` not empty string when no identity applies)
- `config/agent-identities.example.json` — Example config with generic placeholder roles
- `config/agent-identity-schema.json` — JSON Schema for config validation
- Modified `src/slack-client.ts` — `postMessage()` accepts `PostMessageOptions` with `username`, `icon_emoji`, `icon_url`, `metadata` params
- Modified `src/tools/messages.ts` — `slack_post_message` and `slack_reply_to_thread` schemas include `agent_id`, `username`, `icon_emoji`, `icon_url` parameters
- `tests/unit/identity.test.ts` — All 4 resolution tiers, config loading, schema validation, `null` return on no match

**Validation**:
1. `resolveIdentity()` returns correct identity for each tier (explicit > agent_id > default > null)
2. `resolveIdentity()` returns `null` (not empty string) when no identity applies
3. `loadAgentConfig()` throws on invalid config (missing `version`, missing `defaultIdentity`)
4. `postMessage()` body includes `username`/`icon_emoji` when identity is resolved
5. `postMessage()` body omits identity fields when `resolveIdentity()` returns `null`
6. All unit tests pass
7. Startup logs warning if `SLACK_AGENT_CONFIG_PATH` is set but file not found

**Dependencies**: Phase 1 complete.

---

## Phase 3: Rate Limiter + Network Retry

**Goal**: Add a priority-based rate limiter with per-method tracking and 429 handling, plus `fetchWithRetry()` for network failure resilience. The call chain is: `rateLimiter.enqueue(method, () => fetchWithRetry(url, opts))` — network retries stay within the same rate limit slot.

**Deliverables**:
- `src/rate-limiter.ts` — `SlackRateLimiter` class: per-method token bucket, priority queue (0=highest), 429 handling with `Retry-After` header via `_retryAfter` propagation, queue delay warning logging
- `src/network.ts` — `fetchWithRetry()`: exponential backoff for 5xx and network errors, configurable max retries
- Modified `src/slack-client.ts` — All API methods go through `rateLimiter.enqueue()`, raw `fetch()` replaced with `fetchWithRetry()` inside enqueue callback
- Modified `src/tools/messages.ts` — `slack_post_message` and `slack_reply_to_thread` accept `priority` parameter (0-3, default 2)
- `tests/unit/rate-limiter.test.ts` — Method limits, priority ordering, 429 retry with Retry-After, queue delay warning
- `tests/unit/network.test.ts` — Exponential backoff, max retries, success on retry

**Validation**:
1. Rate limiter enforces per-method limits (requests above limit are queued, not rejected)
2. Priority 0 messages dequeue before priority 3
3. On 429 response, limiter reads `Retry-After` header and pauses that method
4. `fetchWithRetry` retries on 5xx with exponential backoff
5. `fetchWithRetry` does NOT retry on 4xx (except 429 which is handled by rate limiter)
6. The wiring is correct: `fetchWithRetry` runs INSIDE `rateLimiter.enqueue()`, not wrapping it
7. All unit tests pass

**Dependencies**: Phase 1 complete. Can run in parallel with Phase 4 after Phase 2 completes (but Phase 4 depends on Phase 2 for PostMessageOptions).

---

## Phase 4: New Tools (9 tools)

**Goal**: Add 9 new Slack tools: update_message, create/archive channel, set topic/purpose, remove reaction, pin/unpin message, search messages. Each tool gets a `SlackClient` method, MCP tool registration with Zod schema, and unit tests.

**Deliverables**:
- Modified `src/slack-client.ts` — 9 new API methods (updateMessage, createChannel, archiveChannel, setChannelTopic, setChannelPurpose, removeReaction, pinMessage, unpinMessage, searchMessages)
- `src/tools/pins.ts` — pin_message, unpin_message tools
- Modified `src/tools/channels.ts` — create_channel, archive_channel, set_channel_topic, set_channel_purpose tools
- Modified `src/tools/messages.ts` — update_message, search_messages tools
- Modified `src/tools/reactions.ts` — remove_reaction tool
- `tests/unit/tools.test.ts` — Body construction tests for all 9 new tools
- `slack_update_message` description is generic ("Edit an existing message"), no protocol references
- `slack_search_messages` includes `sort`, `sort_dir` parameters (not dropped)
- Channel allow-list (`SLACK_CHANNEL_IDS`): `slack_create_channel` exempt, `slack_search_messages` inherits from user token

**Validation**:
1. All 17 tools appear in MCP `tools/list` response
2. `slack_update_message` constructs correct `chat.update` API body
3. `slack_create_channel` works regardless of `SLACK_CHANNEL_IDS` setting
4. `slack_search_messages` includes `sort` and `sort_dir` in API call
5. `slack_search_messages` returns error message (not crash) when no user token configured
6. All unit tests pass
7. Tool descriptions are generic — no Dev Team protocol references

**Dependencies**: Phase 2 complete (new message tools depend on PostMessageOptions interface).

---

## Phase 5: Message Logger

**Goal**: Add optional JSONL message logging. Disabled by default. Enabled when `SLACK_MESSAGE_LOG` env var is set to a file path. Logs all outbound messages with timestamp, channel, agent identity, text, and delivery status.

**Deliverables**:
- `src/message-logger.ts` — `MessageLogger` class: writes JSONL, no-op when disabled, no log rotation (consumer's responsibility)
- Modified `src/slack-client.ts` — Logger wired into `postMessage()` and `postReply()`, logs after each API call
- `tests/unit/message-logger.test.ts` — Correct JSONL format, disabled state produces no output, includes identity fields

**Validation**:
1. When `SLACK_MESSAGE_LOG` is unset, no file is created and no overhead
2. When `SLACK_MESSAGE_LOG` is set, messages are appended as JSONL
3. Each log entry includes: timestamp, channel, agent identity (username, icon), text, delivery success/failure
4. Logger does not throw on write failure (logs warning instead)
5. All unit tests pass

**Dependencies**: Phase 2 complete (identity fields are part of log entries).

---

## Phase 6: Dual-Token Support for Search

**Goal**: Add optional user token (`SLACK_USER_TOKEN`) support. The user token is used exclusively for `slack_search_messages` (Slack's `search.messages` API requires a user token, not a bot token).

**Deliverables**:
- Modified `src/slack-client.ts` — Constructor accepts optional user token, `searchMessages()` method uses user token when available
- Modified `src/tools/messages.ts` — `slack_search_messages` routes through user token
- `tests/unit/slack-client.test.ts` — Updated tests for dual-token constructor, search token routing

**Validation**:
1. `SlackClient` constructor accepts optional `userToken` parameter
2. `searchMessages()` uses user token when provided
3. `searchMessages()` returns clear error when no user token is configured
4. Bot token is never used for search API calls
5. All unit tests pass

**Dependencies**: Phase 4 complete (`slack_search_messages` tool exists).

---

## Phase 7: Documentation + Packaging

**Goal**: Write a self-contained README, add example configs, verify `npm pack` produces a clean publishable tarball, and add hashbang for `npx` support.

**Deliverables**:
- `README.md` — Complete documentation: what/why, Slack app setup, installation, MCP config, identity system, rate limiting, tool reference (17 tools), troubleshooting, security note (ADR-001 reference)
- `config/agent-identities.example.json` — Generic example (already created in Phase 2, verify it's up to date)
- Hashbang (`#!/usr/bin/env node`) at top of `src/index.ts` (compiles into `dist/index.js`)
- `CHANGELOG.md` — Initial changelog entry
- `LICENSE` — MIT (already present from fork)
- Verified `npm pack` tarball contains only: `dist/`, `config/`, `README.md`, `LICENSE`, `CHANGELOG.md`, `package.json`

**Validation**:
1. README covers all 10 sections from build plan Section 10
2. `npm pack` produces tarball with correct file set (no tests, no src)
3. `npx slack-mcp-identity-server` starts the server (hashbang works)
4. Fresh clone + `npm install` + `npm run build` + `npm test` succeeds
5. All 22 checklist items from build plan are addressed

**Dependencies**: All previous phases complete.

---

## Dependencies

```
Phase 1 ──→ Phase 2 ──→ Phase 3 (parallel possible)
                    └──→ Phase 4
                    └──→ Phase 5
                          Phase 4 ──→ Phase 6
                                       Phase 6 ──→ Phase 7
```

Phase 1 is the foundation. Phase 2 must follow Phase 1. After Phase 2, Phases 3/4/5 can proceed (3 and 4 are independent of each other; 5 depends on 2). Phase 6 depends on Phase 4. Phase 7 depends on all.

---

## Technical Context

- **Language**: TypeScript (ES2022, Node16 module resolution)
- **Test framework**: Vitest (not Jest — upstream uses `vi.spyOn` patterns)
- **MCP SDK**: `@modelcontextprotocol/sdk` pinned to `1.15.1` (no caret — MCP SDK has breaking minor versions)
- **Express**: Optional dependency, dynamic import for HTTP transport only
- **Full spec**: `~/Documents/Projects/Dev_Team/blueprint/specs/slack-mcp-fork-spec.md` (1,696 lines, complete TypeScript implementations for all components)
- **Red team report**: `~/Documents/Projects/Dev_Team/blueprint/specs/reusable-build-plan-redteam.md` (all 20 findings fixed)
