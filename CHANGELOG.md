# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-02-12

### Added

- Per-message identity switching via `agent_id`, `username`, `icon_emoji`, `icon_url` parameters on `slack_post_message` and `slack_reply_to_thread`
- Agent identity config file (`SLACK_AGENT_CONFIG_PATH`) with 3-tier resolution: explicit params > agent_id lookup > default identity
- Priority-based rate limiter with per-method token bucket tracking against Slack's tier limits
- Automatic 429 handling with `Retry-After` header compliance
- Network resilience via `fetchWithRetry` with exponential backoff for 5xx and network errors
- 9 new MCP tools: `slack_update_message`, `slack_create_channel`, `slack_archive_channel`, `slack_set_channel_topic`, `slack_set_channel_purpose`, `slack_remove_reaction`, `slack_pin_message`, `slack_unpin_message`, `slack_search_messages`
- Dual-token support: bot token for all operations, optional user token (`SLACK_USER_TOKEN`) for `search.messages`
- Optional JSONL message logging via `SLACK_MESSAGE_LOG` environment variable
- Channel allow-list via `SLACK_CHANNEL_IDS` (create and search exempt)
- Startup token validation via `auth.test`
- Hashbang for `npx` support

### Changed

- Restructured single-file upstream (664 lines) into 8 source modules grouped by Slack API domain
- `postMessage` accepts `PostMessageOptions` interface with identity and metadata fields
- `postReply` delegates to `postMessage` (eliminates duplicate fetch call)
- Express moved to `optionalDependencies` with dynamic import for HTTP transport
- MCP SDK pinned to exact version `1.15.1` (no caret)
- Test framework changed from Jest to Vitest

### Fork Base

- Forked from [zencoderai/slack-mcp-server](https://github.com/zencoderai/slack-mcp-server) which provides the 8 original MCP tools and stdio/HTTP transport
