import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlackClient } from "../slack-client.js";

export function registerChannelTools(server: McpServer, client: SlackClient): void {
  server.registerTool(
    "slack_list_channels",
    {
      title: "List Slack Channels",
      description: "List public and private channels that the bot is a member of, or pre-defined channels in the workspace with pagination",
      inputSchema: {
        limit: z.number().optional().default(100).describe("Maximum number of channels to return (default 100, max 200)"),
        cursor: z.string().optional().describe("Pagination cursor for next page of results"),
      },
    },
    async ({ limit, cursor }) => {
      const response = await client.getChannels(limit, cursor);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

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
      const createResponse = await client.createChannel(name, is_private);
      if (createResponse.ok && description && createResponse.channel?.id) {
        await client.setChannelPurpose(createResponse.channel.id, description);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(createResponse) }],
      };
    }
  );

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
      const response = await client.archiveChannel(channel_id);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

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
      const response = await client.setChannelTopic(channel_id, topic);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

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
      const response = await client.setChannelPurpose(channel_id, purpose);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );
}
