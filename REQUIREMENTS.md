# Requirements: slack-mcp-identity-server

Requirements traced from `docs/build-plan.md` and `docs/fork-spec.md`. Used by GO Build Phase H Verifier for acceptance validation.

---

## Must Have

### R1: Multi-file project structure
The single-file upstream (`index.ts`) is split into separate modules: `slack-client.ts`, `identity.ts`, `rate-limiter.ts`, `network.ts`, `message-logger.ts`, `types.ts`, and tool files grouped by Slack API domain (`tools/channels.ts`, `tools/messages.ts`, `tools/reactions.ts`, `tools/pins.ts`, `tools/users.ts`).
**Acceptance**: Each file exists, builds without errors, no circular imports.

### R2: 17 MCP tools registered
8 existing tools from upstream + 9 new tools: `slack_update_message`, `slack_create_channel`, `slack_archive_channel`, `slack_set_channel_topic`, `slack_set_channel_purpose`, `slack_remove_reaction`, `slack_pin_message`, `slack_unpin_message`, `slack_search_messages`.
**Acceptance**: MCP `tools/list` returns exactly 17 tools with correct Zod schemas.

### R3: Per-message identity switching
`slack_post_message` and `slack_reply_to_thread` accept `agent_id`, `username`, `icon_emoji`, `icon_url` parameters. Identity resolves via 3-tier hierarchy: explicit params > agent_id config lookup > defaultIdentity. Returns `null` (not empty string) when no identity applies.
**Acceptance**: Unit tests cover all 4 resolution tiers. `postMessage` body includes/excludes identity fields correctly.

### R4: Identity config loading
`loadAgentConfig()` reads from `SLACK_AGENT_CONFIG_PATH`, validates against JSON Schema. Config maps arbitrary agent_id strings to display identities.
**Acceptance**: Valid config loads successfully. Invalid config (missing version, missing defaultIdentity) throws. Missing file path logs warning.

### R5: Priority-based rate limiter
`SlackRateLimiter` with per-method token bucket, priority queue (0=highest, 3=lowest), 429 handling with `Retry-After` header via `_retryAfter` propagation, queue delay warning logging.
**Acceptance**: Unit tests for method limits, priority ordering, 429 retry, queue delay warning.

### R6: fetchWithRetry network resilience
`fetchWithRetry()` with exponential backoff for 5xx and network errors. Does NOT retry 4xx (except 429 handled by rate limiter). Runs INSIDE `rateLimiter.enqueue()`, not wrapping it.
**Acceptance**: Unit tests for backoff, max retries, correct wiring order.

### R7: Startup token validation
Server calls `auth.test` on startup to verify bot token. Logs app name on success, exits on invalid token.
**Acceptance**: Server starts with valid token, logs app name. Server exits with clear error on invalid token.

### R8: Optional JSONL message logging
Disabled by default. Enabled via `SLACK_MESSAGE_LOG` env var. Logs timestamp, channel, agent identity, text, delivery status. No log rotation (consumer responsibility).
**Acceptance**: No file created when env var unset. Correct JSONL format when enabled. Logger does not throw on write failure.

### R9: Dual-token support
Optional `SLACK_USER_TOKEN` for `search.messages` API. Bot token for all other operations. Clear error when search attempted without user token.
**Acceptance**: `searchMessages()` uses user token. Bot token never used for search.

### R10: Channel allow-list
`SLACK_CHANNEL_IDS` restricts read/write operations. `slack_create_channel` exempt (channel doesn't exist yet). `slack_search_messages` inherits from user token permissions.
**Acceptance**: Restricted operations blocked on unlisted channels. Create works regardless. Search unaffected by list.

### R11: Build and test infrastructure
TypeScript strict mode, ES2022 target, Node16 module resolution. Vitest test suite. MCP SDK pinned to `1.15.1` (no caret).
**Acceptance**: `npm run build` succeeds. `npm test` passes. `package.json` shows exact `1.15.1` version.

### R12: Documentation
README covers: what/why, Slack app setup, installation, MCP config, identity system, rate limiting, 17-tool reference, troubleshooting, security note.
**Acceptance**: README contains all 10 sections from build plan Section 10.

### R13: Package distribution
`npm pack` produces tarball with `dist/`, `config/`, `README.md`, `LICENSE`, `package.json`. No tests or source in tarball. Hashbang (`#!/usr/bin/env node`) for npx support.
**Acceptance**: `npm pack --dry-run` shows correct file set. `npx` starts the server.

---

## Should Have

### R14: Generic tool descriptions
Tool descriptions do not reference Dev Team protocols, DACI, or specific governance models. `slack_update_message` says "Edit an existing message", not "Used for decision lifecycle transitions".
**Acceptance**: No tool description contains "Dev Team", "Protocol", "DACI", "PROPOSED", "ACCEPTED", "SUPERSEDED".

### R15: Express as optional dependency
Express in `optionalDependencies`. Dynamic `import('express')` when `--transport http` selected. Stdio-only consumers do not load Express.
**Acceptance**: `npm install` without Express works. Stdio transport starts without Express. HTTP transport fails gracefully if Express missing.

---

## Nice to Have

### R16: Integration tests
Integration tests gated by `TEST_SLACK_BOT_TOKEN`. Skip when credentials unavailable. Cover: post with identity, thread reply, channel lifecycle, reactions, pins, search.
**Acceptance**: `npm test` passes without Slack credentials (integration tests skip). Integration tests pass when credentials provided.
