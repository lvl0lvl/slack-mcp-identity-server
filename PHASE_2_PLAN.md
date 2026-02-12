# PHASE 2: Identity System

**Date**: 2026-02-12
**Status**: Planning
**Version Target**: 0.2.0

---

## Overview

Add per-message agent identity switching to `slack_post_message` and `slack_reply_to_thread`. Consumers provide a JSON config mapping agent IDs to Slack display names/icons. The server resolves identity per tool call using a 3-tier hierarchy: explicit params > agent_id config lookup > default identity. Returns `null` (not empty string) when no identity applies.

**Goal**: Working identity resolution with config loading, updated `postMessage`/`postReply` signatures, updated tool schemas, and full test coverage.

**Requirements Addressed**: R2 (per-message identity switching), R3 (agent config file), R4 (identity resolution hierarchy)

**Success Criteria**:
1. `resolveIdentity()` returns correct identity for each tier (explicit > agent_id > default > null)
2. `resolveIdentity()` returns `null` (not empty string) when no identity applies
3. `loadAgentConfig()` throws on invalid config (missing `version`, missing `defaultIdentity`)
4. `postMessage()` body includes `username`/`icon_emoji` when identity is resolved
5. `postMessage()` body omits identity fields when `resolveIdentity()` returns `null`
6. All unit tests pass
7. Startup logs warning if `SLACK_AGENT_CONFIG_PATH` is set but file not found

---

## Dependency Graph

```
Wave 1: Foundation (parallel — no shared writes)
   +-- Task 1.1 (src/identity.ts) ─────────┐
   +-- Task 1.2 (config/ files) ────────────┤
   +-- Task 1.3 (src/types.ts updates) ─────┘
                                             |
                                             v
Wave 2: Integration (sequential — shared file writes)
   +-- Task 2.1 (src/slack-client.ts mods) ─┐
   +-- Task 2.2 (src/tools/messages.ts mods) ┤ (sequential: 2.1 then 2.2)
   +-- Task 2.3 (src/index.ts startup) ──────┘
                                             |
                                             v
Wave 3: Tests
   +-- Task 3.1 (tests/unit/identity.test.ts)
   +-- Task 3.2 (update tests/unit/slack-client.test.ts)
```

---

## Wave Structure

### Wave 1: Foundation — Types, Config, Identity Module

#### Task 1.1: Identity Module (`src/identity.ts`)

- **Description**: Create the identity resolution module with `loadAgentConfig()` and `resolveIdentity()` functions. `loadAgentConfig()` reads a JSON file from `SLACK_AGENT_CONFIG_PATH`, validates it has `version` and `defaultIdentity`, and returns `AgentConfig | null`. `resolveIdentity()` implements 3-tier resolution: explicit params > agent_id lookup > default identity > null.
- **Files**:
  - Creates: `src/identity.ts`
- **Dependencies**: None (Wave 1)
- **Context Needed**:
  - `docs/fork-spec.md` Section 3.2 (lines 380-437) — `AgentIdentity`, `AgentConfig` interfaces, `loadAgentConfig()`, `resolveIdentity()` implementations
  - `BUILD_GUIDE_PHASE_2.md` — current codebase inventory
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/identity.ts && echo "identity.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "export function loadAgentConfig" src/identity.ts && echo "loadAgentConfig exported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "export function resolveIdentity" src/identity.ts && echo "resolveIdentity exported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "readFileSync" src/identity.ts && echo "readFileSync used" || exit 1
  ```
- **Done When**:
  1. `src/identity.ts` exists and exports `loadAgentConfig()` and `resolveIdentity()`
  2. `loadAgentConfig()` reads `SLACK_AGENT_CONFIG_PATH` env var, returns `AgentConfig | null`
  3. `loadAgentConfig()` returns `null` if env var is not set
  4. `loadAgentConfig()` logs warning and returns `null` if file not found
  5. `loadAgentConfig()` validates `version` field equals `"1.0"` and `defaultIdentity` exists — throws on invalid
  6. `resolveIdentity(args, config)` takes explicit params + config, returns `AgentIdentity | null`
  7. Resolution order: explicit username > agent_id lookup > defaultIdentity > null
  8. Returns `null` (not empty string) when no identity applies and no config loaded

---

#### Task 1.2: Config Files

- **Description**: Create the `config/` directory with `agent-identities.example.json` (generic placeholder roles, not Dev Team specific) and `agent-identity-schema.json` (JSON Schema for config validation).
- **Files**:
  - Creates: `config/agent-identities.example.json`
  - Creates: `config/agent-identity-schema.json`
- **Dependencies**: None (Wave 1)
- **Context Needed**:
  - `docs/build-plan.md` Section 4.1 (lines 190-243) — full JSON Schema
  - `docs/build-plan.md` Section 4.2 (lines 248-266) — generic example config
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f config/agent-identities.example.json && echo "example config exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f config/agent-identity-schema.json && echo "schema exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && node -e "const c=JSON.parse(require('fs').readFileSync('config/agent-identities.example.json','utf8')); console.assert(c.version==='1.0','version wrong'); console.assert(c.defaultIdentity,'no defaultIdentity'); console.assert(c.agents,'no agents'); console.log('example config OK')"
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && node -e "const s=JSON.parse(require('fs').readFileSync('config/agent-identity-schema.json','utf8')); console.assert(s.required.includes('version'),'version not required'); console.assert(s.required.includes('defaultIdentity'),'defaultIdentity not required'); console.log('schema OK')"
  ```
- **Done When**:
  1. `config/agent-identities.example.json` contains generic roles (`agent-alpha`, `agent-beta`) with `version: "1.0"`, `defaultIdentity`, and `agents` map
  2. `config/agent-identity-schema.json` matches the schema from build-plan Section 4.1
  3. Both files are valid JSON
  4. Example config uses generic placeholders, not Dev Team role names

---

#### Task 1.3: Type Updates (`src/types.ts`)

- **Description**: Add `PostMessageOptions`, `AgentIdentity`, and `AgentConfig` interfaces to the shared types file. `PostMessageOptions` replaces the positional args for `postMessage` with a single options object containing all parameters from the fork-spec Section 2.2.
- **Files**:
  - Modifies: `src/types.ts`
- **Dependencies**: None (Wave 1)
- **Context Needed**:
  - `src/types.ts` — current content
  - `docs/fork-spec.md` Section 2.2 (lines 128-171) — `PostMessageOptions` interface
  - `docs/fork-spec.md` Section 3.2 (lines 381-393) — `AgentIdentity`, `AgentConfig` interfaces
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "PostMessageOptions" src/types.ts && echo "PostMessageOptions found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "AgentIdentity" src/types.ts && echo "AgentIdentity found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "AgentConfig" src/types.ts && echo "AgentConfig found" || exit 1
  ```
- **Done When**:
  1. `src/types.ts` exports `PostMessageOptions` with fields: `channel_id`, `text`, `thread_ts?`, `reply_broadcast?`, `username?`, `icon_emoji?`, `icon_url?`, `metadata?`, `unfurl_links?`, `unfurl_media?`, `blocks?`
  2. `src/types.ts` exports `AgentIdentity` with fields: `username`, `icon_emoji?`, `icon_url?`, `color?`, `role?`
  3. `src/types.ts` exports `AgentConfig` with fields: `version`, `defaultIdentity`, `agents`
  4. Existing interfaces preserved, no breaking changes

---

### Wave 2: Integration — SlackClient + Tool Schema Updates

#### Task 2.1: Modify `SlackClient.postMessage()` and `postReply()`

- **Description**: Change `postMessage()` from positional args `(channel_id, text)` to accept `PostMessageOptions` object. Build the request body dynamically, including identity fields (`username`, `icon_emoji`, `icon_url`) when present. Refactor `postReply()` to delegate to `postMessage()` with `thread_ts` set, per fork-spec Section 2.4.
- **Files**:
  - Modifies: `src/slack-client.ts`
- **Dependencies**: Task 1.3 (types must exist)
- **Context Needed**:
  - `src/slack-client.ts` — current implementation
  - `src/types.ts` — `PostMessageOptions` interface (from Task 1.3)
  - `docs/fork-spec.md` Section 2.2 (lines 145-171) — `postMessage` with options
  - `docs/fork-spec.md` Section 2.4 (lines 234-255) — `postReply` delegation
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "PostMessageOptions" src/slack-client.ts && echo "PostMessageOptions used" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "opts.username" src/slack-client.ts && echo "username field handled" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "opts.icon_emoji" src/slack-client.ts && echo "icon_emoji field handled" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build 2>&1 | tail -5
  ```
- **Done When**:
  1. `postMessage(opts: PostMessageOptions)` accepts a single options object
  2. Request body includes `username`, `icon_emoji`, `icon_url` when present in opts
  3. Request body includes `thread_ts`, `reply_broadcast`, `metadata`, `unfurl_links`, `unfurl_media`, `blocks` when present
  4. Request body omits identity fields when not present (no `username: undefined` in JSON)
  5. `postReply()` delegates to `postMessage()` with `thread_ts` set
  6. `npm run build` compiles without errors

---

#### Task 2.2: Update Tool Schemas (`src/tools/messages.ts`)

- **Description**: Add `agent_id`, `username`, `icon_emoji`, `icon_url` optional parameters to `slack_post_message` and `slack_reply_to_thread` tool schemas. Import and call `resolveIdentity()` in the tool handlers to resolve identity before calling `client.postMessage()`. Pass resolved identity fields into `PostMessageOptions`. When `resolveIdentity()` returns `null`, do not include identity fields.
- **Files**:
  - Modifies: `src/tools/messages.ts`
- **Dependencies**: Task 1.1 (identity module), Task 1.3 (types), Task 2.1 (updated postMessage signature)
- **Context Needed**:
  - `src/tools/messages.ts` — current implementation
  - `src/identity.ts` — `resolveIdentity()` function (from Task 1.1)
  - `docs/fork-spec.md` Section 2.3 (lines 176-225) — updated tool definitions
  - `docs/fork-spec.md` Section 3.3 (lines 449-455) — agent_id parameter
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "agent_id" src/tools/messages.ts && echo "agent_id param found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "resolveIdentity" src/tools/messages.ts && echo "resolveIdentity called" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "icon_emoji" src/tools/messages.ts && echo "icon_emoji param found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build 2>&1 | tail -5
  ```
- **Done When**:
  1. `slack_post_message` schema includes `agent_id`, `username`, `icon_emoji`, `icon_url` as optional z.string() params
  2. `slack_reply_to_thread` schema includes `agent_id`, `username`, `icon_emoji`, `icon_url` as optional z.string() params
  3. Both handlers call `resolveIdentity()` with the tool args and loaded config
  4. Resolved identity fields spread into `PostMessageOptions` when not null
  5. Identity fields omitted from `PostMessageOptions` when `resolveIdentity()` returns null
  6. `registerMessageTools()` accepts config parameter: `registerMessageTools(server, client, config?)`
  7. `npm run build` compiles without errors

---

#### Task 2.3: Startup Config Loading (`src/index.ts`)

- **Description**: In `main()`, after auth.test validation, call `loadAgentConfig()` to load identity config. Pass the config to `createSlackServer()` which passes it to `registerMessageTools()`. Log warning if `SLACK_AGENT_CONFIG_PATH` is set but config loading returns null (file not found).
- **Files**:
  - Modifies: `src/index.ts`
- **Dependencies**: Task 1.1 (identity module), Task 2.2 (messages.ts accepts config)
- **Context Needed**:
  - `src/index.ts` — current implementation
  - `src/identity.ts` — `loadAgentConfig()` function
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "loadAgentConfig" src/index.ts && echo "loadAgentConfig called" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "SLACK_AGENT_CONFIG_PATH" src/index.ts && echo "env var referenced" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build 2>&1 | tail -5
  ```
- **Done When**:
  1. `main()` calls `loadAgentConfig()` after auth.test
  2. Config is passed through `createSlackServer(slackClient, config)` to `registerMessageTools(server, slackClient, config)`
  3. If `SLACK_AGENT_CONFIG_PATH` is set but `loadAgentConfig()` returns null, a warning is logged
  4. If `SLACK_AGENT_CONFIG_PATH` is not set, no warning
  5. `npm run build` compiles without errors

---

### Wave 3: Tests

#### Task 3.1: Identity Unit Tests (`tests/unit/identity.test.ts`)

- **Description**: Create unit tests for `loadAgentConfig()` and `resolveIdentity()`. Cover all 4 resolution tiers, config loading success/failure, schema validation (missing version, missing defaultIdentity), and null return on no match. Use `vi.mock('node:fs')` to mock `readFileSync`.
- **Files**:
  - Creates: `tests/unit/identity.test.ts`
- **Dependencies**: Wave 2 complete (build must pass)
- **Context Needed**:
  - `src/identity.ts` — functions to test
  - `tests/unit/slack-client.test.ts` — existing test patterns (mock style, imports)
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f tests/unit/identity.test.ts && echo "identity test file exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "resolveIdentity" tests/unit/identity.test.ts && echo "resolveIdentity tested" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "loadAgentConfig" tests/unit/identity.test.ts && echo "loadAgentConfig tested" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npx vitest run tests/unit/identity.test.ts 2>&1 | tail -10
  ```
- **Done When**:
  1. `tests/unit/identity.test.ts` exists with Vitest imports
  2. Tests cover: explicit username takes priority over agent_id
  3. Tests cover: agent_id lookup returns matching config entry
  4. Tests cover: defaultIdentity returned when no agent_id match
  5. Tests cover: null returned when no config loaded and no explicit params
  6. Tests cover: `loadAgentConfig()` returns valid config from file
  7. Tests cover: `loadAgentConfig()` returns null when env var not set
  8. Tests cover: `loadAgentConfig()` logs warning when file not found
  9. Tests cover: `loadAgentConfig()` throws on invalid config (missing version)
  10. Tests cover: `loadAgentConfig()` throws on invalid config (missing defaultIdentity)
  11. All identity tests pass

---

#### Task 3.2: Update SlackClient Tests

- **Description**: Update existing `slack-client.test.ts` tests for the new `postMessage(opts)` and `postReply()` signatures. Test that identity fields (`username`, `icon_emoji`) are included in the request body when provided, and omitted when not.
- **Files**:
  - Modifies: `tests/unit/slack-client.test.ts`
- **Dependencies**: Wave 2 complete (build must pass), Task 3.1 (can run parallel since different file)
- **Context Needed**:
  - `tests/unit/slack-client.test.ts` — current tests
  - `src/slack-client.ts` — updated method signatures
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "PostMessageOptions\|username\|icon_emoji" tests/unit/slack-client.test.ts && echo "identity fields tested" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npx vitest run tests/unit/slack-client.test.ts 2>&1 | tail -10
  ```
- **Done When**:
  1. `postMessage` test updated to use `PostMessageOptions` object syntax
  2. New test: `postMessage` with `username` and `icon_emoji` includes them in request body
  3. New test: `postMessage` without identity fields omits them from request body
  4. `postReply` test updated for new delegation behavior (calls postMessage under the hood)
  5. All existing tests still pass after signature updates
  6. `npm test` passes all tests (identity + slack-client)

---

## Parallelization Map

| Wave | Tasks | Parallel? | Justification |
|------|-------|-----------|---------------|
| 1 | 1.1, 1.2, 1.3 | Yes | Each creates/modifies independent files |
| 2 | 2.1, 2.2, 2.3 | No | 2.1 must finish before 2.2 (postMessage signature); 2.2 before 2.3 (messages.ts accepts config) |
| 3 | 3.1, 3.2 | Yes | Different test files, no shared writes |

---

## File Ownership Guarantee

| File | Owner Task | Access |
|------|-----------|--------|
| `src/identity.ts` | 1.1 | Write (create) |
| `config/agent-identities.example.json` | 1.2 | Write (create) |
| `config/agent-identity-schema.json` | 1.2 | Write (create) |
| `src/types.ts` | 1.3 | Write (modify) |
| `src/slack-client.ts` | 2.1 | Write (modify) |
| `src/tools/messages.ts` | 2.2 | Write (modify) |
| `src/index.ts` | 2.3 | Write (modify) |
| `tests/unit/identity.test.ts` | 3.1 | Write (create) |
| `tests/unit/slack-client.test.ts` | 3.2 | Write (modify) |
| `src/identity.ts` | 3.1 | Read only |
| `src/slack-client.ts` | 3.2 | Read only |

**Conflict check**: No two parallel tasks write to the same file. PASS.

---

## Test Plan

| Test File | Tasks Covered | Expected Tests |
|-----------|---------------|----------------|
| `tests/unit/identity.test.ts` | 3.1 | ~10 (4 resolution tiers + config loading success/null/warning/throw-version/throw-default) |
| `tests/unit/slack-client.test.ts` | 3.2 | ~13 (11 existing + 2 new identity field tests) |

**Existing**: 11 tests (slack-client)
**New**: ~12 (10 identity + 2 slack-client updates)
**Total after phase**: ~23

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| `readFileSync` mock in tests leaks to other test files | Low | Medium | Use `vi.mock('node:fs')` scoped to identity.test.ts, restore in afterEach |
| Existing `postMessage`/`postReply` tests break after signature change | High | Medium | Task 3.2 explicitly updates these tests; run full regression after Wave 2 |
| `resolveIdentity` returning stale config if env changes at runtime | Low | Low | Config loaded once at startup — documented behavior |

---

## Git Checkpoints

| Wave | Commit Message |
|------|----------------|
| 1 | `feat(phase-2-w1): add identity module, config schema, and type updates` |
| 2 | `feat(phase-2-w2): wire identity into postMessage and tool schemas` |
| 3 | `feat(phase-2-w3): add identity tests and update slack-client tests` |

---

## Verification Commands

```bash
# Wave 1 verification (structure check — build may have type errors until Wave 2)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && ls src/identity.ts config/agent-identities.example.json config/agent-identity-schema.json && echo "Wave 1 files exist"

# Wave 2 verification (full build)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build 2>&1 | tail -10

# Wave 3 verification (all tests)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm test

# Full regression
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build && npm test
```

---

## Skill Decision Log

| ID | Decision | Rationale | Phase |
|----|----------|-----------|-------|
| | | | |

---

## Issues Log

| ID | Issue | Status | Resolution |
|----|-------|--------|------------|
| | | | |

---

## Phase Completion Checklist

- [ ] All tasks complete with "Done When" verified
- [ ] All smoke tests pass
- [ ] `npm run build` compiles without errors
- [ ] `npm test` passes all unit tests (~23 total)
- [ ] `resolveIdentity()` implements 3-tier resolution correctly
- [ ] `resolveIdentity()` returns null (not empty string) when no identity
- [ ] `loadAgentConfig()` throws on invalid config
- [ ] `postMessage()` includes identity fields when resolved
- [ ] `postMessage()` omits identity fields when null
- [ ] Startup logs warning for missing config file
- [ ] Config files in config/ directory
- [ ] Git commits per wave complete
