import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlackClient } from "../slack-client.js";
import { resolveIdentity } from "../identity.js";
import type { AgentConfig } from "../types.js";

export function registerMessageTools(
  server: McpServer,
  client: SlackClient,
  config: AgentConfig | null = null,
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
      },
    },
    async ({ channel_id, text, agent_id, username, icon_emoji, icon_url }) => {
      const identity = resolveIdentity({ agent_id, username, icon_emoji, icon_url }, config);

      const response = await client.postMessage({
        channel_id,
        text,
        ...(identity !== null && {
          username: identity.username,
          icon_emoji: identity.icon_emoji,
          icon_url: identity.icon_url,
        }),
      });

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
      },
    },
    async ({ channel_id, thread_ts, text, agent_id, username, icon_emoji, icon_url }) => {
      const identity = resolveIdentity({ agent_id, username, icon_emoji, icon_url }, config);

      const response = await client.postReply(
        channel_id,
        thread_ts,
        text,
        identity?.username,
        identity?.icon_emoji,
        identity?.icon_url,
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
}
