import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlackClient } from "../slack-client.js";

export function registerPinTools(server: McpServer, client: SlackClient): void {
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
      const response = await client.pinMessage(channel_id, timestamp);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

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
      const response = await client.unpinMessage(channel_id, timestamp);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );
}
