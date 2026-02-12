# slack-mcp-identity-server

An MCP server for Slack that adds per-message identity switching (different display name and icon per message), priority-based rate limiting, dual-token search, and optional message logging. Fork of the [Zencoder Slack MCP server](https://github.com/zencoderai/slack-mcp-server).

## Table of Contents

- [What This Is](#what-this-is)
- [Slack App Setup](#slack-app-setup)
- [Installation](#installation)
- [MCP Client Configuration](#mcp-client-configuration)
- [Identity System](#identity-system)
- [Rate Limiting](#rate-limiting)
- [Tool Reference](#tool-reference)
- [Message Logging](#message-logging)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

## What This Is

This package provides 17 MCP tools for interacting with Slack. It is designed for multi-agent systems where multiple AI agents share a single Slack bot token but need distinct display names and icons per message.

Key features beyond the upstream Zencoder server:

- **Per-message identity switching** -- each message can have a different display name and icon, resolved from a config file or explicit parameters
- **Priority-based rate limiter** -- per-method token bucket with priority queue, automatic 429 handling, and `Retry-After` compliance
- **Dual-token support** -- bot token for all operations, optional user token for `search.messages`
- **9 new tools** -- channel management, message update, reaction removal, pin management, and search
- **Optional JSONL message logging** -- append-only log of all outbound messages for audit and replay

## Slack App Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name your app and select your workspace

> **Important:** Create the app as an **internal custom app**. Internal apps are exempt from the reduced rate limits that apply to non-Marketplace commercial apps.

### 2. Add Bot Token Scopes

Navigate to **OAuth & Permissions** and add these **Bot Token Scopes**:

| Scope | Purpose |
|-------|---------|
| `channels:history` | Read messages in public channels |
| `channels:manage` | Create/archive channels, set topic/purpose |
| `channels:read` | List channels |
| `chat:write` | Post messages |
| `chat:write.customize` | Override display name and icon per message |
| `chat:write.public` | Post to channels the bot hasn't joined |
| `groups:history` | Read messages in private channels |
| `groups:read` | List private channels |
| `groups:write` | Manage private channels |
| `pins:write` | Pin and unpin messages |
| `reactions:write` | Add and remove reactions |
| `users:read` | List users |
| `users.profile:read` | View user profiles |

**Minimal scope set:** Not every consumer needs all 17 tools. See the [scope-to-tool mapping](#scope-to-tool-mapping) below to grant only what you need.

### 3. Install to Workspace

1. Click **Install to Workspace** and authorize
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
3. Note your **Team ID** (starts with `T`) -- find it at [Slack help](https://slack.com/help/articles/221769328-Locate-your-Slack-URL-or-ID#find-your-workspace-or-org-id)

### 4. Optional: User Token for Search

`search.messages` requires a **user token** (`xoxp-`), not a bot token. To enable search:

1. Add the **User Token Scope** `search:read`
2. Install/reinstall the app
3. Copy the **User OAuth Token** (starts with `xoxp-`)

## Installation

```bash
git clone https://github.com/wmcg/slack-mcp-identity-server.git
cd slack-mcp-identity-server
npm install
npm run build
```

Or run directly with `npx` after building:

```bash
npx slack-mcp-identity-server
```

## MCP Client Configuration

### Claude Desktop / Claude Code

Add to `~/.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "slack": {
      "command": "node",
      "args": ["/path/to/slack-mcp-identity-server/dist/index.js"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-your-bot-token",
        "SLACK_TEAM_ID": "T0123456789",
        "SLACK_AGENT_CONFIG_PATH": "/path/to/agent-identities.json",
        "SLACK_USER_TOKEN": "xoxp-your-user-token"
      }
    }
  }
}
```

Or in a project `.mcp.json`:

```json
{
  "mcpServers": {
    "slack": {
      "command": "node",
      "args": ["/path/to/slack-mcp-identity-server/dist/index.js"],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
        "SLACK_TEAM_ID": "${SLACK_TEAM_ID}",
        "SLACK_AGENT_CONFIG_PATH": "./agent-identities.json"
      }
    }
  }
}
```

### Generic MCP Client

Any MCP client that supports stdio transport can use this server. Point the command at `node /path/to/dist/index.js` and set the environment variables.

### HTTP Transport

For remote or web-based deployments:

```bash
node dist/index.js --transport http --port 3000 --token your-auth-token
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | Yes | -- | Bot token (`xoxb-`) with required scopes |
| `SLACK_TEAM_ID` | Yes | -- | Slack workspace ID |
| `SLACK_CHANNEL_IDS` | No | (all channels) | Comma-separated channel IDs to restrict access |
| `SLACK_AGENT_CONFIG_PATH` | No | -- | Path to agent identity JSON config file |
| `SLACK_USER_TOKEN` | No | -- | User token (`xoxp-`) for `search.messages` |
| `SLACK_MESSAGE_LOG` | No | (disabled) | Path to JSONL message log file |
| `AUTH_TOKEN` | No | -- | Bearer token for HTTP transport authorization |

### Command Line Options

```
--transport <type>   Transport type: 'stdio' or 'http' (default: stdio)
--port <number>      Port for HTTP server (default: 3000)
--token <token>      Bearer token for HTTP authorization
--help, -h           Show help message
```

## Identity System

The identity system allows each message to appear with a different display name and icon, even though all messages originate from a single Slack app.

### Config File Format

Create a JSON file (e.g. `agent-identities.json`) and set `SLACK_AGENT_CONFIG_PATH` to its path:

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

A JSON Schema is available at `config/agent-identity-schema.json`. An example config is at `config/agent-identities.example.json`.

The `color` and `role` fields are informational only -- the server does not use them. They exist for the consumer's reference.

### Resolution Logic

Identity is resolved per tool call using a 3-tier hierarchy:

1. **Explicit parameters** -- if `username` is provided on the tool call, it takes highest priority (along with `icon_emoji` / `icon_url`)
2. **Config lookup** -- if `agent_id` is provided, the server looks it up in the config file
3. **Default identity** -- if no match, the `defaultIdentity` from config is used
4. **No override** -- if no config is loaded, the message posts under the Slack app's default name

### Example

```
# Uses agent-alpha's identity from config
slack_post_message(channel_id="C123", text="Hello", agent_id="agent-alpha")

# Uses explicit override (takes priority over agent_id)
slack_post_message(channel_id="C123", text="Hello", username="Custom Bot", icon_emoji=":star:")

# Uses defaultIdentity from config (no agent_id, no explicit params)
slack_post_message(channel_id="C123", text="Hello")
```

## Rate Limiting

The server includes a priority-based rate limiter that tracks per-method request counts against Slack's documented tier limits.

### Per-Method Limits

| Method | Tier | Limit |
|--------|------|-------|
| `chat.postMessage` | Special | ~300/min workspace-wide |
| `chat.update` | Tier 3 | ~50/min |
| `conversations.history` | Tier 3 | ~50/min |
| `conversations.replies` | Tier 3 | ~50/min |
| `conversations.list` | Tier 2 | ~20/min |
| `conversations.create` | Tier 2 | ~20/min |
| `reactions.add` / `reactions.remove` | Tier 2 | ~20/min |
| `search.messages` | Tier 2 | ~20/min |
| `pins.add` / `pins.remove` | Tier 2 | ~20/min |
| `users.list` | Tier 2 | ~20/min |
| `users.profile.get` | Tier 4 | ~100/min |

### Priority Levels

Message-posting tools (`slack_post_message`, `slack_reply_to_thread`) accept a `priority` parameter:

| Priority | Description |
|----------|-------------|
| 0 | Highest priority (processed first) |
| 1 | High priority |
| 2 | Normal (default) |
| 3 | Low priority (processed last) |

When the queue has multiple pending requests, higher-priority messages are sent first.

### 429 Handling

When Slack returns a 429 (rate limited) response:

1. The server reads the `Retry-After` header
2. All requests pause until the retry window passes
3. The failed request is retried automatically
4. A warning is logged to stderr

### Network Resilience

All API calls use exponential backoff for network errors and 5xx responses (up to 3 retries, max 30s delay). Rate limit 429s are handled separately by the rate limiter.

## Tool Reference

### Messages

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `slack_post_message` | Post a message with optional identity override | `channel_id`, `text`, `agent_id?`, `username?`, `icon_emoji?`, `icon_url?`, `priority?` |
| `slack_reply_to_thread` | Reply to a thread with optional identity override | `channel_id`, `thread_ts`, `text`, `agent_id?`, `username?`, `icon_emoji?`, `icon_url?`, `priority?` |
| `slack_update_message` | Edit an existing message | `channel_id`, `timestamp`, `text`, `blocks?`, `metadata_event_type?`, `metadata_payload?` |
| `slack_get_channel_history` | Get recent messages from a channel | `channel_id`, `limit?` (default: 10) |
| `slack_get_thread_replies` | Get all replies in a thread | `channel_id`, `thread_ts` |
| `slack_search_messages` | Search messages (requires user token) | `query`, `sort?`, `sort_dir?`, `count?` (default: 20, max: 100) |

### Channels

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `slack_list_channels` | List channels in the workspace | `limit?` (default: 100, max: 200), `cursor?` |
| `slack_create_channel` | Create a new channel | `name`, `is_private?`, `description?` |
| `slack_archive_channel` | Archive a channel | `channel_id` |
| `slack_set_channel_topic` | Set a channel's topic (max 250 chars) | `channel_id`, `topic` |
| `slack_set_channel_purpose` | Set a channel's purpose (max 250 chars) | `channel_id`, `purpose` |

### Reactions

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `slack_add_reaction` | Add an emoji reaction to a message | `channel_id`, `timestamp`, `reaction` |
| `slack_remove_reaction` | Remove an emoji reaction from a message | `channel_id`, `timestamp`, `reaction` |

### Pins

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `slack_pin_message` | Pin a message in a channel | `channel_id`, `timestamp` |
| `slack_unpin_message` | Unpin a message | `channel_id`, `timestamp` |

### Users

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `slack_get_users` | List workspace users | `cursor?`, `limit?` (default: 100, max: 200) |
| `slack_get_user_profile` | Get a user's profile | `user_id` |

### Scope-to-Tool Mapping

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

## Message Logging

When `SLACK_MESSAGE_LOG` is set, all outbound messages are appended to a JSONL file. Each line is a JSON object:

```json
{"timestamp":"2026-02-12T18:30:00.000Z","channel_id":"C123","username":"Alpha","icon_emoji":":large_blue_circle:","text":"Hello","thread_ts":null,"slack_ts":"1707756600.000100","delivered":true}
```

Fields: `timestamp`, `channel_id`, `username`, `icon_emoji`, `text`, `thread_ts`, `slack_ts`, `delivered`, `error`.

When `SLACK_MESSAGE_LOG` is not set, logging is disabled -- no file is created and no overhead is added.

**Log rotation** is the consumer's responsibility. The server appends indefinitely. Use `logrotate` or periodic archival as needed.

## Troubleshooting

### `missing_scope` error

The bot token is missing a required scope. Add the scope in your Slack app's **OAuth & Permissions** page, then reinstall the app to the workspace.

### `not_in_channel` error

The bot hasn't been invited to the channel. Either:
- Invite the bot: `/invite @your-bot-name`
- Add the `chat:write.public` scope to post without joining

### Identity not showing (messages post as app name)

Verify the `chat:write.customize` scope is granted. Identity override only works with this scope.

### Search returns error

`search.messages` requires a **user token** (`xoxp-`), not a bot token. Set `SLACK_USER_TOKEN` with a token that has the `search:read` scope.

### `channel_not_found` error

Verify the channel ID is correct (starts with `C` for public, `G` for private). If using `SLACK_CHANNEL_IDS`, the channel must be in the allow-list (except for `slack_create_channel`, which is exempt).

### Server won't start

Check that `SLACK_BOT_TOKEN` and `SLACK_TEAM_ID` are set. The server calls `auth.test` on startup and exits with an error if the token is invalid.

## Security

This package uses a single bot token with `chat:write.customize` to switch display names per message. All messages originate from the same Slack app. This means any process with access to the bot token can post as any configured identity.

### What this is NOT

Identity switching uses Slack's `username` and `icon_emoji` override parameters on `chat.postMessage`. These change the cosmetic display only. The underlying bot app attribution is unchanged -- every message shares the same `bot_id` visible in the Slack API, and a workspace admin can verify all messages come from one app.

This is not a security boundary. It is a display convenience for multi-agent systems.

### Mitigations

- Use clearly non-human display names (e.g. prefix with `[AI]`) to prevent confusion with real workspace members
- Name the Slack app descriptively (e.g. "AI Agent Hub") so app attribution in Slack's UI is transparent
- Store the bot token in a secrets manager, not in plaintext config files
- Rotate the bot token on a regular schedule
- Restrict the identity config file to trusted paths

### Threat Model

The intended deployment is as an internal custom Slack app in a single-developer or small-team context where the bot token is already a trusted credential. For deployments with stronger identity assurance requirements, consider per-agent Slack apps or token-scoped middleware.

For detailed analysis of the single-token identity architecture trade-offs, see the project's ADR-001 documentation.

## License

This project includes code originally developed by Anthropic (MIT License) and modified by Zencoder Inc. (Apache License 2.0). See [LICENSE](LICENSE) for details.
