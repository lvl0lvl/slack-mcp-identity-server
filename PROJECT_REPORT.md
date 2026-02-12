# Project Report: slack-mcp-identity-server

## Summary

slack-mcp-identity-server is a fork of the Zencoder Slack MCP server that adds per-message identity switching, a priority-based rate limiter, dual-token search, and optional JSONL message logging. The project was built in 7 phases over a single session, restructuring a 664-line monolithic `index.ts` into 12 source modules grouped by Slack API domain. It provides 17 MCP tools (8 original + 9 new) and is ready for npm distribution as a stdio or HTTP MCP server.

## Build Statistics

- Phases: 7
- Total commits: 44 (8 upstream + 36 project)
- Total tests: 63
- Test files: 6
- Source files: 12
- Package size: 26.1 kB (110.0 kB unpacked)

## Architecture

```
src/
  index.ts            -- Entry point, CLI arg parsing, server factory, graceful shutdown
  slack-client.ts     -- SlackClient class wrapping all Slack API calls with rate limiter + fetchWithRetry
  identity.ts         -- Agent config loading and 4-tier identity resolution
  rate-limiter.ts     -- Priority-based per-method token bucket with 429 handling
  network.ts          -- fetchWithRetry with exponential backoff for 5xx/network errors
  message-logger.ts   -- Optional JSONL append logger for outbound messages
  types.ts            -- Shared TypeScript interfaces (PostMessageOptions, AgentConfig, etc.)
  tools/
    channels.ts       -- 5 tools: list, create, archive, set topic, set purpose
    messages.ts       -- 6 tools: post, reply, history, thread replies, update, search
    reactions.ts      -- 2 tools: add reaction, remove reaction
    pins.ts           -- 2 tools: pin, unpin
    users.ts          -- 2 tools: list users, get profile
```

The architecture follows a clean separation of concerns: `SlackClient` handles all HTTP communication through `fetchWithRetry` (network resilience) wrapped inside `SlackRateLimiter.enqueue()` (rate limiting). Tool files are pure MCP registrations that delegate to `SlackClient` methods. Identity resolution is stateless and injected as a config parameter.

## Key Decisions

| ID | Decision |
|----|----------|
| DD-001 | Restructured single index.ts (664 lines) into 8 source files grouped by Slack API domain |
| DD-002 | Vitest chosen over Jest (upstream vi.spyOn patterns, less TS config) |
| DD-003 | Express moved to optionalDependencies with dynamic import |
| DD-004 | MCP SDK pinned to exact 1.15.1 (no caret) |
| DD-005 | resolveIdentity takes config as parameter (not module state) for testability |
| DD-006 | PostMessageOptions includes full spec fields (unfurl, blocks, metadata) |
| DD-007 | postReply delegates to postMessage (eliminates duplicate fetch) |
| DD-008 | SlackRateLimiter created internally by SlackClient (not injected) |
| DD-009 | METHOD_LIMITS simplified to Record<string, number> |
| DD-010 | Queue delay warning logs to stderr (not tool content) |
| DD-011 | fetchWithRetry maxRetries defaults to 3 (reduced from 5 for MCP latency) |
| DD-012 | _retryAfter attached to parsed JSON response for 429 detection |
| DD-013 | searchMessages takes userToken as parameter (not stored on class) |
| DD-014 | slack_update_message description is generic, no protocol references |
| DD-015 | slack_create_channel bypasses SLACK_CHANNEL_IDS allow-list |
| DD-016 | MessageLogger disabled by default, no log rotation |
| DD-017 | Logger injected into SlackClient via constructor (optional, defaults to no-op) |
| DD-018 | Logging happens in postMessage only (postReply delegates, so both captured) |
| DD-019 | Log entries use resolved identity fields, not raw agent_id |
| DD-020 | Kept per-call userToken approach; Phase 6 adds test coverage only |
| DD-021 | README rewritten from scratch with all 10 build plan sections |
| DD-022 | package.json files field updated for clean tarball |
| DD-023 | Hashbang preserved from Phase 1 through TypeScript compilation |

## Known Limitations

- **No integration tests with live Slack API** -- R16 (Nice to Have) was not implemented. All tests are unit tests with mocked fetch.
- **No log rotation** -- MessageLogger appends indefinitely; rotation is the consumer's responsibility.
- **fetchWithRetry maxRetries is 3** (DD-011) -- reduced from the spec's 5 to keep MCP response latency reasonable.
- **Rate limiter is per-process** -- does not coordinate across multiple server instances sharing the same bot token.
- **Not yet pushed to remote** -- local branch is 36 commits ahead of `origin/main`.
- **Not yet published to npm** -- `npm publish` has not been run.
