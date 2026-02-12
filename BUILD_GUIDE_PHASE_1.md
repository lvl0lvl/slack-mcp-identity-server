# Build Guide — Phase 1: Core Server — Fork Restructure + Build Infrastructure

## Phase Goal
Split the single-file Zencoder upstream into a multi-file layout, set up TypeScript build and Vitest test infrastructure, verify the 8 existing tools still work, and add startup token validation via `auth.test`.

## Project Context
- **Stack:** TypeScript (ES2022 target, Node16 module resolution), MCP SDK 1.15.1 (pinned, no caret), Zod, Express (optional, for HTTP transport)
- **Layout:** Currently single-file (`index.ts` at root, ~664 lines). Target: `src/` directory with modular files, `tests/unit/` for tests
- **Conventions:** ESM (`"type": "module"`), `McpServer.registerTool()` API with Zod schemas, raw `fetch()` for Slack API calls, `botHeaders` pattern for auth
- **Node version:** v24.12.0, npm 11.6.2
- **Test framework:** Vitest (replacing Jest from upstream). Use `import { describe, it, expect, vi } from 'vitest'`
- **Package name target:** `slack-mcp-identity-server`

## What Exists

### Source Files
- `index.ts` (root, 664 lines) — Contains everything: `SlackClient` class, 8 tool registrations via `createSlackServer()`, `parseArgs()`, `main()`, `runStdioServer()`, `runHttpServer()`, type interfaces, express HTTP transport with session management
- `tests/slack-mcp-server.test.ts` (503 lines) — Jest-based tests for SlackClient methods, createSlackServer, parseArgs, main, HTTP server. Uses `@jest/globals` imports and `jest.mock()`/`jest.fn()`

### Config Files
- `package.json` — Named `@zencoderai/slack-mcp-server`, uses Jest (`@jest/globals`, `ts-jest`), scripts use `node --experimental-vm-modules node_modules/.bin/jest`
- `tsconfig.json` — ES2022/Node16/strict, rootDir `.`, outDir `./dist`, includes `./**/*.ts`
- `jest.config.js` — Jest config file (to be replaced by vitest.config.ts)
- `.gitignore` — Already covers dist/, node_modules/, .env

### Other Files
- `Dockerfile` — Docker setup for the server
- `README.md` — Upstream readme (will be replaced in Phase 7)
- `LICENSE` — MIT
- `docs/fork-spec.md` (1,696 lines) — Full TypeScript implementations for all components
- `docs/build-plan.md` — 7-phase build plan with target package.json, tsconfig.json, vitest config
- `discovery/` — Discovery artifacts directory
- `.github/` — GitHub Actions workflows

### 8 Existing Tools
1. `slack_list_channels` — conversations.list / conversations.info (with SLACK_CHANNEL_IDS support)
2. `slack_post_message` — chat.postMessage (channel + text only)
3. `slack_reply_to_thread` — chat.postMessage with thread_ts
4. `slack_add_reaction` — reactions.add
5. `slack_get_channel_history` — conversations.history
6. `slack_get_thread_replies` — conversations.replies
7. `slack_get_users` — users.list
8. `slack_get_user_profile` — users.profile.get

### SlackClient Methods
- `getChannels(limit, cursor)` — with SLACK_CHANNEL_IDS branching
- `postMessage(channel_id, text)` — simple two-param version
- `postReply(channel_id, thread_ts, text)` — three-param version
- `addReaction(channel_id, timestamp, reaction)`
- `getChannelHistory(channel_id, limit)`
- `getThreadReplies(channel_id, thread_ts)`
- `getUsers(limit, cursor)`
- `getUserProfile(user_id)`

### Type Interfaces (in index.ts)
- `ListChannelsArgs`, `PostMessageArgs`, `ReplyToThreadArgs`, `AddReactionArgs`, `GetChannelHistoryArgs`, `GetThreadRepliesArgs`, `GetUsersArgs`, `GetUserProfileArgs`

## Prior Phase Status
- **Tests:** Not runnable — node_modules not installed. Upstream tests use Jest, which will be replaced.
- **Blockers from prior work:** None. This is Phase 1 (foundation).
- **Deferred items landing here:** None (HANDOFF.md is empty).

## Open Issues (Beads)
No beads tracking in this project.

## Prior Plan Patterns
No prior PLAN.md files exist. This is the first phase.

## Blockers
None. The project is ready for Phase 1 planning.

## Unclear Requirements

1. **`main()` auto-execution guard:** The upstream `index.ts` has a complex guard (lines 643-664) to prevent `main()` from running during tests. The restructured `src/index.ts` needs a clean equivalent for Vitest (not Jest-specific checks).

2. **HTTP transport in Phase 1 scope:** The upstream includes full HTTP transport with Express, session management, auth middleware, and health endpoint. The ROADMAP says Phase 1 delivers `src/index.ts` with "transport selection (stdio default, HTTP via `--transport http`)". The build-plan Section 7.2 puts Express in `optionalDependencies`. Phase 1 must preserve HTTP transport functionality.

3. **Existing test file disposition:** `tests/slack-mcp-server.test.ts` uses Jest APIs. The Phase 1 deliverable is `tests/unit/slack-client.test.ts` using Vitest. The old test file should be deleted or replaced, not left alongside.

## Technical Unknowns

1. **`auth.test` API call pattern:** The server must call `https://slack.com/api/auth.test` on startup with the bot token. If successful, log the `team` and `user` (app name). If failed (invalid token), log error and `process.exit(1)`. This is straightforward but needs to work before MCP transport setup.

2. **Module auto-run detection in ESM:** The current `import.meta.url` comparison for detecting "am I the main module" is fragile and Jest-specific. For Vitest, the approach needs review — Vitest may handle module imports differently.

## Preflight Notes
No preflight or cascade notes from prior sessions. HANDOFF.md tables are empty.

## Target File Layout (from ROADMAP + build-plan)
```
src/
  index.ts              # Entry point: server setup, transport selection
  slack-client.ts       # SlackClient class extracted from index.ts
  types.ts              # Shared TypeScript interfaces
  tools/
    channels.ts         # slack_list_channels
    messages.ts         # slack_post_message, slack_reply_to_thread, slack_get_channel_history, slack_get_thread_replies
    reactions.ts        # slack_add_reaction
    users.ts            # slack_get_users, slack_get_user_profile
tests/
  unit/
    slack-client.test.ts  # Unit tests for SlackClient methods
tsconfig.json           # Updated: rootDir ./src, include src/**/*
vitest.config.ts        # New: Vitest configuration
package.json            # Updated: name, scripts, deps (Vitest replaces Jest)
.gitignore              # Already exists, may need minor updates
```

## Target package.json (from build-plan Section 7.2)
Key changes from current:
- Name: `slack-mcp-identity-server` (was `@zencoderai/slack-mcp-server`)
- Scripts: `"build": "tsc"`, `"test": "vitest run"`, `"lint": "tsc --noEmit"`
- Dependencies: `@modelcontextprotocol/sdk` stays at `1.15.1` (no caret — already correct)
- DevDependencies: Remove `@jest/globals`, `@types/jest`, `jest`, `ts-jest`. Add `vitest ^3.0.0`.
- Express moves to `optionalDependencies`
- Remove `shx` from devDependencies

## Target tsconfig.json (from build-plan Section 7.1)
Key changes from current:
- `rootDir`: `./src` (was `.`)
- `declaration`: `true` (new)
- `sourceMap`: `true` (new)
- `include`: `["src/**/*"]` (was `["./**/*.ts"]`)
- `exclude`: `["tests/**/*", "dist/**/*"]` (was `["node_modules"]`)
