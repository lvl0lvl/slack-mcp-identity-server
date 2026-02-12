import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlackClient } from "../slack-client.js";
import { resolveIdentity } from "../identity.js";
import type { AgentConfig, UpdateMessageOptions } from "../types.js";

export function registerMessageTools(
  server: McpServer,
  client: SlackClient,
  config: AgentConfig | null = null,
  userToken?: string,
): void {
  server.registerTool(
    "slack_post_message",
    {
      title: "Post Slack Message",
      description: "Post a message to a Slack channel with optional agent identity override",
      inputSchema: {
        channel_id: z.string().describe("Channel ID to post to"),
        text: z.string().describe("Message text (supports mrkdwn)"),
        agent_id: z.string().optional().describe("Agent ID from identity config (e.g. 'architect', 'qa-engineer')"),
        username: z.string().optional().describe("Display name override (requires chat:write.customize)"),
        icon_emoji: z.string().optional().describe("Emoji icon override, e.g. ':robot_face:'"),
        icon_url: z.string().optional().describe("URL to image for icon override"),
        priority: z.number().optional().default(2).describe("Message priority for rate limit queue: 0=urgent, 1=decision, 2=normal, 3=background"),
      },
    },
    async ({ channel_id, text, agent_id, username, icon_emoji, icon_url, priority }) => {
      const identity = resolveIdentity({ agent_id, username, icon_emoji, icon_url }, config);

      const response = await client.postMessage({
        channel_id,
        text,
        ...(identity !== null && {
          username: identity.username,
          icon_emoji: identity.icon_emoji,
          icon_url: identity.icon_url,
        }),
      }, priority);

      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  server.registerTool(
    "slack_reply_to_thread",
    {
      title: "Reply to Slack Thread",
      description: "Reply to a specific message thread in Slack with optional agent identity override",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel containing the thread"),
        thread_ts: z.string().describe("The timestamp of the parent message in the format '1234567890.123456'. Timestamps in the format without the period can be converted by adding the period such that 6 numbers come after it."),
        text: z.string().describe("The reply text"),
        agent_id: z.string().optional().describe("Agent ID from identity config (e.g. 'architect', 'qa-engineer')"),
        username: z.string().optional().describe("Display name override (requires chat:write.customize)"),
        icon_emoji: z.string().optional().describe("Emoji icon override, e.g. ':robot_face:'"),
        icon_url: z.string().optional().describe("URL to image for icon override"),
        priority: z.number().optional().default(2).describe("Message priority for rate limit queue: 0=urgent, 1=decision, 2=normal, 3=background"),
      },
    },
    async ({ channel_id, thread_ts, text, agent_id, username, icon_emoji, icon_url, priority }) => {
      const identity = resolveIdentity({ agent_id, username, icon_emoji, icon_url }, config);

      const response = await client.postReply(
        channel_id,
        thread_ts,
        text,
        identity?.username,
        identity?.icon_emoji,
        identity?.icon_url,
        priority,
      );

      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  server.registerTool(
    "slack_get_channel_history",
    {
      title: "Get Slack Channel History",
      description: "Get recent messages from a channel",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel"),
        limit: z.number().optional().default(10).describe("Number of messages to retrieve (default 10)"),
      },
    },
    async ({ channel_id, limit }) => {
      const response = await client.getChannelHistory(channel_id, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  server.registerTool(
    "slack_get_thread_replies",
    {
      title: "Get Slack Thread Replies",
      description: "Get all replies in a message thread",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel containing the thread"),
        thread_ts: z.string().describe("The timestamp of the parent message in the format '1234567890.123456'. Timestamps in the format without the period can be converted by adding the period such that 6 numbers come after it."),
      },
    },
    async ({ channel_id, thread_ts }) => {
      const response = await client.getThreadReplies(channel_id, thread_ts);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  server.registerTool(
    "slack_update_message",
    {
      title: "Update Slack Message",
      description: "Edit an existing message",
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

      const response = await client.updateMessage({
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
      const response = await client.searchMessages(query, sort, sort_dir, Math.min(count, 100), userToken);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );
}
