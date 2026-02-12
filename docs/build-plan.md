# Build Plan: Reusable Slack MCP Server Package

**Date:** 2026-02-12
**Status:** Draft
**Source:** Derived from `slack-mcp-fork-spec.md` (1,696 lines), `protocol-audit-report.md`, `project-handoff.md`, `ADR-001-single-token-identity-spoofing-risk.md`

### Post-Red-Team Fixes Applied (2026-02-12)

The following changes were made in response to the red team review (`reusable-build-plan-redteam.md`):

1. **C3 — fetchWithRetry wrapping order** (Section 8, Phase 3): Specified that `fetchWithRetry` goes INSIDE `rateLimiter.enqueue()`. Network retries stay within the same rate limit slot.
2. **H2 — Startup scope validation** (Section 8, Phase 1): Added step 4 — call `auth.test` on startup to verify bot token; log warning on `missing_scope` when identity config is loaded.
3. **H3 — SDK version pin** (Sections 7.2, 11.1, 13): Changed `"^1.15.1"` to `"1.15.1"` in package.json. Closed Open Question 3.
4. **H4 — Phase parallelism** (Section 8, Phase 4): Corrected dependency — Phase 4 depends on Phase 2 (not just Phase 1). Phases 3 and 4 can parallelize after Phase 2.
5. **H5 — Unused scopes** (Section 5.2): Removed `pins:read` and `reactions:read` from required scopes. Added note that consumers can add them for custom tools.
6. **M1 — Test framework** (Section 8, Phase 1): Added note that test code uses Vitest imports; spec examples referencing Jest APIs need translation.
7. **M2 — Express optional** (Sections 7.2, 11.4, 13): Moved Express from `dependencies` to `optionalDependencies`. Server uses dynamic `import()`. Closed Open Question 4.
8. **M3 — Declaration maps** (Section 7.1): Removed `declarationMap: true` from tsconfig — consumers don't need source navigation into MCP server internals.
9. **M5 — Log rotation** (Section 8, Phase 5): Added step documenting that log rotation is the consumer's responsibility. No rotation in v1.
10. **M6 — Channel allow-list** (Section 5.4): Added new subsection specifying `SLACK_CHANNEL_IDS` behavior for `slack_create_channel` and `slack_search_messages`.

---

## 1. Goal

Build the Slack MCP fork spec into a standalone, reusable npm package that any project can consume. The Dev Team project will be the first consumer, not the only one. The package provides: 17 MCP tools for Slack, per-message identity switching, a priority-based rate limiter, dual-token support, and local message logging. The consuming project provides: its own agent identity config, its own Slack app credentials, and its own channel naming conventions.

---

## 2. What Must Change from the Existing Spec

The fork spec (`slack-mcp-fork-spec.md`) was written for the Dev Team project. The following sections contain Dev Team-specific assumptions that must be removed or parameterized for a reusable package.

### 2.1 Package Name and Ownership

**Spec lines 3-5:**
```
**Package:** `@devteam/slack-mcp-server`
**Author:** Dev Team
```

**Change:** The npm scope `@devteam` is project-specific. The reusable package needs a scope that does not imply a single project.

**Decision needed:** Choose one of:
- `@anthropic-agents/slack-mcp-server` (if intended for community use)
- `@wmcg/slack-mcp-server` (personal scope, low friction)
- No scope: `slack-mcp-identity-server` (avoids scope ownership issues)

**Recommendation:** `@anthropic-agents/slack-mcp-server` is too presumptuous. Use a scoped package under the owner's npm account or an org created for this purpose. The name should communicate what makes this fork different from the upstream: identity switching. Candidate: `slack-mcp-identity-server` (no scope, descriptive).

### 2.2 Agent Identity Config — Dev Team Roles Hardcoded

**Spec lines 319-371 (Section 3.1, Identity Configuration Format):**

The example config hardcodes seven Dev Team roles: `team-lead`, `architect`, `senior-engineer`, `qa-engineer`, `doc-agent`, `devops`, `security-reviewer`. The usernames all start with `[AI]` and use Dev Team-specific role names.

**Change:** The example config in the README should use generic placeholder roles (e.g., `agent-1`, `agent-2`) and the documentation should make clear that the consumer defines all role names and display identities. The server itself does not validate role names — it uses them as lookup keys.

The `color` and `role` fields in the config (lines 329, 330) are informational only — the server does not use them. Document this: they exist for the consumer's reference, not for server behavior.

### 2.3 Channel Naming Convention

**Communication protocols (Protocol 6, lines 506-518) assume `#ai-{repo-name}` naming.**

The reusable package must NOT enforce or assume any channel naming convention. Channel IDs are passed as parameters to every tool call. The package documentation should show examples but explicitly state that channel naming is the consumer's responsibility.

The fork spec itself (lines 1263-1300, Section 7.1 Deployment) shows the MCP server configured with `SLACK_CHANNEL_IDS` env var to restrict channels. This is a package feature (channel allow-listing), not a convention.

### 2.4 Communication Protocol References

The fork spec references the communication protocols document in several places:

- **Line 920 (slack_update_message description):** "Used for decision lifecycle transitions (PROPOSED -> ACCEPTED -> SUPERSEDED)" — this references Protocol 3 (Section 3.8) which is Dev Team-specific governance.
- **Line 954:** "Primary use case: Decision lifecycle transitions per Protocol 3 (Section 3.8 of communication-protocols.md)" — direct reference to Dev Team protocol doc.

**Change:** Tool descriptions in the package must be generic. `slack_update_message` should say "Edit an existing message" — not reference any specific protocol. The consumer's system prompt or documentation can explain how to use the tool for their workflows.

### 2.5 Priority Level Semantics

**Spec lines 630-641 (Section 4.3, Priority Levels):**

The priority descriptions reference Dev Team concepts:
- Priority 0: "HITL interrupt messages"
- Priority 1: "RFC votes, blocking decisions"
- Priority 2: "Status updates, task discussion"
- Priority 3: "Log summaries, documentation updates"

**Change:** The rate limiter supports integer priorities (lower = higher priority). The package should document the priority parameter as a generic integer, not map it to specific workflow concepts. Example descriptions: "0 = highest priority, 3 = lowest priority (default: 2)".

### 2.6 Message Log Path Default

**Spec line 723 (Section 4.6):**
```typescript
const logPath = process.env.SLACK_MESSAGE_LOG || './slack-messages.jsonl';
```

**Change:** The default `./slack-messages.jsonl` writes to the MCP server's working directory, which may not be writable or appropriate for all consumers. Options:
- Remove the default — require explicit opt-in via env var
- Default to a temp directory
- Default to disabled (no logging unless configured)

**Recommendation:** Default to disabled. If `SLACK_MESSAGE_LOG` is set, enable logging. This avoids surprise file creation.

### 2.7 Deployment Examples

**Spec lines 1263-1300 (Section 7.1):**

The deployment example references Dev Team paths:
```json
"args": ["./tools/slack-mcp-server/dist/index.js"]
```

**Change:** Deployment examples should show the standard npm-installed path or `npx` invocation. If published to npm:
```json
"args": ["slack-mcp-identity-server"]
```
Or for local development:
```json
"args": ["/path/to/slack-mcp-identity-server/dist/index.js"]
```

### 2.8 Build Tooling References

**Spec lines 1335-1344 (Section 7.3, Dependencies):**

Lists `jest` and `ts-jest` as test framework. The Zencoder upstream uses `vitest` in its test examples (spec lines 1113-1147). This inconsistency should be resolved.

**Decision:** Use `vitest` — it is what the code examples already reference (`vi.spyOn` on line 1113), it requires less configuration than Jest for TypeScript, and it aligns with the Zencoder upstream.

---

## 3. Repo Structure

The package lives in its own standalone git repository, not nested under Dev_Team.

```
slack-mcp-identity-server/
  src/
    index.ts              # Entry point: server setup, transport selection
    slack-client.ts       # SlackClient class (API wrapper with rate limiter)
    rate-limiter.ts       # SlackRateLimiter class
    identity.ts           # Identity resolution: loadConfig(), resolveIdentity()
    message-logger.ts     # JSONL message logger (optional, env-driven)
    network.ts            # fetchWithRetry() for network failure handling
    tools/
      channels.ts         # list, create, archive, setTopic, setPurpose
      messages.ts         # post, reply, update, search
      reactions.ts        # add, remove
      pins.ts             # pin, unpin
      users.ts            # list, getProfile
    types.ts              # Shared TypeScript interfaces
  tests/
    unit/
      identity.test.ts
      rate-limiter.test.ts
      slack-client.test.ts
      message-logger.test.ts
    integration/
      slack-api.test.ts   # Requires test workspace credentials
  config/
    agent-identities.example.json   # Example config with generic roles
    agent-identity-schema.json      # JSON Schema for config validation
  dist/                   # TypeScript build output (gitignored)
  package.json
  tsconfig.json
  vitest.config.ts
  LICENSE                 # MIT
  README.md
  CHANGELOG.md
```

**Key decisions:**

1. **Separate source files, not a single index.ts.** The Zencoder upstream is ~550 lines in one file. With identity system, rate limiter, message logger, and 9 new tools, a single file would be ~2,000+ lines. Split by concern.

2. **Tools grouped by Slack API domain** (channels, messages, reactions, pins, users) rather than by tool name. This mirrors the Slack API documentation structure.

3. **Config examples live in `config/`, not in the repo root.** Keeps the root clean. The README points to these.

4. **No `docs/` directory initially.** The README is the documentation. Add `docs/` only if the README exceeds a manageable length.

---

## 4. Identity Config Schema (Standalone Contract)

The identity config is the primary interface between the package and its consumers. It must be documented as a standalone contract with a JSON Schema.

### 4.1 Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Agent Identity Configuration",
  "description": "Maps agent IDs to Slack display identities. The server uses this to resolve per-message username and icon overrides.",
  "type": "object",
  "properties": {
    "version": {
      "type": "string",
      "const": "1.0"
    },
    "defaultIdentity": {
      "$ref": "#/$defs/identity",
      "description": "Fallback identity used when no agent_id matches and no explicit username is provided."
    },
    "agents": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/$defs/identity"
      },
      "description": "Map of agent_id strings to identity objects. Keys are arbitrary — the consumer defines them."
    }
  },
  "required": ["version", "defaultIdentity", "agents"],
  "$defs": {
    "identity": {
      "type": "object",
      "properties": {
        "username": {
          "type": "string",
          "description": "Slack display name for this agent. Will be shown as the message author when chat:write.customize scope is granted."
        },
        "icon_emoji": {
          "type": "string",
          "description": "Emoji to use as avatar, e.g. ':robot_face:'. Mutually exclusive with icon_url at the Slack API level."
        },
        "icon_url": {
          "type": "string",
          "format": "uri",
          "description": "URL to an image to use as avatar. Mutually exclusive with icon_emoji at the Slack API level."
        },
        "color": {
          "type": "string",
          "description": "Informational only. Not used by the server. Consumers may use this for UI purposes."
        },
        "role": {
          "type": "string",
          "description": "Informational only. Not used by the server. Consumers may use this for documentation."
        }
      },
      "required": ["username"]
    }
  }
}
```

### 4.2 Example Config (Generic)

```json
{
  "version": "1.0",
  "defaultIdentity": {
    "username": "Bot",
    "icon_emoji": ":robot_face:"
  },
  "agents": {
    "agent-alpha": {
      "username": "Alpha",
      "icon_emoji": ":large_blue_circle:"
    },
    "agent-beta": {
      "username": "Beta",
      "icon_emoji": ":large_green_circle:"
    }
  }
}
```

### 4.3 Resolution Rules (Unchanged from Spec)

The three-tier resolution from spec Section 3.2 (lines 406-433) is correct and generic:

1. Explicit `username`/`icon_emoji`/`icon_url` on the tool call takes highest priority
2. `agent_id` lookup in config file
3. `defaultIdentity` from config file
4. No identity override (message posts as the Slack app's default name)

No changes needed here — this is already consumer-agnostic.

---

## 5. Configuration Surface

### 5.1 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | Yes | — | Bot token (`xoxb-`) with required scopes |
| `SLACK_TEAM_ID` | Yes | — | Slack workspace ID |
| `SLACK_CHANNEL_IDS` | No | (all channels) | Comma-separated channel IDs to restrict access |
| `SLACK_AGENT_CONFIG_PATH` | No | — | Path to agent identity JSON config file |
| `SLACK_USER_TOKEN` | No | — | User token (`xoxp-`) for search.messages |
| `SLACK_MESSAGE_LOG` | No | (disabled) | Path to JSONL message log file. If unset, logging is disabled. |

**Removed from spec:** `SLACK_RATE_LIMIT_BURST` (spec line 267). The rate limiter uses per-method limits from Slack's documented tiers. A single "burst" knob does not map cleanly to the per-method architecture. Remove it.

### 5.2 Required Slack App Scopes

**Bot Token Scopes (from spec lines 1361-1377):**

```
channels:history
channels:manage
channels:read
chat:write
chat:write.customize
chat:write.public
groups:history
groups:read
groups:write
pins:write
reactions:write
users:read
users.profile:read
```

**User Token Scopes (optional):**
```
search:read
```

**Note:** `pins:read` and `reactions:read` are not required — no tool in the current set uses them. Consumers who build custom tools that read pins or reactions can add these scopes to their Slack app as needed.

### 5.3 Minimal vs Full Scope Sets

Not every consumer needs all 17 tools. The README should document which scopes are needed for which tool groups:

| Tool Group | Required Scopes | Tools |
|------------|----------------|-------|
| Read channels | `channels:read`, `groups:read` | `slack_list_channels` |
| Read history | `channels:history`, `groups:history` | `slack_get_channel_history`, `slack_get_thread_replies` |
| Post messages | `chat:write` | `slack_post_message`, `slack_reply_to_thread` |
| Identity override | `chat:write.customize` | (adds identity to post/reply) |
| Post to unjoined channels | `chat:write.public` | (adds capability to post/reply) |
| Update messages | `chat:write` | `slack_update_message` |
| Manage channels | `channels:manage`, `groups:write` | `slack_create_channel`, `slack_archive_channel`, `slack_set_channel_topic`, `slack_set_channel_purpose` |
| Reactions | `reactions:write` | `slack_add_reaction`, `slack_remove_reaction` |
| Pins | `pins:write` | `slack_pin_message`, `slack_unpin_message` |
| Users | `users:read`, `users.profile:read` | `slack_get_users`, `slack_get_user_profile` |
| Search | `search:read` (user token) | `slack_search_messages` |

This lets consumers grant only the scopes their use case requires.

### 5.4 Channel Allow-List Behavior (`SLACK_CHANNEL_IDS`)

When `SLACK_CHANNEL_IDS` is set, the following rules apply:

- **Read/write operations** (`slack_post_message`, `slack_get_channel_history`, `slack_reply_to_thread`, etc.) are restricted to listed channels.
- **`slack_create_channel`** creates new channels regardless of the allow-list (the channel does not yet exist to be listed). The newly created channel's ID may be added to the allow-list dynamically at the consumer's discretion.
- **`slack_search_messages`** inherits search scope from the user token's permissions, not from this list. Slack's API enforces search visibility based on the token's access.

---

## 6. What Stays in the Package vs. What Stays in the Consumer

### 6.1 Package Responsibilities (Generic)

| Concern | Package Provides |
|---------|-----------------|
| Slack API communication | `SlackClient` class with all 17 API method wrappers |
| MCP tool registration | 17 tools registered via `McpServer.registerTool()` |
| Rate limiting | `SlackRateLimiter` with per-method tracking, 429 handling, priority queue |
| Identity resolution | `resolveIdentity()` — reads config, resolves per-call identity |
| Network retry | `fetchWithRetry()` — exponential backoff for 5xx and network failures |
| Message logging | Optional JSONL logger, enabled by env var |
| Transport | stdio (default) + Streamable HTTP (via `--transport http`) |
| Config loading | Reads `SLACK_AGENT_CONFIG_PATH`, validates against schema |

### 6.2 Consumer Responsibilities (Project-Specific)

| Concern | Consumer Provides |
|---------|------------------|
| Slack app creation | Create app at api.slack.com, grant scopes, install to workspace |
| Bot token and team ID | Set `SLACK_BOT_TOKEN` and `SLACK_TEAM_ID` env vars |
| Agent identity config | Write `agent-identities.json` mapping their roles to display names |
| Channel naming and structure | Create channels, decide naming conventions, set `SLACK_CHANNEL_IDS` if restricting |
| Communication protocols | Define how agents use the tools (message formats, threading rules, decision processes) |
| MCP client configuration | Wire the package into their MCP client (Claude Code, custom orchestrator, etc.) |
| User token for search | Obtain `xoxp-` token if search is needed |

### 6.3 Explicitly NOT in the Package

The following items from the existing spec and protocols are Dev Team-specific and must NOT be in the reusable package:

| Item | Where It Currently Lives | Why It Stays Out |
|------|-------------------------|------------------|
| Intent prefix system (STATUS/PROPOSAL/DECISION/...) | `communication-protocols.md`, Protocol 1.2 | Consumer's communication protocol, not a server feature |
| Thread discipline rules (3-thread cap, merge rules) | `communication-protocols.md`, Protocol 2 | Consumer's workflow policy |
| DACI decision framework | `communication-protocols.md`, Protocol 3 | Consumer's governance model |
| Crystallization triggers | `communication-protocols.md`, Protocol 4 | Consumer's knowledge management |
| Human override levels (SUGGESTION/DIRECTIVE/VETO/EMERGENCY) | `communication-protocols.md`, Protocol 5 | Consumer's authority model |
| Channel naming convention (`#ai-{repo}`) | `communication-protocols.md`, Protocol 6 | Consumer's naming policy |
| `.ai/` directory structure | `communication-protocols.md`, Integration section | Consumer's file organization |
| Agent role names (Team Lead, Architect, etc.) | Fork spec Section 3.1, protocols | Consumer's team structure |
| Block Kit message templates with intent prefixes | `communication-protocols.md`, Protocol 1.3 | Consumer's message format |
| Decision lifecycle states (PROPOSED/ACCEPTED/SUPERSEDED) | `communication-protocols.md`, Protocol 3.8 | Consumer's governance model |

---

## 7. Build / Test / Publish Pipeline

### 7.1 TypeScript Compilation

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["tests/**/*", "dist/**/*"]
}
```

**Key choices:**
- `declaration: true` — generate `.d.ts` files so consumers can import types
- `ES2022` target — supports top-level await, required by MCP SDK
- `Node16` module resolution — matches the MCP SDK's expectations

### 7.2 package.json

```json
{
  "name": "slack-mcp-identity-server",
  "version": "0.1.0",
  "description": "MCP server for Slack with per-message agent identity switching, rate limiting, and message logging",
  "license": "MIT",
  "type": "module",
  "bin": {
    "slack-mcp-identity-server": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist/",
    "config/agent-identities.example.json",
    "config/agent-identity-schema.json"
  ],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "prepublishOnly": "npm run build && npm test",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.15.1",
    "zod": "^3.22.4"
  },
  "optionalDependencies": {
    "express": "^5.1.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^24",
    "typescript": "^5.8.3",
    "vitest": "^3.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

**Notes:**
- `bin` field makes the package executable via `npx slack-mcp-identity-server`
- `files` restricts what gets published (no tests, no source, just dist + config examples)
- `prepublishOnly` ensures build + tests pass before any publish
- `shx` removed from devDependencies — not needed if we use `chmod` in a postbuild script or add the hashbang in source

### 7.3 Testing Approach

**Unit tests (no network, no Slack credentials):**
- Identity resolution: all four tiers (explicit > agent_id > default > none)
- Rate limiter: method limits, priority ordering, 429 retry
- Message logger: writes JSONL, handles disabled state
- SlackClient body construction: identity fields included/excluded correctly
- Network retry: exponential backoff, max retries

**Integration tests (requires test Slack workspace):**
- Post message with custom identity
- Threaded reply with identity
- Channel create/archive lifecycle
- Reaction add/remove
- Pin/unpin
- Search (if user token configured)

Integration tests are gated by `TEST_SLACK_BOT_TOKEN` env var. If not set, they skip. This lets CI run unit tests without credentials.

### 7.4 Distribution

**Option A: npm publish** — `npm publish` to the public npm registry. Consumers install via `npm install slack-mcp-identity-server`.

**Option B: git install** — Consumers install via `npm install github:owner/slack-mcp-identity-server`. No npm account needed. Works for private repos too.

**Recommendation:** Start with Option B (git-installable). Publish to npm when the API is stable (post v1.0). This avoids premature version locking.

For git install, the `prepublishOnly` script handles the build. The consumer runs:
```bash
git clone https://github.com/owner/slack-mcp-identity-server.git
cd slack-mcp-identity-server
npm install
npm run build
```

Or in their MCP config:
```json
{
  "mcpServers": {
    "slack": {
      "command": "node",
      "args": ["/path/to/slack-mcp-identity-server/dist/index.js"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-...",
        "SLACK_TEAM_ID": "T..."
      }
    }
  }
}
```

---

## 8. Implementation Order

### Phase 1: Core Server (No Identity, No Rate Limiter)

**Goal:** Get a working MCP server that talks to Slack with the 8 existing tools from the Zencoder upstream.

1. **Fork the Zencoder repo** (`zencoderai/slack-mcp-server`). This gives us the working 8 tools, MCP SDK integration, and stdio+HTTP transport.

2. **Restructure into multi-file layout.** Split `index.ts` into the file structure from Section 3. This is pure refactoring — no behavior change.

3. **Set up build and test infrastructure.** `tsconfig.json`, `vitest.config.ts`, `package.json` scripts. Write unit tests for the existing `SlackClient` methods. Test infrastructure uses `import { describe, it, expect, vi } from 'vitest'` — spec test examples that reference `jest` APIs or `@jest/globals` types need translation to Vitest equivalents.

4. **Startup validation.** On startup, call `auth.test` (no additional scope needed) to verify bot token validity and log the app name. If `SLACK_AGENT_CONFIG_PATH` is set, log a warning if the first identity-customized message returns `missing_scope`. This is cheap to implement and saves debugging time for new consumers.

5. **Verify the 8 existing tools work** against a test Slack workspace.

**Dependencies:** None. This is the foundation.

### Phase 2: Identity System

**Goal:** Add per-message identity switching to `slack_post_message` and `slack_reply_to_thread`.

1. **Implement `identity.ts`:** `loadAgentConfig()`, `resolveIdentity()` per spec Section 3.2 (lines 394-433).

2. **Modify `SlackClient.postMessage()`** to accept `PostMessageOptions` interface per spec Section 2.2 (lines 130-172). Add `username`, `icon_emoji`, `icon_url`, `metadata` parameters.

3. **Modify `SlackClient.postReply()`** to delegate to `postMessage()` per spec Section 2.4 (lines 234-253).

4. **Update tool schemas** for `slack_post_message` and `slack_reply_to_thread` to include `agent_id`, `username`, `icon_emoji`, `icon_url` parameters per spec Section 2.3 (lines 176-225) and Section 3.3 (lines 446-452).

5. **Write identity config schema** (`config/agent-identity-schema.json`) and example config.

6. **Unit tests:** Identity resolution (all four tiers), body construction with/without identity.

7. **Integration test:** Post message with custom username, verify via `conversations.history` that the `username` field is set.

**Dependencies:** Phase 1 complete.

### Phase 3: Rate Limiter

**Goal:** Add the priority-based rate limiter.

1. **Implement `rate-limiter.ts`:** `SlackRateLimiter` class per spec Section 4.2 (lines 490-626). Per-method limits, priority queue, 429 handling.

2. **Implement `network.ts`:** `fetchWithRetry()` per spec Section 4.5 (lines 663-694). Exponential backoff for 5xx and network failures.

3. **Wire rate limiter into `SlackClient`.** All API methods go through `rateLimiter.enqueue()`. The call chain is: `rateLimiter.enqueue(method, () => fetchWithRetry(url, opts))` — `fetchWithRetry` goes INSIDE the rate limiter's execute function. A network retry re-attempts within the same rate limit slot. The rate limiter dequeues the next request only after the current one succeeds or exhausts retries.

4. **Wire `fetchWithRetry` into `SlackClient`.** Replace raw `fetch()` calls with `fetchWithRetry()`. Do NOT wrap the rate limiter with `fetchWithRetry` — that would bypass rate limiting on retries.

5. **Add priority parameter** to message-posting tools per spec Section 4.3 (lines 630-641).

6. **Add queue delay warning** per spec Section 4.7 (lines 735-749).

7. **Unit tests:** Method limits, priority ordering, 429 retry, queue delay warning.

**Dependencies:** Phase 1 complete. Can run in parallel with Phase 2 since the rate limiter is a separate concern.

### Phase 4: New Tools (9 tools)

**Goal:** Add the 9 new tools specified in the fork spec Section 5.

Build in this order (by dependency):

1. **`slack_update_message`** (spec lines 914-947) — needed for message editing. No dependencies on other new tools.

2. **`slack_create_channel`** and **`slack_archive_channel`** (spec lines 758-803) — channel lifecycle. `create_channel` is a prerequisite for the integration tests of other channel tools.

3. **`slack_set_channel_topic`** and **`slack_set_channel_purpose`** (spec lines 809-850) — channel metadata. Depends on having a channel to modify.

4. **`slack_remove_reaction`** (spec lines 858-879) — reaction removal. Independent.

5. **`slack_pin_message`** and **`slack_unpin_message`** (spec lines 960-1001) — pin management. Independent.

6. **`slack_search_messages`** (spec lines 884-908) — search. Requires user token support. Build last because it has the additional `SLACK_USER_TOKEN` dependency.

Each tool needs:
- `SlackClient` method (from Appendix A, spec lines 1499-1631)
- Tool registration with Zod schema
- Unit test (body construction)
- Integration test (against test workspace)

**Dependencies:** Phase 2 complete. Phase 4's message tools (e.g., `slack_update_message`) depend on Phase 2's modified `postMessage` interface (`PostMessageOptions`). Phases 3 and 4 can parallelize after Phase 2 completes.

### Phase 5: Message Logger

**Goal:** Add optional JSONL message logging.

1. **Implement `message-logger.ts`:** per spec Section 4.6 (lines 708-728). Log all outbound messages with timestamp, channel, agent identity, text, delivery status.

2. **Wire into `SlackClient.postMessage()` and `SlackClient.postReply()`.** Log after each API call, recording whether delivery succeeded.

3. **Behavior when disabled:** If `SLACK_MESSAGE_LOG` is not set, the logger is a no-op. No file created, no overhead.

4. **Unit tests:** Logger writes correct JSONL format, disabled state produces no output.

5. **Document log rotation limitation.** The logger appends to a single JSONL file indefinitely. The consumer is responsible for log rotation (e.g., `logrotate` on Linux, or periodic archival). Do NOT implement rotation in v1.

**Dependencies:** Phase 2 (identity fields are part of the log entry).

### Phase 6: User Token Support

**Goal:** Add dual-token support for search.

1. **Modify `SlackClient` constructor** to accept optional user token per spec Section 2.6 (lines 275-310).

2. **Wire into `slack_search_messages` tool** (already implemented in Phase 4, but needs user token routing).

3. **Integration test:** Search with user token.

**Dependencies:** Phase 4 (`slack_search_messages` tool exists).

### Phase 7: Documentation and Packaging

**Goal:** README, examples, publish readiness.

1. **Write README** covering:
   - What this package does (one paragraph)
   - Slack app setup (create app, scopes, tokens)
   - Installation (git clone + build)
   - MCP client configuration (Claude Code example, generic MCP example)
   - Identity config file format (with example)
   - Environment variables (table from Section 5.1)
   - Scope-to-tool mapping (table from Section 5.3)
   - Tool reference (17 tools with parameters)

2. **Add hashbang** (`#!/usr/bin/env node`) to `dist/index.js` for `npx` support.

3. **Create example config** in `config/agent-identities.example.json`.

4. **Verify `npm pack`** produces a clean tarball.

**Dependencies:** All previous phases complete.

---

## 9. Specific Spec Sections That Need No Changes

These sections of the fork spec are already generic and carry over directly:

| Section | Lines | Why It's Already Generic |
|---------|-------|------------------------|
| 1. Codebase Analysis | 24-96 | Describes the upstream, not the consumer |
| 2.1 OAuth Scopes | 101-126 | Slack API requirements, not project-specific |
| 2.2 PostMessageOptions interface | 128-172 | Generic API interface |
| 2.6 User Token for Search | 272-310 | Slack API constraint |
| 3.2 Identity Resolution logic | 376-433 | Consumer-agnostic resolution hierarchy |
| 4.1 Rate Limit Facts | 458-486 | Slack API documentation |
| 4.2 Rate Limiter Design | 488-626 | Generic infrastructure |
| 4.4 429 Response Handling | 644-657 | Slack API behavior |
| 4.5 Network Failure Handling | 659-706 | Generic retry logic |
| 5.1-5.6 All new tool implementations | 756-1025 | Generic Slack API wrappers |
| 6.1-6.4 All test code | 1030-1254 | Generic test patterns |
| 7.3 Dependencies | 1326-1347 | Package dependencies |
| 7.4-7.5 Slack App Configuration | 1349-1383 | Generic setup instructions |
| 8.1-8.6, 8.8-8.9 Technical Risks | 1408-1495 | Generic operational risks |
| Appendix A: SlackClient methods | 1499-1631 | Generic API wrappers |
| Appendix B: Type definitions | 1634-1683 | Generic TypeScript types |

---

## 10. README Scope

The README must be self-contained. A consumer should be able to go from zero to working MCP server using only the README and Slack's app configuration UI.

### Required Sections

1. **What This Is** — one paragraph: "An MCP server for Slack that adds per-message identity switching (different display name/icon per message), priority-based rate limiting, and message search. Fork of the Zencoder Slack MCP server."

2. **Prerequisites** — Node.js >= 20, a Slack workspace, admin access to create a Slack app.

3. **Slack App Setup** — step-by-step:
   - Go to api.slack.com/apps
   - Create new app (from scratch, not manifest)
   - Add bot token scopes (list from Section 5.2, with scope-to-tool mapping)
   - Install to workspace
   - Copy bot token (`xoxb-`) and team ID
   - (Optional) Get user token for search

4. **Installation** — `git clone && npm install && npm run build`

5. **Configuration** — env vars table, identity config file format, example config

6. **MCP Client Setup** — show `.mcp.json` and `settings.local.json` examples for Claude Code. Show generic MCP client config for other clients.

7. **Tool Reference** — table of all 17 tools with parameters. Not full Zod schemas — just name, description, key parameters.

8. **Identity System** — how agent_id resolution works, config file format, fallback behavior.

9. **Rate Limiting** — what the limiter does, priority levels, what happens on 429.

10. **Troubleshooting** — common issues:
    - `missing_scope` error: add the scope, reinstall app
    - `not_in_channel` error: invite the bot or use `chat:write.public`
    - Search returns error: need user token, not bot token
    - Identity not showing: check `chat:write.customize` scope

---

## 11. Risk Items for Reusable Package

### 11.1 Upstream Drift

The Zencoder repo (`zencoderai/slack-mcp-server`) is actively maintained. The MCP SDK dependency (`@modelcontextprotocol/sdk`) is also actively developed. Both may release breaking changes.

**Mitigation:** The MCP SDK version is pinned to `1.15.1` in `package.json` (no caret). Track upstream Zencoder changes but do not auto-merge — review each update for compatibility.

### 11.2 Scope Creep

The existing spec includes features that serve the Dev Team specifically (message metadata for protocol routing, Block Kit templates for intent prefixes). These are valid Slack API features but their documentation in the README should be neutral — show what the parameters do, not how the Dev Team uses them.

### 11.3 ADR-001 Applicability

ADR-001 (`ADR-001-single-token-identity-spoofing-risk.md`) documents the identity spoofing risk acceptance for the Dev Team's single-developer context. The reusable package should reference this risk in its README security section but cannot assume the consumer shares the same threat model. The README should state:

> This package uses a single bot token with `chat:write.customize` to switch display names per message. All messages originate from the same Slack app. This means any process with access to the bot token can post as any configured identity. See the Security section for details and mitigations.

### 11.4 Express Dependency

The upstream Zencoder server uses Express for HTTP transport. For consumers using only stdio transport (the common case for Claude Code), Express is unused. **Resolution:** Express is moved to `optionalDependencies` in `package.json`. The server uses `await import('express')` dynamically when `--transport http` is selected. Stdio-only consumers do not load or require Express.

---

## 12. Checklist Summary

| # | Item | Phase | Status |
|---|------|-------|--------|
| 1 | Fork Zencoder repo | 1 | Not started |
| 2 | Restructure to multi-file layout | 1 | Not started |
| 3 | Set up build/test infrastructure | 1 | Not started |
| 4 | Verify 8 existing tools work | 1 | Not started |
| 5 | Implement identity system | 2 | Not started |
| 6 | Modify postMessage/postReply for identity | 2 | Not started |
| 7 | Update tool schemas for identity params | 2 | Not started |
| 8 | Write identity config schema | 2 | Not started |
| 9 | Implement rate limiter | 3 | Not started |
| 10 | Implement fetchWithRetry | 3 | Not started |
| 11 | Wire rate limiter into SlackClient | 3 | Not started |
| 12 | Add priority parameter to tools | 3 | Not started |
| 13 | Implement slack_update_message | 4 | Not started |
| 14 | Implement channel management tools (4 tools) | 4 | Not started |
| 15 | Implement slack_remove_reaction | 4 | Not started |
| 16 | Implement pin tools (2 tools) | 4 | Not started |
| 17 | Implement slack_search_messages | 4 | Not started |
| 18 | Implement message logger | 5 | Not started |
| 19 | Add dual-token support | 6 | Not started |
| 20 | Write README | 7 | Not started |
| 21 | Create example configs | 7 | Not started |
| 22 | Verify npm pack / git install | 7 | Not started |

---

## 13. Open Questions

1. **Package name:** `slack-mcp-identity-server` or something else? The name should communicate identity switching as the key differentiator from the upstream.

2. **npm scope:** Scoped (`@scope/name`) or unscoped? Scoped requires owning the npm org. Unscoped is simpler but risks name collisions.

3. ~~**MCP SDK version pinning:**~~ **Resolved.** Pin to `1.15.1` (no caret). The MCP SDK has had breaking changes between minor versions. Manual updates are required but preferred over unexpected breakage.

4. ~~**Express as optional:**~~ **Resolved.** Use dynamic `await import('express')` when `--transport http` is selected. Express is in `optionalDependencies`. Stdio-only consumers do not load it.

5. **Minimum scope set:** Should the server start successfully with only `chat:write` (no `chat:write.customize`)? The identity system degrades gracefully (spec Section 8.1, lines 1409-1413), but should this be a hard error or a warning?
