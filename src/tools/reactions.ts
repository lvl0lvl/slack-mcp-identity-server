import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlackClient } from "../slack-client.js";

export function registerReactionTools(server: McpServer, client: SlackClient): void {
  server.registerTool(
    "slack_add_reaction",
    {
      title: "Add Slack Reaction",
      description: "Add a reaction emoji to a message",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel containing the message"),
        timestamp: z.string().describe("The timestamp of the message to react to"),
        reaction: z.string().describe("The name of the emoji reaction (without ::)"),
      },
    },
    async ({ channel_id, timestamp, reaction }) => {
      const response = await client.addReaction(channel_id, timestamp, reaction);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );
}
