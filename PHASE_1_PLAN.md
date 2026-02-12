# PHASE 1: Core Server — Fork Restructure + Build Infrastructure

**Date**: 2026-02-12
**Status**: Planning
**Version Target**: 0.1.0

---

## Overview

Split the single-file Zencoder upstream (`index.ts`, ~664 lines) into a multi-file layout under `src/`, replace Jest with Vitest, update package.json and tsconfig.json for the new structure, and add startup `auth.test` token validation. All 8 existing tools must remain registered and produce identical API calls.

**Goal**: Working multi-file MCP server with Vitest test infrastructure and startup token validation.

**Requirements Addressed**: R1 (multi-file structure), R7 (startup token validation), R11 (build and test infrastructure)

**Success Criteria**:
1. `npm run build` compiles without errors
2. `npm test` runs unit tests and all pass
3. All 8 existing tools are registered and respond to MCP `tools/list`
4. Server starts with valid `SLACK_BOT_TOKEN` and logs app name from `auth.test`
5. Server logs error and exits on invalid bot token
6. No behavioral regression — existing tools produce identical API calls

---

## Dependency Graph

```
Wave 1: Infrastructure + Source Extraction (parallel)
   ├── Task 1.1 (config files) ──┐
   ├── Task 1.2 (types.ts) ──────┤
   ├── Task 1.3 (slack-client.ts) ┼──→ Wave 2
   ├── Task 1.4 (tools/channels) ─┤
   ├── Task 1.5 (tools/messages) ─┤
   ├── Task 1.6 (tools/reactions) ┤
   └── Task 1.7 (tools/users) ────┘
                                      └── Task 2.1 (src/index.ts) ──→ Wave 3
                                                                        └── Task 3.1 (unit tests)
```

---

## Wave Structure

### Wave 1: Infrastructure + Source File Extraction

#### Task 1.1: Build Configuration Files

- **Description**: Create the build infrastructure: update `package.json` (rename, swap Jest for Vitest, update scripts, move Express to optionalDependencies), update `tsconfig.json` (rootDir to `./src`, add declaration/sourceMap), create `vitest.config.ts`, create `src/` and `src/tools/` directories, and delete `jest.config.js`.
- **Files**:
  - Modifies: `package.json`
  - Modifies: `tsconfig.json`
  - Creates: `vitest.config.ts`
  - Deletes: `jest.config.js`
- **Dependencies**: None (first wave)
- **Context Needed**:
  - `docs/build-plan.md` (Section 7.1 tsconfig, Section 7.2 package.json)
  - `BUILD_GUIDE_PHASE_1.md` (target configs)
  - Current `package.json`, `tsconfig.json`, `jest.config.js`
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && cat package.json | node -e "const p=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.assert(p.name==='slack-mcp-identity-server','name wrong'); console.assert(p.dependencies['@modelcontextprotocol/sdk']==='1.15.1','sdk not pinned'); console.assert(!p.devDependencies['@jest/globals'],'jest not removed'); console.assert(p.devDependencies['vitest'],'vitest missing'); console.assert(p.scripts.test==='vitest run','test script wrong'); console.log('package.json OK')"
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && cat tsconfig.json | node -e "const t=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.assert(t.compilerOptions.rootDir==='./src','rootDir wrong'); console.assert(t.compilerOptions.declaration===true,'declaration missing'); console.assert(t.include[0]==='src/**/*','include wrong'); console.log('tsconfig.json OK')"
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f vitest.config.ts && echo "vitest.config.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test ! -f jest.config.js && echo "jest.config.js removed" || exit 1
  ```
- **Done When**:
  1. `package.json` has name `slack-mcp-identity-server`, Vitest in devDependencies, Jest references removed, `"test": "vitest run"`, MCP SDK pinned to `1.15.1` (no caret), Express in optionalDependencies
  2. `tsconfig.json` has rootDir `./src`, declaration true, sourceMap true, include `["src/**/*"]`
  3. `vitest.config.ts` exists with valid Vitest configuration
  4. `jest.config.js` is deleted

---

#### Task 1.2: Shared Types File

- **Description**: Create `src/types.ts` containing all shared TypeScript interfaces extracted from `index.ts`. These are the argument interfaces (`ListChannelsArgs`, `PostMessageArgs`, etc.) and any shared response types needed by the tool files and SlackClient.
- **Files**:
  - Creates: `src/types.ts`
- **Dependencies**: None (parallel with 1.1)
- **Context Needed**:
  - `index.ts` (lines 12-51 — interface definitions)
  - `docs/fork-spec.md` (Section 2.2 — PostMessageOptions for future, but Phase 1 keeps simple signatures)
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/types.ts && echo "types.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "ListChannelsArgs" src/types.ts && echo "ListChannelsArgs found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "export" src/types.ts && echo "exports found" || exit 1
  ```
- **Done When**:
  1. `src/types.ts` exists and exports all 8 arg interfaces from `index.ts`
  2. All interfaces use `export interface` syntax
  3. No runtime code — only type definitions

---

#### Task 1.3: SlackClient Extraction

- **Description**: Extract the `SlackClient` class from `index.ts` into `src/slack-client.ts`. Keep the same method signatures and behavior. Add an `authTest()` method that calls `https://slack.com/api/auth.test` and returns the response. Import types from `./types.ts`.
- **Files**:
  - Creates: `src/slack-client.ts`
- **Dependencies**: None (parallel, reads original `index.ts` for reference)
- **Context Needed**:
  - `index.ts` (lines 53-221 — SlackClient class)
  - `docs/build-plan.md` (Section 8, Phase 1, step 4 — auth.test requirement)
  - `docs/fork-spec.md` (Section 2.6 — SlackClient constructor pattern)
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/slack-client.ts && echo "slack-client.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "export class SlackClient" src/slack-client.ts && echo "SlackClient class exported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "authTest" src/slack-client.ts && echo "authTest method found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "getChannels" src/slack-client.ts && echo "getChannels found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "postMessage" src/slack-client.ts && echo "postMessage found" || exit 1
  ```
- **Done When**:
  1. `src/slack-client.ts` exports `SlackClient` class with all 8 original methods (getChannels, postMessage, postReply, addReaction, getChannelHistory, getThreadReplies, getUsers, getUserProfile)
  2. New `authTest()` method calls `https://slack.com/api/auth.test` with bot headers and returns JSON response
  3. Method signatures and fetch URLs are identical to original
  4. Imports types from `./types.js`

---

#### Task 1.4: Channels Tool File

- **Description**: Create `src/tools/channels.ts` containing the `slack_list_channels` tool registration function. Export a function that takes `McpServer` and `SlackClient` and registers the tool.
- **Files**:
  - Creates: `src/tools/channels.ts`
- **Dependencies**: None (parallel)
- **Context Needed**:
  - `index.ts` (lines 230-246 — slack_list_channels tool registration)
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/tools/channels.ts && echo "channels.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "slack_list_channels" src/tools/channels.ts && echo "tool name found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "export" src/tools/channels.ts && echo "export found" || exit 1
  ```
- **Done When**:
  1. `src/tools/channels.ts` exports a function `registerChannelTools(server: McpServer, client: SlackClient)`
  2. `slack_list_channels` tool is registered with identical schema and handler to original
  3. Imports `McpServer` from MCP SDK, `SlackClient` from `../slack-client.js`, `z` from `zod`

---

#### Task 1.5: Messages Tool File

- **Description**: Create `src/tools/messages.ts` containing tool registrations for `slack_post_message`, `slack_reply_to_thread`, `slack_get_channel_history`, and `slack_get_thread_replies`. Export a registration function.
- **Files**:
  - Creates: `src/tools/messages.ts`
- **Dependencies**: None (parallel)
- **Context Needed**:
  - `index.ts` (lines 248-338 — four message tool registrations)
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/tools/messages.ts && echo "messages.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "slack_post_message" src/tools/messages.ts && echo "post_message found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "slack_reply_to_thread" src/tools/messages.ts && echo "reply_to_thread found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "slack_get_channel_history" src/tools/messages.ts && echo "get_history found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "slack_get_thread_replies" src/tools/messages.ts && echo "get_replies found" || exit 1
  ```
- **Done When**:
  1. `src/tools/messages.ts` exports `registerMessageTools(server: McpServer, client: SlackClient)`
  2. All 4 message tools registered with identical schemas and handlers to original
  3. Imports from MCP SDK, slack-client, and zod

---

#### Task 1.6: Reactions Tool File

- **Description**: Create `src/tools/reactions.ts` containing the `slack_add_reaction` tool registration. Export a registration function.
- **Files**:
  - Creates: `src/tools/reactions.ts`
- **Dependencies**: None (parallel)
- **Context Needed**:
  - `index.ts` (lines 285-302 — slack_add_reaction tool registration)
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/tools/reactions.ts && echo "reactions.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "slack_add_reaction" src/tools/reactions.ts && echo "add_reaction found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "export" src/tools/reactions.ts && echo "export found" || exit 1
  ```
- **Done When**:
  1. `src/tools/reactions.ts` exports `registerReactionTools(server: McpServer, client: SlackClient)`
  2. `slack_add_reaction` tool registered with identical schema and handler
  3. Imports from MCP SDK, slack-client, and zod

---

#### Task 1.7: Users Tool File

- **Description**: Create `src/tools/users.ts` containing `slack_get_users` and `slack_get_user_profile` tool registrations. Export a registration function.
- **Files**:
  - Creates: `src/tools/users.ts`
- **Dependencies**: None (parallel)
- **Context Needed**:
  - `index.ts` (lines 340-374 — two user tool registrations)
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/tools/users.ts && echo "users.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "slack_get_users" src/tools/users.ts && echo "get_users found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "slack_get_user_profile" src/tools/users.ts && echo "get_user_profile found" || exit 1
  ```
- **Done When**:
  1. `src/tools/users.ts` exports `registerUserTools(server: McpServer, client: SlackClient)`
  2. Both user tools registered with identical schemas and handlers
  3. Imports from MCP SDK, slack-client, and zod

---

### Wave 2: Entry Point Assembly

#### Task 2.1: Entry Point (src/index.ts)

- **Description**: Create `src/index.ts` as the new entry point that imports `SlackClient`, all tool registration functions, and assembles the server. Includes: `createSlackServer()` function that calls all tool registration functions, `parseArgs()`, `main()` with `auth.test` startup validation, `runStdioServer()`, `runHttpServer()` (preserving full HTTP transport), graceful shutdown handlers. On startup, call `slackClient.authTest()` — on success log app name, on failure log error and exit. Delete the old root `index.ts` and `tests/slack-mcp-server.test.ts`.
- **Files**:
  - Creates: `src/index.ts`
  - Deletes: `index.ts` (root)
  - Deletes: `tests/slack-mcp-server.test.ts`
- **Dependencies**: Wave 1 complete (all source files must exist)
- **Context Needed**:
  - `index.ts` (original — lines 223-664 for createSlackServer, parseArgs, main, runStdioServer, runHttpServer, graceful shutdown)
  - `src/slack-client.ts` (from Task 1.3)
  - `src/tools/*.ts` (from Tasks 1.4-1.7)
  - `docs/build-plan.md` (Section 8, Phase 1, step 4 — auth.test behavior)
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/index.ts && echo "src/index.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test ! -f index.ts && echo "root index.ts removed" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test ! -f tests/slack-mcp-server.test.ts && echo "old test removed" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "auth.test" src/index.ts && echo "auth.test call found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "registerChannelTools" src/index.ts && echo "channel tools imported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "registerMessageTools" src/index.ts && echo "message tools imported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "registerReactionTools" src/index.ts && echo "reaction tools imported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "registerUserTools" src/index.ts && echo "user tools imported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm install && npm run build 2>&1 | tail -5
  ```
- **Done When**:
  1. `src/index.ts` exists with hashbang `#!/usr/bin/env node`
  2. `createSlackServer()` calls all 4 tool registration functions and returns the McpServer
  3. `main()` calls `slackClient.authTest()` before starting transport — logs app name on success, exits on failure
  4. HTTP transport code preserved (Express, session management, auth middleware, health endpoint)
  5. `parseArgs()` preserved with stdio/http transport selection
  6. Graceful shutdown handlers preserved
  7. Root `index.ts` deleted
  8. `tests/slack-mcp-server.test.ts` deleted
  9. `npm install` succeeds
  10. `npm run build` compiles without errors

---

### Wave 3: Unit Tests

#### Task 3.1: SlackClient Unit Tests

- **Description**: Create `tests/unit/slack-client.test.ts` with Vitest tests covering all 8 SlackClient methods plus the new `authTest()` method. Mock `global.fetch` using `vi.fn()`. Test that each method calls the correct Slack API URL with the correct headers and body. Also test `auth.test` success (returns app name) and failure (returns ok: false) paths.
- **Files**:
  - Creates: `tests/unit/slack-client.test.ts`
- **Dependencies**: Wave 2 complete (build must pass first)
- **Context Needed**:
  - `src/slack-client.ts` (methods to test)
  - `tests/slack-mcp-server.test.ts` (original test patterns — already deleted but read from git or original `index.ts` analysis)
  - `docs/build-plan.md` (Section 7.3 — testing approach)
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f tests/unit/slack-client.test.ts && echo "test file exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "import.*describe.*from.*vitest" tests/unit/slack-client.test.ts && echo "vitest imports found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm test 2>&1 | tail -20
  ```
- **Done When**:
  1. `tests/unit/slack-client.test.ts` exists using Vitest (`import { describe, it, expect, vi } from 'vitest'`)
  2. Tests cover all 8 original methods: getChannels (with and without SLACK_CHANNEL_IDS), postMessage, postReply, addReaction, getChannelHistory, getThreadReplies, getUsers, getUserProfile
  3. Tests cover `authTest()` success path (ok: true, logs app name)
  4. Tests cover `authTest()` failure path (ok: false or network error)
  5. All tests use `vi.fn()` to mock `global.fetch`
  6. `npm test` passes with all tests green

---

## Parallelization Map

| Wave | Tasks | Parallel? | Justification |
|------|-------|-----------|---------------|
| 1 | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7 | Yes | Each creates independent files, no shared writes |
| 2 | 2.1 | N/A | Single task, depends on all Wave 1 files |
| 3 | 3.1 | N/A | Single task, depends on successful build from Wave 2 |

---

## File Ownership Guarantee

| File | Owner Task | Access |
|------|-----------|--------|
| `package.json` | 1.1 | Write |
| `tsconfig.json` | 1.1 | Write |
| `vitest.config.ts` | 1.1 | Write (create) |
| `jest.config.js` | 1.1 | Delete |
| `src/types.ts` | 1.2 | Write (create) |
| `src/slack-client.ts` | 1.3 | Write (create) |
| `src/tools/channels.ts` | 1.4 | Write (create) |
| `src/tools/messages.ts` | 1.5 | Write (create) |
| `src/tools/reactions.ts` | 1.6 | Write (create) |
| `src/tools/users.ts` | 1.7 | Write (create) |
| `src/index.ts` | 2.1 | Write (create) |
| `index.ts` (root) | 2.1 | Delete |
| `tests/slack-mcp-server.test.ts` | 2.1 | Delete |
| `tests/unit/slack-client.test.ts` | 3.1 | Write (create) |
| `index.ts` (root, original) | All Wave 1 | Read only |

**Conflict check**: No two parallel tasks write to the same file.

---

## Test Plan

| Test File | Tasks Covered | Expected Tests |
|-----------|---------------|----------------|
| `tests/unit/slack-client.test.ts` | 3.1 | ~12 (8 methods + authTest success/fail + getChannels with/without channel IDs) |

**Target**: ~12 new tests
**Existing**: 0 (Jest tests deleted in Wave 2)
**Total after phase**: ~12

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| MCP SDK import paths break with new rootDir | Low | High | Verify exact import paths from node_modules before build |
| Express dynamic import fails as optionalDependency | Low | Medium | Test HTTP transport path after build |
| Vitest config incompatible with ESM+Node16 | Low | Medium | Use defineConfig with correct module settings |

---

## Git Checkpoints

| Wave | Commit Message |
|------|----------------|
| 1 | `feat(phase-1-w1): extract source files and update build config` |
| 2 | `feat(phase-1-w2): assemble entry point with auth.test validation` |
| 3 | `feat(phase-1-w3): add SlackClient unit tests with Vitest` |

---

## Verification Commands

After each wave, run:

```bash
# Wave 1 verification (structure check only — cannot build yet, no index.ts)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && ls src/types.ts src/slack-client.ts src/tools/channels.ts src/tools/messages.ts src/tools/reactions.ts src/tools/users.ts vitest.config.ts

# Wave 2 verification (full build)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm install && npm run build

# Wave 3 verification (tests)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm test
```

---

## Phase Completion Checklist

- [ ] All tasks complete with "Done When" verified
- [ ] All smoke tests pass
- [ ] `npm run build` compiles without errors
- [ ] `npm test` passes all unit tests
- [ ] All 8 tools registered in createSlackServer
- [ ] auth.test startup validation implemented
- [ ] No behavioral regression from upstream
- [ ] Git commits per wave complete
