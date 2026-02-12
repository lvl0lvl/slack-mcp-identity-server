import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlackClient } from "../../src/slack-client.js";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

function mockResponse(body: any, headers: Record<string, string> = {}) {
  return {
    json: () => Promise.resolve(body),
    status: 200,
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
  };
}

describe("Phase 4 new tools — SlackClient methods", () => {
  let client: SlackClient;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    client = new SlackClient("xoxb-test-token");
    process.env.SLACK_TEAM_ID = "T123456";
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("updateMessage", () => {
    it("constructs correct chat.update body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, ts: "123" }));

      await client.updateMessage({
        channel_id: "C123",
        timestamp: "1234567890.123456",
        text: "Updated text",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/chat.update",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer xoxb-test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: "C123",
            ts: "1234567890.123456",
            text: "Updated text",
          }),
        },
      );
    });

    it("includes blocks and metadata when provided", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, ts: "123" }));

      await client.updateMessage({
        channel_id: "C123",
        timestamp: "1234567890.123456",
        text: "Updated",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "hi" } }],
        metadata: { event_type: "test", event_payload: { key: "val" } },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.blocks).toEqual([{ type: "section", text: { type: "mrkdwn", text: "hi" } }]);
      expect(body.metadata).toEqual({ event_type: "test", event_payload: { key: "val" } });
    });
  });

  describe("createChannel", () => {
    it("constructs correct conversations.create body", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, channel: { id: "C999", name: "new-channel" } }),
      );

      await client.createChannel("new-channel", false);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/conversations.create",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer xoxb-test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "new-channel",
            is_private: false,
            team_id: "T123456",
          }),
        },
      );
    });

    it("works regardless of SLACK_CHANNEL_IDS setting", async () => {
      process.env.SLACK_CHANNEL_IDS = "C111,C222";
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, channel: { id: "C999", name: "test" } }),
      );

      const result = await client.createChannel("test", true);

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/conversations.create",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "test",
            is_private: true,
            team_id: "T123456",
          }),
        }),
      );
    });
  });

  describe("archiveChannel", () => {
    it("constructs correct conversations.archive body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

      await client.archiveChannel("C123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/conversations.archive",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer xoxb-test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel: "C123" }),
        },
      );
    });
  });

  describe("setChannelTopic", () => {
    it("constructs correct conversations.setTopic body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

      await client.setChannelTopic("C123", "New topic");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/conversations.setTopic",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer xoxb-test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel: "C123", topic: "New topic" }),
        },
      );
    });
  });

  describe("setChannelPurpose", () => {
    it("constructs correct conversations.setPurpose body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

      await client.setChannelPurpose("C123", "Channel purpose");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/conversations.setPurpose",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer xoxb-test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel: "C123", purpose: "Channel purpose" }),
        },
      );
    });
  });

  describe("removeReaction", () => {
    it("constructs correct reactions.remove body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

      await client.removeReaction("C123", "1234567890.123456", "thumbsup");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/reactions.remove",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer xoxb-test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: "C123",
            timestamp: "1234567890.123456",
            name: "thumbsup",
          }),
        },
      );
    });
  });

  describe("pinMessage", () => {
    it("constructs correct pins.add body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

      await client.pinMessage("C123", "1234567890.123456");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/pins.add",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer xoxb-test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: "C123",
            timestamp: "1234567890.123456",
          }),
        },
      );
    });
  });

  describe("unpinMessage", () => {
    it("constructs correct pins.remove body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

      await client.unpinMessage("C123", "1234567890.123456");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/pins.remove",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer xoxb-test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: "C123",
            timestamp: "1234567890.123456",
          }),
        },
      );
    });
  });

  describe("searchMessages", () => {
    it("returns error when no user token provided", async () => {
      const result = await client.searchMessages("test query");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("user_token_required");
      expect(result.message).toContain("SLACK_USER_TOKEN");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("includes sort and sort_dir in API call", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, messages: { matches: [] } }),
      );

      await client.searchMessages("test query", "score", "asc", 50, "xoxp-user-token");

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("sort=score");
      expect(url).toContain("sort_dir=asc");
      expect(url).toContain("count=50");
      expect(url).toContain("query=test+query");
    });

    it("uses user token in Authorization header", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, messages: { matches: [] } }),
      );

      await client.searchMessages("query", "timestamp", "desc", 20, "xoxp-user-token");

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer xoxp-user-token");
    });

    it("caps count at 100", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, messages: { matches: [] } }),
      );

      await client.searchMessages("query", "timestamp", "desc", 200, "xoxp-user-token");

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("count=100");
    });
  });
});
