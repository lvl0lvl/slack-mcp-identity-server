# Technical Specification: Slack MCP Server Fork for Multi-Agent Identity

**Package:** `@devteam/slack-mcp-server` (fork of `@modelcontextprotocol/server-slack`)
**License:** MIT
**Author:** Dev Team
**Date:** 2026-02-12
**Status:** Draft

---

## Table of Contents

1. [Codebase Analysis](#1-codebase-analysis)
2. [Fork Requirements](#2-fork-requirements)
3. [Agent Identity System](#3-agent-identity-system)
4. [Rate Limit Handling](#4-rate-limit-handling)
5. [New Tools](#5-new-tools)
6. [Testing Strategy](#6-testing-strategy)
7. [Deployment](#7-deployment)
8. [Technical Risks](#8-technical-risks)

---

## 1. Codebase Analysis

### Source Repository

The official Slack MCP server was originally at `modelcontextprotocol/servers/src/slack` but has been archived to `modelcontextprotocol/servers-archived/src/slack`. The actively maintained fork is `zencoderai/slack-mcp-server`. This specification bases the fork on the **Zencoder version** since it uses the modern MCP SDK (`@modelcontextprotocol/sdk@1.15.1`) with `McpServer` class and Zod schemas, while the archived version uses the older SDK (`1.0.1`) with raw `Server` class and manual JSON schema.

### Architecture

**Entry point:** `index.ts` — single file, ~500 lines (archived) / ~550 lines (Zencoder)

**Components:**
- `SlackClient` class — thin wrapper around Slack Web API using raw `fetch()`
- Tool definitions — 8 tools registered via `server.registerTool()` (Zencoder) or `setRequestHandler` (archived)
- Transport — stdio (both) + Streamable HTTP (Zencoder only)

**Current Tool Inventory:**

| Tool | Slack API Method | Description |
|------|-----------------|-------------|
| `slack_list_channels` | `conversations.list` / `conversations.info` | List channels (public+private in Zencoder, public-only in archived) |
| `slack_post_message` | `chat.postMessage` | Post message to channel. **Only sends `channel` and `text`.** |
| `slack_reply_to_thread` | `chat.postMessage` (with `thread_ts`) | Reply in thread. Sends `channel`, `thread_ts`, `text`. |
| `slack_add_reaction` | `reactions.add` | Add emoji reaction |
| `slack_get_channel_history` | `conversations.history` | Fetch recent messages |
| `slack_get_thread_replies` | `conversations.replies` | Fetch thread replies |
| `slack_get_users` | `users.list` | List workspace users |
| `slack_get_user_profile` | `users.profile.get` | Get user profile details |

**Current OAuth Scopes (from README):**
- `channels:history` — View messages in public channels
- `channels:read` — View basic channel info
- `chat:write` — Send messages as the app
- `reactions:write` — Add emoji reactions
- `users:read` — View users
- `users.profile:read` — View user profiles

**What's Missing for Multi-Agent Identity:**
- No `chat:write.customize` scope → cannot override bot display name/icon per message
- No `username`, `icon_emoji`, or `icon_url` parameters on `postMessage`
- No `metadata` parameter for structured protocol data
- No `reply_broadcast` parameter for thread+channel posting
- No channel creation/management tools (`conversations.create`, `conversations.setTopic`, etc.)
- No message search (`search.messages`)
- No pin management (`pins.add`, `pins.remove`)
- No reaction removal (`reactions.remove`)
- No rate limit handling — raw fetch with no retry logic

**Dependencies (Zencoder version):**
```json
{
  "@modelcontextprotocol/sdk": "1.15.1",
  "express": "^5.1.0",
  "zod": "^3.22.4"
}
```

### `SlackClient.postMessage` — Current Implementation

```typescript
// CURRENT: Only sends channel and text
async postMessage(channel_id: string, text: string): Promise<any> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: this.botHeaders,
    body: JSON.stringify({
      channel: channel_id,
      text: text,
    }),
  });
  return response.json();
}
```

---

## 2. Fork Requirements

### 2.1 New OAuth Scope

Add `chat:write.customize` to the required scopes. This scope allows the bot to override its display name and icon on a per-message basis using the `username`, `icon_emoji`, and `icon_url` parameters of `chat.postMessage`.

> **CRITICAL: Build as an internal custom app.** Internal apps are exempt from the May 2025 rate limit restrictions that reduced non-Marketplace commercial apps to Tier 1 (1 req/min) on key endpoints like `conversations.history`. This is a hard requirement — deploying as a commercial app without Marketplace listing would make the fork unusable. See enterprise research (`.ai/research/enterprise-slack-research.md`) for details.

> **Legacy app deadline:** Classic Slack apps stop working entirely in November 2026. The fork MUST use modern Slack app architecture (not legacy custom bots, which were discontinued March 2025).

**Updated scope list:**
- `channels:history`
- `channels:read`
- `groups:read` — needed for private channel listing (Zencoder already lists private channels)
- `groups:history` — needed for private channel message history
- `chat:write`
- `chat:write.customize` — **NEW**: enables per-message identity override
- `chat:write.public` — **NEW**: post to channels the bot hasn't joined (useful for multi-channel agent setups)
- `reactions:write`
- `pins:write` — **NEW**: needed for pinning/unpinning messages
- `search:read` — **NEW**: needed for `search.messages` (requires user token, see §2.6)
- `channels:manage` — **NEW**: needed for creating/archiving channels, setting topic/purpose
- `groups:write` — **NEW**: needed for managing private channels
- `users:read`
- `users.profile:read`

### 2.2 Modified `postMessage` Method

```typescript
interface PostMessageOptions {
  channel_id: string;
  text: string;
  thread_ts?: string;
  reply_broadcast?: boolean;
  username?: string;
  icon_emoji?: string;
  icon_url?: string;
  metadata?: {
    event_type: string;
    event_payload: Record<string, unknown>;
  };
  unfurl_links?: boolean;
  unfurl_media?: boolean;
  blocks?: unknown[];
}

async postMessage(opts: PostMessageOptions): Promise<SlackResponse> {
  const body: Record<string, unknown> = {
    channel: opts.channel_id,
    text: opts.text,
  };

  if (opts.thread_ts) body.thread_ts = opts.thread_ts;
  if (opts.reply_broadcast) body.reply_broadcast = opts.reply_broadcast;
  if (opts.username) body.username = opts.username;
  if (opts.icon_emoji) body.icon_emoji = opts.icon_emoji;
  if (opts.icon_url) body.icon_url = opts.icon_url;
  if (opts.metadata) body.metadata = opts.metadata;
  if (opts.unfurl_links !== undefined) body.unfurl_links = opts.unfurl_links;
  if (opts.unfurl_media !== undefined) body.unfurl_media = opts.unfurl_media;
  if (opts.blocks) body.blocks = opts.blocks;

  return this.rateLimiter.enqueue('chat.postMessage', async () => {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify(body),
    });
    const json = await response.json();
    json._retryAfter = response.headers.get('retry-after');
    return json;
  });
}
```

### 2.3 Modified Tool Definitions

**`slack_post_message` — Updated:**

```typescript
server.registerTool(
  "slack_post_message",
  {
    title: "Post Slack Message",
    description: "Post a message to a Slack channel with optional agent identity override",
    inputSchema: {
      channel_id: z.string().describe("Channel ID to post to"),
      text: z.string().describe("Message text (supports mrkdwn)"),
      username: z.string().optional().describe("Display name override (requires chat:write.customize)"),
      icon_emoji: z.string().optional().describe("Emoji icon override, e.g. ':robot_face:'"),
      icon_url: z.string().optional().describe("URL to image for icon override"),
      thread_ts: z.string().optional().describe("Thread timestamp to reply to"),
      reply_broadcast: z.boolean().optional().describe("Also post to channel when replying to thread"),
      metadata_event_type: z.string().optional().describe("Structured metadata event type, e.g. 'agent_protocol_message'"),
      metadata_payload: z.string().optional().describe("JSON string of metadata event payload"),
      blocks: z.string().optional().describe("JSON string of Block Kit blocks array"),
      unfurl_links: z.boolean().optional().default(false).describe("Enable link unfurling"),
      unfurl_media: z.boolean().optional().default(true).describe("Enable media unfurling"),
    },
  },
  async (args) => {
    const identity = resolveIdentity(args);
    const metadata = args.metadata_event_type ? {
      event_type: args.metadata_event_type,
      event_payload: JSON.parse(args.metadata_payload || '{}'),
    } : undefined;

    const response = await slackClient.postMessage({
      channel_id: args.channel_id,
      text: args.text,
      ...(identity !== null && {
        username: identity.username,
        icon_emoji: identity.icon_emoji,
        icon_url: identity.icon_url,
      }),
      thread_ts: args.thread_ts,
      reply_broadcast: args.reply_broadcast,
      metadata,
      blocks: args.blocks ? JSON.parse(args.blocks) : undefined,
      unfurl_links: args.unfurl_links,
      unfurl_media: args.unfurl_media,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(response) }],
    };
  }
);
```

**`slack_reply_to_thread` — Updated:**

Same identity parameters added. The `slack_reply_to_thread` tool becomes a convenience wrapper that calls `postMessage` with `thread_ts` required.

### 2.4 Modified `postReply` Method

```typescript
async postReply(
  channel_id: string,
  thread_ts: string,
  text: string,
  username?: string,
  icon_emoji?: string,
  icon_url?: string,
  metadata?: { event_type: string; event_payload: Record<string, unknown> },
): Promise<SlackResponse> {
  return this.postMessage({
    channel_id,
    text,
    thread_ts,
    username,
    icon_emoji,
    icon_url,
    metadata,
  });
}
```

### 2.5 Environment Variable Changes

```bash
# Existing (unchanged)
SLACK_BOT_TOKEN=xoxb-...        # Bot token with chat:write.customize scope
SLACK_TEAM_ID=T...               # Workspace ID
SLACK_CHANNEL_IDS=C...,C...      # Optional: restrict to specific channels

# New
SLACK_AGENT_CONFIG_PATH=./agent-identities.json  # Path to agent identity config
SLACK_USER_TOKEN=xoxp-...        # Optional: user token for search.messages
SLACK_RATE_LIMIT_BURST=5         # Optional: max burst size (default 5)
SLACK_MESSAGE_LOG=./slack-messages.jsonl  # Optional: local message log path
```

### 2.6 User Token for Search

`search.messages` requires a **user token** (`xoxp-`), not a bot token. The fork must support an optional secondary token for search operations. Bot tokens cannot use search endpoints — this is a hard Slack API constraint.

```typescript
class SlackClient {
  private botHeaders: { Authorization: string; "Content-Type": string };
  private userHeaders?: { Authorization: string; "Content-Type": string };

  constructor(botToken: string, userToken?: string) {
    this.botHeaders = {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    };
    if (userToken) {
      this.userHeaders = {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      };
    }
  }

  async searchMessages(query: string, sort: string = 'timestamp', sortDir: string = 'desc', count: number = 20): Promise<SlackResponse> {
    if (!this.userHeaders) {
      return { ok: false, error: 'search requires SLACK_USER_TOKEN (xoxp-) to be configured' };
    }
    const params = new URLSearchParams({
      query,
      sort,
      sort_dir: sortDir,
      count: count.toString(),
    });
    return this.rateLimiter.enqueue('search.messages', async () => {
      const response = await fetch(
        `https://slack.com/api/search.messages?${params}`,
        { headers: this.userHeaders! },
      );
      return response.json();
    });
  }
}
```

---

## 3. Agent Identity System

### 3.1 Identity Configuration Format

```json
{
  "$schema": "./agent-identity-schema.json",
  "version": "1.0",
  "defaultIdentity": {
    "username": "[AI] DevTeam Bot",
    "icon_emoji": ":robot_face:"
  },
  "agents": {
    "team-lead": {
      "username": "[AI] Team Lead",
      "icon_emoji": ":crown:",
      "color": "#4A90D9",
      "role": "Project coordination and task assignment"
    },
    "architect": {
      "username": "[AI] Architect",
      "icon_emoji": ":building_construction:",
      "color": "#7B68EE",
      "role": "System design and technical decisions"
    },
    "senior-engineer": {
      "username": "[AI] Senior Engineer",
      "icon_emoji": ":hammer_and_wrench:",
      "color": "#2ECC71",
      "role": "Implementation and code review"
    },
    "qa-engineer": {
      "username": "[AI] QA Engineer",
      "icon_emoji": ":mag:",
      "color": "#E74C3C",
      "role": "Testing and quality assurance"
    },
    "doc-agent": {
      "username": "[AI] Doc Agent",
      "icon_emoji": ":books:",
      "color": "#F39C12",
      "role": "Documentation and knowledge management"
    },
    "devops": {
      "username": "[AI] DevOps",
      "icon_emoji": ":gear:",
      "color": "#95A5A6",
      "role": "Infrastructure and deployment"
    },
    "security-reviewer": {
      "username": "[AI] Security Reviewer",
      "icon_emoji": ":shield:",
      "color": "#E91E63",
      "role": "Security audit and vulnerability assessment"
    }
  }
}
```

### 3.2 Identity Resolution

Identity is resolved per tool call via explicit parameters. When the caller provides `username`/`icon_emoji`/`icon_url`, those values are used directly. When omitted, the system falls back to the config file, then to the default identity.

```typescript
interface AgentIdentity {
  username: string;
  icon_emoji?: string;
  icon_url?: string;
  color?: string;
  role?: string;
}

interface AgentConfig {
  version: string;
  defaultIdentity: AgentIdentity;
  agents: Record<string, AgentIdentity>;
}

let agentConfig: AgentConfig | null = null;

function loadAgentConfig(): AgentConfig | null {
  const configPath = process.env.SLACK_AGENT_CONFIG_PATH;
  if (!configPath) return null;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    console.error(`Failed to load agent config from ${configPath}`);
    return null;
  }
}

function resolveIdentity(args: {
  username?: string;
  icon_emoji?: string;
  icon_url?: string;
  agent_id?: string;
}): AgentIdentity | null {
  // Explicit parameters take highest priority
  if (args.username) {
    return {
      username: args.username,
      icon_emoji: args.icon_emoji,
      icon_url: args.icon_url,
    };
  }

  // Look up by agent_id in config
  if (args.agent_id && agentConfig?.agents[args.agent_id]) {
    return agentConfig.agents[args.agent_id];
  }

  // Fall back to default
  if (agentConfig?.defaultIdentity) {
    return agentConfig.defaultIdentity;
  }

  // No identity override — message posts as the bot app's configured name
  return null;
}
```

### 3.3 How Identity Reaches the MCP Server

Each MCP tool call includes the identity parameters as part of the tool's input schema. This is the cleanest approach because:

1. **No ambient state** — each call is self-contained
2. **Agent framework agnostic** — works whether the caller is Claude Code, a custom orchestrator, or any MCP client
3. **Auditable** — every message's identity is visible in the tool call arguments

The `agent_id` parameter provides a shorthand: instead of passing `username` + `icon_emoji` on every call, the caller passes `agent_id: "architect"` and the server resolves it from config.

```typescript
// All message-posting tools include these optional parameters:
agent_id: z.string().optional().describe("Agent ID from identity config (e.g. 'architect', 'qa-engineer')"),
username: z.string().optional().describe("Display name override (takes priority over agent_id)"),
icon_emoji: z.string().optional().describe("Emoji icon override"),
icon_url: z.string().optional().describe("URL icon override"),
```

---

## 4. Rate Limit Handling

### 4.1 Slack Rate Limit Facts

> **Internal app requirement:** These rates assume the fork is deployed as an **internal custom app**. As of May 2025, non-Marketplace commercial apps are subject to severely reduced limits (e.g., `conversations.history` drops from Tier 3 to Tier 1 — 1 req/min, max 15 objects). Internal apps are exempt from these restrictions.

**`chat.postMessage`** — Special tier:
- ~1 message/second per channel
- Several hundred messages/minute per workspace
- Generous burst behavior allowed for short periods
- HTTP 429 response with `Retry-After` header when exceeded

**Other methods:**

| Method | Tier (internal app) | Approx. Rate | Note |
|--------|------|-------------|------|
| `conversations.list` | Tier 2 | ~20 req/min | |
| `conversations.create` | Tier 2 | ~20 req/min | |
| `conversations.history` | Tier 3 | ~50 req/min | **Tier 1 (1/min) for non-Marketplace commercial apps** |
| `conversations.replies` | Tier 3 | ~50 req/min | **Tier 1 (1/min) for non-Marketplace apps effective March 2026** |
| `conversations.setTopic` | Tier 2 | ~20 req/min |
| `conversations.setPurpose` | Tier 2 | ~20 req/min |
| `conversations.archive` | Tier 2 | ~20 req/min |
| `reactions.add` | Tier 2 | ~20 req/min |
| `reactions.remove` | Tier 2 | ~20 req/min |
| `search.messages` | Tier 2 | ~20 req/min |
| `pins.add` | Tier 2 | ~20 req/min |
| `pins.remove` | Tier 2 | ~20 req/min |
| `users.list` | Tier 2 | ~20 req/min |
| `users.profile.get` | Tier 4 | ~100 req/min |
| `chat.update` | Tier 3 | ~50 req/min |

### 4.2 Rate Limiter Design

```typescript
interface QueuedRequest {
  method: string;
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  priority: number; // 0 = highest priority
  enqueuedAt: number;
}

class SlackRateLimiter {
  // Per-method tracking
  private methodWindows: Map<string, { timestamps: number[] }> = new Map();
  // Per-channel tracking for chat.postMessage
  private channelWindows: Map<string, number> = new Map(); // last send time
  // Global queue
  private queue: QueuedRequest[] = [];
  private processing = false;
  // Backoff state
  private retryAfter: number = 0;

  private readonly METHOD_LIMITS: Record<string, { perMinute: number }> = {
    'chat.postMessage': { perMinute: 300 }, // workspace-wide, ~1/sec/channel handled separately
    'chat.update': { perMinute: 50 }, // Tier 3
    'conversations.list': { perMinute: 20 },
    'conversations.create': { perMinute: 20 },
    'conversations.history': { perMinute: 50 },
    'conversations.replies': { perMinute: 50 },
    'reactions.add': { perMinute: 20 },
    'reactions.remove': { perMinute: 20 },
    'search.messages': { perMinute: 20 },
    'pins.add': { perMinute: 20 },
    'pins.remove': { perMinute: 20 },
    'conversations.setTopic': { perMinute: 20 },
    'conversations.setPurpose': { perMinute: 20 },
    'conversations.archive': { perMinute: 20 },
    'users.list': { perMinute: 20 },
    'users.profile.get': { perMinute: 100 },
  };

  async enqueue<T>(
    method: string,
    execute: () => Promise<T>,
    priority: number = 2,
    channelId?: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        method,
        execute,
        resolve,
        reject,
        priority,
        enqueuedAt: Date.now(),
      });
      // Sort by priority (lower = higher priority), then by enqueue time
      this.queue.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      // Respect Retry-After from previous 429
      if (this.retryAfter > Date.now()) {
        await this.sleep(this.retryAfter - Date.now());
      }

      const item = this.queue[0];
      const limit = this.METHOD_LIMITS[item.method];

      if (limit && !this.canProceed(item.method, limit.perMinute)) {
        // Wait until the oldest request in the window expires
        await this.sleep(this.getWaitTime(item.method));
        continue;
      }

      this.queue.shift();
      this.recordRequest(item.method);

      try {
        const result = await item.execute();

        // Check for Slack API rate limit error in response body
        if (result && !result.ok && result.error === 'ratelimited') {
          const retryAfterSec = parseInt(result._retryAfter, 10) || 1;
          this.retryAfter = Date.now() + (retryAfterSec * 1000);
          console.error(`Rate limited on ${item.method}, retrying after ${retryAfterSec}s`);
          // Re-enqueue at front
          this.queue.unshift(item);
          continue;
        }

        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
    }

    this.processing = false;
  }

  private canProceed(method: string, perMinute: number): boolean {
    const window = this.methodWindows.get(method);
    if (!window) return true;
    const now = Date.now();
    const windowStart = now - 60_000;
    const recentRequests = window.timestamps.filter(t => t > windowStart);
    return recentRequests.length < perMinute;
  }

  private recordRequest(method: string): void {
    if (!this.methodWindows.has(method)) {
      this.methodWindows.set(method, { timestamps: [] });
    }
    const window = this.methodWindows.get(method)!;
    window.timestamps.push(Date.now());
    // Prune old entries
    const cutoff = Date.now() - 60_000;
    window.timestamps = window.timestamps.filter(t => t > cutoff);
  }

  private getWaitTime(method: string): number {
    const window = this.methodWindows.get(method);
    if (!window || window.timestamps.length === 0) return 0;
    const oldest = Math.min(...window.timestamps);
    return Math.max(0, oldest + 60_000 - Date.now() + 100); // +100ms buffer
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 4.3 Priority Levels

| Priority | Use Case | Example |
|----------|----------|---------|
| 0 | Human override / emergency | HITL interrupt messages |
| 1 | Decision/approval messages | RFC votes, blocking decisions |
| 2 | Normal agent messages | Status updates, task discussion (default) |
| 3 | Background / bulk | Log summaries, documentation updates |

Priority is passed as an optional parameter on message-posting tools:

```typescript
priority: z.number().optional().default(2).describe("Message priority for rate limit queue: 0=urgent, 1=decision, 2=normal, 3=background"),
```

### 4.4 429 Response Handling

When Slack returns HTTP 429:

1. Read `Retry-After` header (seconds until safe to retry)
2. Set `retryAfter` timestamp on the rate limiter
3. Re-enqueue the failed request at the front of the queue
4. All subsequent requests wait until the retry-after window passes
5. Log the rate limit event to stderr for observability

When a Slack response body contains `{ ok: false, error: "ratelimited" }` but is HTTP 200 (which Slack sometimes does):

1. Same handling as HTTP 429
2. Default to 1-second retry if no `Retry-After` header present

### 4.5 Network Failure Handling (Distinct from Rate Limits)

The rate limiter handles HTTP 429 responses. Network-level failures (DNS resolution failure, TCP connection timeout, HTTP 5xx from Slack) require separate handling:

```typescript
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 5,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // 5xx = Slack is having issues, retry
      if (response.status >= 500) {
        lastError = new Error(`Slack API returned ${response.status}`);
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return response;
    } catch (error) {
      // Network-level failure (DNS, TCP timeout, etc.)
      lastError = error instanceof Error ? error : new Error(String(error));
      const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
      console.error(`Slack API unreachable (attempt ${attempt + 1}/${maxRetries}): ${lastError.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new Error(`Slack API unavailable after ${maxRetries} attempts: ${lastError?.message}`);
}
```

All `SlackClient` methods use `fetchWithRetry` instead of raw `fetch`. When all retries are exhausted, the tool returns:

```json
{
  "ok": false,
  "error": "slack_unavailable",
  "message": "Slack API unreachable after 5 attempts. Agents can continue via native messaging.",
  "retry_after_seconds": 60
}
```

### 4.6 Local Message Logging

All messages sent through the fork are appended to a local JSONL file for durability:

```typescript
function logMessage(entry: {
  timestamp: string;
  channel_id: string;
  agent_id?: string;
  username?: string;
  text: string;
  thread_ts?: string;
  slack_ts?: string;
  delivered: boolean;
  error?: string;
}): void {
  const logPath = process.env.SLACK_MESSAGE_LOG || './slack-messages.jsonl';
  appendFileSync(logPath, JSON.stringify(entry) + '\n');
}
```

This log enables: post-outage message replay, audit trails, debugging, and metrics on delivery success rates.

### 4.7 Surfacing Rate Limit Issues to Agents

When a tool call would be significantly delayed due to queuing:

```typescript
// If estimated wait exceeds 10 seconds, return a warning
if (estimatedWait > 10_000) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        warning: "rate_limit_queue_delay",
        estimated_wait_seconds: Math.ceil(estimatedWait / 1000),
        queue_depth: this.queue.length,
        message: "Message queued due to rate limits. Consider reducing message frequency.",
      }),
    }],
  };
}
```

---

## 5. New Tools

### 5.1 Channel Management

**`slack_create_channel`**

```typescript
server.registerTool(
  "slack_create_channel",
  {
    title: "Create Slack Channel",
    description: "Create a new public or private Slack channel",
    inputSchema: {
      name: z.string().describe("Channel name (lowercase, no spaces, max 80 chars). Use hyphens for separators."),
      is_private: z.boolean().optional().default(false).describe("Create as private channel"),
      description: z.string().optional().describe("Channel description/purpose"),
    },
  },
  async ({ name, is_private, description }) => {
    const createResponse = await slackClient.createChannel(name, is_private);
    if (createResponse.ok && description && createResponse.channel?.id) {
      await slackClient.setChannelPurpose(createResponse.channel.id, description);
    }
    return { content: [{ type: "text", text: JSON.stringify(createResponse) }] };
  }
);
```

Slack API: `conversations.create`
- Scope: `channels:manage` (public) / `groups:write` (private)
- Tier 2 rate limit

**`slack_archive_channel`**

```typescript
server.registerTool(
  "slack_archive_channel",
  {
    title: "Archive Slack Channel",
    description: "Archive a Slack channel",
    inputSchema: {
      channel_id: z.string().describe("Channel ID to archive"),
    },
  },
  async ({ channel_id }) => {
    const response = await slackClient.archiveChannel(channel_id);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  }
);
```

Slack API: `conversations.archive`
- Scope: `channels:manage` / `groups:write`
- Tier 2 rate limit

**`slack_set_channel_topic`**

```typescript
server.registerTool(
  "slack_set_channel_topic",
  {
    title: "Set Channel Topic",
    description: "Set the topic of a Slack channel (max 250 characters)",
    inputSchema: {
      channel_id: z.string().describe("Channel ID"),
      topic: z.string().max(250).describe("New topic text (max 250 chars, no formatting)"),
    },
  },
  async ({ channel_id, topic }) => {
    const response = await slackClient.setChannelTopic(channel_id, topic);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  }
);
```

Slack API: `conversations.setTopic`
- Topic max: 250 characters, plain text only (no mrkdwn)
- Scope: `channels:manage` / `groups:write`

**`slack_set_channel_purpose`**

```typescript
server.registerTool(
  "slack_set_channel_purpose",
  {
    title: "Set Channel Purpose",
    description: "Set the purpose/description of a Slack channel (max 250 characters)",
    inputSchema: {
      channel_id: z.string().describe("Channel ID"),
      purpose: z.string().max(250).describe("New purpose text (max 250 chars)"),
    },
  },
  async ({ channel_id, purpose }) => {
    const response = await slackClient.setChannelPurpose(channel_id, purpose);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  }
);
```

Slack API: `conversations.setPurpose`

### 5.2 Reactions

**`slack_remove_reaction`** (add_reaction already exists)

```typescript
server.registerTool(
  "slack_remove_reaction",
  {
    title: "Remove Slack Reaction",
    description: "Remove an emoji reaction from a message",
    inputSchema: {
      channel_id: z.string().describe("Channel ID containing the message"),
      timestamp: z.string().describe("Message timestamp"),
      reaction: z.string().describe("Emoji name (without colons)"),
    },
  },
  async ({ channel_id, timestamp, reaction }) => {
    const response = await slackClient.removeReaction(channel_id, timestamp, reaction);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  }
);
```

Slack API: `reactions.remove`
- Scope: `reactions:write`
- Tier 2 rate limit

### 5.3 Search

**`slack_search_messages`**

```typescript
server.registerTool(
  "slack_search_messages",
  {
    title: "Search Slack Messages",
    description: "Search for messages matching a query. Requires SLACK_USER_TOKEN to be configured.",
    inputSchema: {
      query: z.string().describe("Search query (supports Slack search modifiers like 'in:#channel', 'from:@user', 'after:2026-01-01')"),
      sort: z.enum(["score", "timestamp"]).optional().default("timestamp").describe("Sort order"),
      sort_dir: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort direction"),
      count: z.number().optional().default(20).describe("Number of results (max 100)"),
    },
  },
  async ({ query, sort, sort_dir, count }) => {
    const response = await slackClient.searchMessages(query, sort, sort_dir, Math.min(count, 100));
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  }
);
```

Slack API: `search.messages`
- Scope: `search:read` (user token only)
- Tier 2 rate limit
- **Constraint:** This method does NOT work with bot tokens. A user token (`xoxp-`) must be configured.

### 5.4 Message Update

**`slack_update_message`**

```typescript
server.registerTool(
  "slack_update_message",
  {
    title: "Update Slack Message",
    description: "Edit an existing message. Used for decision lifecycle transitions (PROPOSED → ACCEPTED → SUPERSEDED). Identity fields (username, icon_emoji) cannot be changed on update — Slack applies the original message's identity.",
    inputSchema: {
      channel_id: z.string().describe("Channel ID containing the message"),
      timestamp: z.string().describe("Timestamp (ts) of the message to update"),
      text: z.string().describe("New message text (replaces entire message text)"),
      blocks: z.string().optional().describe("JSON string of updated Block Kit blocks array"),
      metadata_event_type: z.string().optional().describe("Updated metadata event type"),
      metadata_payload: z.string().optional().describe("JSON string of updated metadata event payload"),
    },
  },
  async (args) => {
    const metadata = args.metadata_event_type ? {
      event_type: args.metadata_event_type,
      event_payload: JSON.parse(args.metadata_payload || '{}'),
    } : undefined;

    const response = await slackClient.updateMessage({
      channel_id: args.channel_id,
      timestamp: args.timestamp,
      text: args.text,
      blocks: args.blocks ? JSON.parse(args.blocks) : undefined,
      metadata,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(response) }],
    };
  }
);
```

Slack API: `chat.update`
- Scope: `chat:write` (same scope as `chat.postMessage`)
- Tier 3 rate limit (~50 req/min)
- **Identity on update:** `chat.update` does NOT accept `username` or `icon_emoji` parameters — Slack preserves the original message's display identity. This is correct behavior for the decision protocol: when a PROPOSAL transitions to ACCEPTED, the status changes but the authoring agent's identity remains.
- **Primary use case:** Decision lifecycle transitions per Protocol 3 (§3.8 of communication-protocols.md). When a decision moves from PROPOSED to ACCEPTED, the original message is updated to reflect the new status rather than posting a separate status-change message. This keeps the decision record in a single message location.
- **Blocks and metadata:** Both `blocks` and `metadata` can be updated. If `blocks` is provided, it replaces the existing blocks. If `metadata` is provided, it replaces the existing metadata. Omitting either leaves the original value unchanged.

### 5.5 Pins

**`slack_pin_message`**

```typescript
server.registerTool(
  "slack_pin_message",
  {
    title: "Pin Slack Message",
    description: "Pin a message in a channel for easy reference",
    inputSchema: {
      channel_id: z.string().describe("Channel ID"),
      timestamp: z.string().describe("Message timestamp to pin"),
    },
  },
  async ({ channel_id, timestamp }) => {
    const response = await slackClient.pinMessage(channel_id, timestamp);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  }
);
```

Slack API: `pins.add`
- Scope: `pins:write`
- Tier 2 rate limit

**`slack_unpin_message`**

```typescript
server.registerTool(
  "slack_unpin_message",
  {
    title: "Unpin Slack Message",
    description: "Remove a pin from a message",
    inputSchema: {
      channel_id: z.string().describe("Channel ID"),
      timestamp: z.string().describe("Message timestamp to unpin"),
    },
  },
  async ({ channel_id, timestamp }) => {
    const response = await slackClient.unpinMessage(channel_id, timestamp);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  }
);
```

### 5.6 Summary: Complete Tool Inventory (Fork)

| Tool | Status | Slack API | Scope Required |
|------|--------|-----------|---------------|
| `slack_list_channels` | Existing | `conversations.list` | `channels:read`, `groups:read` |
| `slack_post_message` | **Modified** | `chat.postMessage` | `chat:write`, `chat:write.customize` |
| `slack_reply_to_thread` | **Modified** | `chat.postMessage` | `chat:write`, `chat:write.customize` |
| `slack_update_message` | **New** | `chat.update` | `chat:write` |
| `slack_add_reaction` | Existing | `reactions.add` | `reactions:write` |
| `slack_remove_reaction` | **New** | `reactions.remove` | `reactions:write` |
| `slack_get_channel_history` | Existing | `conversations.history` | `channels:history`, `groups:history` |
| `slack_get_thread_replies` | Existing | `conversations.replies` | `channels:history`, `groups:history` |
| `slack_get_users` | Existing | `users.list` | `users:read` |
| `slack_get_user_profile` | Existing | `users.profile.get` | `users.profile:read` |
| `slack_create_channel` | **New** | `conversations.create` | `channels:manage`, `groups:write` |
| `slack_archive_channel` | **New** | `conversations.archive` | `channels:manage` |
| `slack_set_channel_topic` | **New** | `conversations.setTopic` | `channels:manage`, `groups:write` |
| `slack_set_channel_purpose` | **New** | `conversations.setPurpose` | `channels:manage`, `groups:write` |
| `slack_search_messages` | **New** | `search.messages` | `search:read` (user token) |
| `slack_pin_message` | **New** | `pins.add` | `pins:write` |
| `slack_unpin_message` | **New** | `pins.remove` | `pins:write` |

**Total: 17 tools** (6 existing + 2 modified + 9 new)

---

## 6. Testing Strategy

### 6.1 Unit Tests

**Identity resolution:**
```typescript
describe('resolveIdentity', () => {
  it('returns explicit username when provided', () => {
    const result = resolveIdentity({ username: 'Custom Bot', icon_emoji: ':star:' });
    expect(result.username).toBe('Custom Bot');
    expect(result.icon_emoji).toBe(':star:');
  });

  it('looks up agent_id from config', () => {
    loadConfig({ agents: { architect: { username: 'Architect', icon_emoji: ':building_construction:' } } });
    const result = resolveIdentity({ agent_id: 'architect' });
    expect(result.username).toBe('Architect');
  });

  it('falls back to default identity', () => {
    loadConfig({ defaultIdentity: { username: 'Bot', icon_emoji: ':robot_face:' } });
    const result = resolveIdentity({});
    expect(result.username).toBe('Bot');
  });

  it('explicit params override agent_id', () => {
    loadConfig({ agents: { architect: { username: 'Architect' } } });
    const result = resolveIdentity({ agent_id: 'architect', username: 'Override' });
    expect(result.username).toBe('Override');
  });
});
```

**Rate limiter:**
```typescript
describe('SlackRateLimiter', () => {
  it('processes requests within limits immediately', async () => {
    const limiter = new SlackRateLimiter();
    const start = Date.now();
    await limiter.enqueue('users.profile.get', async () => ({ ok: true }));
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('queues requests that exceed per-minute limit', async () => {
    const limiter = new SlackRateLimiter();
    // Fill the Tier 2 window (20 req/min)
    const promises = Array.from({ length: 25 }, (_, i) =>
      limiter.enqueue('conversations.create', async () => ({ ok: true, i }))
    );
    const results = await Promise.all(promises);
    expect(results).toHaveLength(25);
    // Last 5 should have been delayed
  });

  it('respects priority ordering', async () => {
    const limiter = new SlackRateLimiter();
    const order: number[] = [];
    // Enqueue low priority first, then high priority
    const p3 = limiter.enqueue('chat.postMessage', async () => { order.push(3); return { ok: true }; }, 3);
    const p0 = limiter.enqueue('chat.postMessage', async () => { order.push(0); return { ok: true }; }, 0);
    await Promise.all([p3, p0]);
    expect(order[0]).toBe(0); // High priority processed first
  });

  it('handles 429 retry-after', async () => {
    const limiter = new SlackRateLimiter();
    let attempts = 0;
    const result = await limiter.enqueue('chat.postMessage', async () => {
      attempts++;
      if (attempts === 1) {
        return { ok: false, error: 'ratelimited' };
      }
      return { ok: true };
    });
    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
  });
});
```

**PostMessage body construction:**
```typescript
describe('SlackClient.postMessage', () => {
  it('includes identity fields when provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse({ ok: true }));
    await client.postMessage({
      channel_id: 'C123',
      text: 'Hello',
      username: 'Architect',
      icon_emoji: ':building_construction:',
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.username).toBe('Architect');
    expect(body.icon_emoji).toBe(':building_construction:');
  });

  it('omits identity fields when not provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse({ ok: true }));
    await client.postMessage({ channel_id: 'C123', text: 'Hello' });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.username).toBeUndefined();
    expect(body.icon_emoji).toBeUndefined();
  });

  it('includes metadata when provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse({ ok: true }));
    await client.postMessage({
      channel_id: 'C123',
      text: 'Hello',
      metadata: {
        event_type: 'agent_status_update',
        event_payload: { agent_id: 'architect', status: 'working' },
      },
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.metadata.event_type).toBe('agent_status_update');
    expect(body.metadata.event_payload.agent_id).toBe('architect');
  });
});
```

### 6.2 Integration Tests (Slack Test Workspace)

Requires a dedicated Slack workspace for testing (free tier is sufficient).

```typescript
describe('Integration: Slack API', () => {
  // These tests run against a real Slack workspace
  // Set TEST_SLACK_BOT_TOKEN, TEST_SLACK_TEAM_ID, TEST_SLACK_CHANNEL_ID env vars

  it('posts message with custom identity', async () => {
    const response = await client.postMessage({
      channel_id: testChannelId,
      text: `Integration test: ${Date.now()}`,
      username: 'Test Bot',
      icon_emoji: ':test_tube:',
    });
    expect(response.ok).toBe(true);
    expect(response.message.username).toBe('Test Bot');
  });

  it('posts threaded reply with identity', async () => {
    // First post a parent message
    const parent = await client.postMessage({
      channel_id: testChannelId,
      text: 'Thread parent',
    });
    // Then reply
    const reply = await client.postReply(
      testChannelId,
      parent.ts,
      'Thread reply',
      'Reply Bot',
      ':speech_balloon:',
    );
    expect(reply.ok).toBe(true);
    expect(reply.message.thread_ts).toBe(parent.ts);
  });

  it('creates and archives a channel', async () => {
    const name = `test-${Date.now()}`;
    const created = await client.createChannel(name, false);
    expect(created.ok).toBe(true);
    const archived = await client.archiveChannel(created.channel.id);
    expect(archived.ok).toBe(true);
  });

  it('adds and removes reactions', async () => {
    const msg = await client.postMessage({ channel_id: testChannelId, text: 'Reaction test' });
    const added = await client.addReaction(testChannelId, msg.ts, 'thumbsup');
    expect(added.ok).toBe(true);
    const removed = await client.removeReaction(testChannelId, msg.ts, 'thumbsup');
    expect(removed.ok).toBe(true);
  });
});
```

### 6.3 Rate Limit Simulation Tests

```typescript
describe('Rate limit simulation', () => {
  it('handles burst of 10 messages to same channel', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.postMessage({
          channel_id: testChannelId,
          text: `Burst message ${i}`,
          username: `Agent ${i % 3}`,
        })
      )
    );
    // All should succeed (Slack allows bursts)
    expect(results.every(r => r.ok)).toBe(true);
  });

  it('queues correctly under sustained load', async () => {
    // Send 30 messages over 30 seconds — should stay within limits
    for (let i = 0; i < 30; i++) {
      const response = await client.postMessage({
        channel_id: testChannelId,
        text: `Sustained load message ${i}`,
      });
      expect(response.ok).toBe(true);
    }
  });
});
```

### 6.4 Identity Verification

```typescript
// Verify messages appear with correct display identity in Slack
it('message shows correct username in conversations.history', async () => {
  const posted = await client.postMessage({
    channel_id: testChannelId,
    text: 'Identity verification test',
    username: 'Custom Name',
    icon_emoji: ':star:',
  });

  const history = await client.getChannelHistory(testChannelId, 1);
  const msg = history.messages[0];
  expect(msg.username).toBe('Custom Name');
  expect(msg.icons?.emoji).toBe(':star:');
});
```

---

## 7. Deployment

### 7.1 Replacing the Official MCP Server

The fork replaces the official `@modelcontextprotocol/server-slack` in your Claude Code or MCP client configuration.

**Claude Code `~/.claude/settings.local.json`:**

```json
{
  "mcpServers": {
    "slack": {
      "command": "node",
      "args": ["/path/to/devteam-slack-mcp-server/dist/index.js"],
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

Or using the `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "slack": {
      "command": "node",
      "args": ["./tools/slack-mcp-server/dist/index.js"],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
        "SLACK_TEAM_ID": "${SLACK_TEAM_ID}",
        "SLACK_AGENT_CONFIG_PATH": "./agent-identities.json",
        "SLACK_USER_TOKEN": "${SLACK_USER_TOKEN}"
      }
    }
  }
}
```

### 7.2 Build Process

```bash
# Clone the fork
git clone https://github.com/your-org/devteam-slack-mcp-server.git
cd devteam-slack-mcp-server

# Install dependencies
npm install

# Build
npm run build    # tsc && shx chmod +x dist/*.js

# Run tests
npm test

# Run in stdio mode (default)
node dist/index.js

# Run in HTTP mode
node dist/index.js --transport http --port 3000 --token your-auth-token
```

### 7.3 Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.15.1",
    "express": "^5.1.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@jest/globals": "^30.0.4",
    "@types/express": "^4.17.21",
    "@types/jest": "^30.0.0",
    "@types/node": "^24",
    "jest": "^30.0.4",
    "shx": "^0.4.0",
    "ts-jest": "^29.4.0",
    "typescript": "^5.8.3"
  }
}
```

No new runtime dependencies are added. The rate limiter and identity system are implemented with zero external dependencies.

### 7.4 Slack App Configuration

Create a new Slack App (or update existing) at https://api.slack.com/apps:

1. **OAuth & Permissions** — Add all scopes from §2.1
2. **Install to Workspace** — Get the `xoxb-` bot token
3. **User Token** — If search is needed, also obtain an `xoxp-` user token via OAuth flow
4. **Event Subscriptions** — Not required for this MCP server (it polls, doesn't receive events)

### 7.5 Required Slack App Permissions Summary

**Bot Token Scopes:**
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

**User Token Scopes (optional, for search):**
```
search:read
```

### 7.6 Admin APIs (Optional, for Enterprise Grid)

For organizations on Enterprise Grid that need org-wide channel management, Slack provides admin APIs that are more powerful than the standard `conversations.*` methods:

- `admin.conversations.create` — create channels with `org_wide=true` for cross-workspace visibility
- `admin.conversations.bulkArchive` / `bulkDelete` / `bulkMove` — bulk channel management
- `admin.conversations.invite` — programmatic channel membership management
- `admin.apps.approve` / `admin.apps.restrict` — automated app governance

These require org-level app installation (not workspace-level) and are NOT included in the fork's initial tool set. They can be added as an extension if the deployment targets Enterprise Grid.

### 7.7 Socket Mode (Alternative to HTTP Endpoint)

For internal/dev deployments where a public HTTP endpoint is not available or desired, Slack's Socket Mode provides WebSocket-based communication without requiring a public URL. Socket Mode apps:
- Don't need a publicly accessible endpoint
- Can be deployed org-wide
- Cannot be listed on the Slack Marketplace (which is fine for internal apps)
- Share the same 30,000 Events API deliveries/workspace/app/hour limit

The fork currently supports stdio and HTTP transports. Socket Mode support could be added as a future transport option if event-driven (push) communication is needed instead of polling.

---

## 8. Technical Risks

### 8.1 `chat:write.customize` Availability

**Risk:** The `chat:write.customize` scope may not be available for all workspace types. Enterprise Grid workspaces might restrict this scope via admin policies.

**Mitigation:** The identity system degrades gracefully. If `chat:write.customize` is not granted, messages will post under the bot's default name/icon. The server should log a warning on startup if identity config is loaded but the scope is not granted (detectable when the first customized message fails with `missing_scope`).

### 8.2 Rate Limits Under Multi-Agent Load

**Risk:** With 5-10 agents posting through a single bot token, the ~1 msg/sec/channel limit and workspace-wide limits could be hit frequently during active development discussions.

**Mitigation:** The rate limiter queue with priority levels (§4) handles this. Additionally:
- Agents should prefer threaded replies over channel-level posts to reduce channel-level rate pressure
- Protocol design should batch status updates rather than posting individually
- Consider multiple channels to distribute load (e.g., `#dev-decisions`, `#dev-status`, `#dev-code-review`)

### 8.3 User Token for Search

**Risk:** `search.messages` requires a user token, which is tied to a specific person's identity and permissions. If that person leaves the org or changes roles, search breaks.

**Mitigation:** Use a service account (dedicated Slack user) for the user token. Document this in the setup guide. If no user token is provided, the `slack_search_messages` tool returns a clear error message rather than failing silently.

### 8.4 Message Metadata Limitations

**Risk:** Slack's `metadata` field on `chat.postMessage` has schema constraints that limit what can be stored:
- Property names must begin with `[a-z]` and contain only `[a-z0-9_]` (no camelCase, no hyphens)
- **Nested objects in `event_payload` are NOT supported** unless a custom event type is defined in the app manifest
- Arrays containing objects or other arrays are NOT supported
- `null` values should be avoided (omit fields instead)
- If `event_type` matches a manifest-defined type, Slack validates required params — failure still posts the message but strips metadata silently
- Metadata is NOT visible in the Slack UI — it's API-only (readable via `conversations.history` with `include_all_metadata=true`)

**Mitigation:** Use metadata for flat key-value protocol routing only (intent type, priority, agent_id, reference IDs). No nested structures. Keep human-readable content in message text. If metadata is rejected, fall back to a structured prefix in message text (e.g., `[PROTOCOL:decision_request][PRIORITY:1]`).

**Note for existing tools:** The `slack_get_channel_history` and `slack_get_thread_replies` tools should pass `include_all_metadata=true` to Slack API calls so protocol metadata is returned when reading messages.

### 8.5 Single Point of Failure and Slack Outages

**Risk:** All agents use a single MCP server instance and depend on Slack API availability. Slack had three major outages in 2025 (Feb: 9hrs, May: 2hrs, Nov: 2hrs). A Slack outage means the human-visible communication layer goes dark.

**Key distinction:** Slack is the **human-in-the-loop visibility layer**, not the agent coordination backbone. Agents communicate with each other via their native messaging system (Claude Code's SendMessage tool, task system, etc.). Slack provides human visibility into agent activity. A Slack outage degrades human oversight but does not halt agent collaboration.

**Mitigations:**
- The MCP server is stateless (no persistent state beyond the in-memory rate limiter). Restarting it is instant. For production use, run in HTTP mode behind a process manager (`pm2`, `systemd`, Docker with restart policy).
- **Network failure handling:** The `SlackClient` must distinguish HTTP 429 (rate limits) from connection failures (DNS failure, TCP timeout, HTTP 5xx). Connection failures retry with exponential backoff (1s, 2s, 4s, 8s, max 30s) up to 5 attempts. After max retries, return `{ ok: false, error: "slack_unavailable", retry_after_seconds: 60 }` to the calling agent — never silently swallow failures.
- **Local message logging:** All messages sent through the fork should be appended to a local JSONL file (`slack-messages.jsonl`) with timestamp, channel, agent identity, text, and Slack delivery status. This provides a durable record regardless of Slack availability, and enables message replay after outages.
- A full offline fallback communication system is explicitly out of scope — building a secondary message bus would duplicate the primary communication system and adds unjustified complexity given that agents have their own coordination channel.

### 8.6 Channel Topic/Purpose Length Limits

**Risk:** Slack limits topic and purpose fields to 250 characters each, which may be insufficient for conveying agent status information through channel topics.

**Mitigation:** Use abbreviated formats in topics. Full status information should go in pinned messages or dedicated status-update messages, not channel topics.

### 8.7 Single-Token Identity Architecture — Security Analysis

**Risk:** The fork uses one `xoxb-` bot token with `chat:write.customize` to switch display names per message. This pattern is architecturally similar to documented Slack identity spoofing attacks (Push Security phishing research, HackerOne #3722 webhook impersonation). A compromised token would allow an attacker to post as any agent identity.

**Why per-agent tokens was rejected:**
- 50-60 agents would require 50-60 separate Slack apps, each needing a separate OAuth installation, admin approval, scope grant, and token rotation cycle
- Agents are ephemeral processes spawned by an orchestrator, not persistent services with stable identities
- Operational burden of managing 50+ app installations exceeds the security benefit for an internal tool

**Why the single-token approach is acceptable here:**
- Agent display names are clearly non-human (e.g., "[AI] Architect :building_construction:") and cannot be confused with real workspace members
- All messages share a visible `bot_id` in the API — a Slack admin can trivially verify all messages originate from one app
- `chat:write.customize` only changes cosmetic display; the underlying app attribution is unchanged
- The threat model assumes internal infrastructure control — an attacker with access to the bot token already has access to the deployment environment

**Mitigations:**
- Agent display names MUST include an `[AI]` prefix or similar marker to prevent any confusion with human users
- The Slack app MUST be named descriptively (e.g., "DevTeam AI Agents") so app attribution in Slack's UI is transparent
- For deployments requiring stronger identity assurance, the orchestrator should inject `agent_id` and the MCP server can validate it against a per-context allow-list
- Token should be stored in a secrets manager, not in plaintext config files
- Rotate the bot token on a regular schedule

### 8.8 Non-Marketplace Rate Limit Restrictions

**Risk:** As of May 2025, Slack imposes severely reduced rate limits on non-Marketplace commercial apps. `conversations.history` drops from Tier 3 (~50 req/min) to Tier 1 (1 req/min, max 15 objects). This would make the fork nearly unusable.

**Mitigation:** The fork MUST be deployed as an **internal custom app**, which is exempt from these restrictions. The setup guide must explicitly warn against configuring it as a commercial/public app. Add a startup check that logs a warning if the app is detected as non-internal (though Slack doesn't expose this directly via API — the check would rely on documentation and naming convention).

### 8.9 Legacy App Deadline (November 2026)

**Risk:** Slack is discontinuing classic apps entirely in November 2026. Legacy custom bots were already discontinued in March 2025.

**Mitigation:** The fork is based on modern Slack app architecture (OAuth 2.0 v2, granular scopes, bot tokens). No migration needed — but this must be verified during setup. If an existing workspace has a legacy app, it must be recreated as a modern app before November 2026.

---

## Appendix A: SlackClient Method Additions

> **Note:** All methods propagate the HTTP `Retry-After` header as `_retryAfter` on the parsed JSON response. This allows the rate limiter's `processQueue` to read the actual header value when handling 429/ratelimited responses (see §4.2).

```typescript
// Channel management
async createChannel(name: string, isPrivate: boolean): Promise<SlackResponse> {
  return this.rateLimiter.enqueue('conversations.create', async () => {
    const response = await fetch("https://slack.com/api/conversations.create", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ name, is_private: isPrivate }),
    });
    const json = await response.json();
    json._retryAfter = response.headers.get('retry-after');
    return json;
  });
}

async archiveChannel(channelId: string): Promise<SlackResponse> {
  return this.rateLimiter.enqueue('conversations.archive', async () => {
    const response = await fetch("https://slack.com/api/conversations.archive", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channelId }),
    });
    const json = await response.json();
    json._retryAfter = response.headers.get('retry-after');
    return json;
  });
}

async setChannelTopic(channelId: string, topic: string): Promise<SlackResponse> {
  return this.rateLimiter.enqueue('conversations.setTopic', async () => {
    const response = await fetch("https://slack.com/api/conversations.setTopic", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channelId, topic }),
    });
    const json = await response.json();
    json._retryAfter = response.headers.get('retry-after');
    return json;
  });
}

async setChannelPurpose(channelId: string, purpose: string): Promise<SlackResponse> {
  return this.rateLimiter.enqueue('conversations.setPurpose', async () => {
    const response = await fetch("https://slack.com/api/conversations.setPurpose", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channelId, purpose }),
    });
    const json = await response.json();
    json._retryAfter = response.headers.get('retry-after');
    return json;
  });
}

// Message update
async updateMessage(opts: {
  channel_id: string;
  timestamp: string;
  text: string;
  blocks?: unknown[];
  metadata?: { event_type: string; event_payload: Record<string, unknown> };
}): Promise<SlackResponse> {
  const body: Record<string, unknown> = {
    channel: opts.channel_id,
    ts: opts.timestamp,
    text: opts.text,
  };

  if (opts.blocks) body.blocks = opts.blocks;
  if (opts.metadata) body.metadata = opts.metadata;

  return this.rateLimiter.enqueue('chat.update', async () => {
    const response = await fetch("https://slack.com/api/chat.update", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify(body),
    });
    const json = await response.json();
    json._retryAfter = response.headers.get('retry-after');
    return json;
  });
}

// Reactions
async removeReaction(channelId: string, timestamp: string, reaction: string): Promise<SlackResponse> {
  return this.rateLimiter.enqueue('reactions.remove', async () => {
    const response = await fetch("https://slack.com/api/reactions.remove", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channelId, timestamp, name: reaction }),
    });
    const json = await response.json();
    json._retryAfter = response.headers.get('retry-after');
    return json;
  });
}

// Pins
async pinMessage(channelId: string, timestamp: string): Promise<SlackResponse> {
  return this.rateLimiter.enqueue('pins.add', async () => {
    const response = await fetch("https://slack.com/api/pins.add", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channelId, timestamp }),
    });
    const json = await response.json();
    json._retryAfter = response.headers.get('retry-after');
    return json;
  });
}

async unpinMessage(channelId: string, timestamp: string): Promise<SlackResponse> {
  return this.rateLimiter.enqueue('pins.remove', async () => {
    const response = await fetch("https://slack.com/api/pins.remove", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channelId, timestamp }),
    });
    const json = await response.json();
    json._retryAfter = response.headers.get('retry-after');
    return json;
  });
}

// Search (requires user token)
async searchMessages(
  query: string,
  sort: string = 'timestamp',
  sortDir: string = 'desc',
  count: number = 20,
): Promise<SlackResponse> {
  if (!this.userHeaders) {
    return { ok: false, error: 'search requires SLACK_USER_TOKEN to be configured' } as any;
  }
  const params = new URLSearchParams({
    query,
    sort,
    sort_dir: sortDir,
    count: count.toString(),
  });
  return this.rateLimiter.enqueue('search.messages', async () => {
    const response = await fetch(
      `https://slack.com/api/search.messages?${params}`,
      { headers: this.userHeaders! },
    );
    const json = await response.json();
    json._retryAfter = response.headers.get('retry-after');
    return json;
  });
}
```

## Appendix B: Type Definitions

```typescript
interface SlackResponse {
  ok: boolean;
  error?: string;
  channel?: {
    id: string;
    name: string;
    [key: string]: unknown;
  };
  message?: {
    ts: string;
    text: string;
    username?: string;
    icons?: { emoji?: string; image_48?: string };
    thread_ts?: string;
    [key: string]: unknown;
  };
  ts?: string;
  messages?: SlackMessage[];
  [key: string]: unknown;
}

interface UpdateMessageOptions {
  channel_id: string;
  timestamp: string;
  text: string;
  blocks?: unknown[];
  metadata?: {
    event_type: string;
    event_payload: Record<string, unknown>;
  };
}

interface SlackMessage {
  type: string;
  ts: string;
  text: string;
  user?: string;
  username?: string;
  thread_ts?: string;
  reply_count?: number;
  icons?: { emoji?: string; image_48?: string };
  metadata?: {
    event_type: string;
    event_payload: Record<string, unknown>;
  };
}
```

## Appendix C: Migration from Official Server

For users currently running `@modelcontextprotocol/server-slack` or `@zencoderai/slack-mcp-server`:

1. **Update Slack App scopes** — Add the new scopes listed in §2.1 to your app at api.slack.com/apps, then reinstall to workspace
2. **Replace MCP server path** — Update your `settings.local.json` or `.mcp.json` to point to the fork's `dist/index.js`
3. **Add agent config** — Create `agent-identities.json` and set `SLACK_AGENT_CONFIG_PATH`
4. **Optional: Add user token** — If search is needed, configure `SLACK_USER_TOKEN`
5. **Test** — Verify identity override works by posting a test message with `username` parameter

All existing tools remain backward-compatible. The new `username`, `icon_emoji`, and `icon_url` parameters on `slack_post_message` and `slack_reply_to_thread` are optional. Existing tool calls without these parameters work exactly as before.
