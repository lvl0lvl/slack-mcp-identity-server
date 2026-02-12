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

describe("SlackClient", () => {
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

  it("authTest calls auth.test endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, user: "testbot", team: "TestTeam" }),
    );

    const result = await client.authTest();

    expect(result).toEqual({ ok: true, user: "testbot", team: "TestTeam" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/auth.test",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer xoxb-test-token",
          "Content-Type": "application/json",
        },
      },
    );
  });

  it("authTest returns error on invalid token", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: false, error: "invalid_auth" }),
    );

    const result = await client.authTest();

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_auth");
  });

  it("getChannels without SLACK_CHANNEL_IDS calls conversations.list", async () => {
    delete process.env.SLACK_CHANNEL_IDS;
    const body = {
      ok: true,
      channels: [{ id: "C123", name: "general" }],
      response_metadata: { next_cursor: "" },
    };

    mockFetch.mockResolvedValueOnce(mockResponse(body));

    const result = await client.getChannels();

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://slack.com/api/conversations.list"),
      expect.objectContaining({
        headers: {
          Authorization: "Bearer xoxb-test-token",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("getChannels with SLACK_CHANNEL_IDS calls conversations.info per channel", async () => {
    process.env.SLACK_CHANNEL_IDS = "C123,C456";

    mockFetch
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          channel: { id: "C123", name: "general", is_archived: false },
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          channel: { id: "C456", name: "random", is_archived: false },
        }),
      );

    const result = await client.getChannels();

    expect(result).toEqual({
      ok: true,
      channels: [
        { id: "C123", name: "general", is_archived: false },
        { id: "C456", name: "random", is_archived: false },
      ],
      response_metadata: { next_cursor: "" },
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("postMessage sends correct body with options object", async () => {
    const body = { ok: true, ts: "1234567890.123456" };
    mockFetch.mockResolvedValueOnce(mockResponse(body));

    const result = await client.postMessage({ channel_id: "C123", text: "Hello" });

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer xoxb-test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: "C123", text: "Hello" }),
      },
    );
  });

  it("postMessage includes identity fields when provided", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, ts: "123" }),
    );

    await client.postMessage({
      channel_id: "C123",
      text: "Hello",
      username: "Agent Alpha",
      icon_emoji: ":star:",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.username).toBe("Agent Alpha");
    expect(body.icon_emoji).toBe(":star:");
  });

  it("postMessage omits identity fields when not provided", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, ts: "123" }),
    );

    await client.postMessage({ channel_id: "C123", text: "Hello" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("username");
    expect(body).not.toHaveProperty("icon_emoji");
    expect(body).not.toHaveProperty("icon_url");
  });

  it("postReply delegates to postMessage with thread_ts", async () => {
    const body = { ok: true, ts: "1234567890.123457" };
    mockFetch.mockResolvedValueOnce(mockResponse(body));

    const result = await client.postReply("C123", "1234567890.123456", "Reply");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer xoxb-test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: "C123",
          text: "Reply",
          thread_ts: "1234567890.123456",
        }),
      },
    );
  });

  it("addReaction sends correct body", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

    const result = await client.addReaction("C123", "1234567890.123456", "thumbsup");

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/reactions.add",
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

  it("getChannelHistory calls correct URL", async () => {
    const body = { ok: true, messages: [{ text: "Hi", ts: "123" }] };
    mockFetch.mockResolvedValueOnce(mockResponse(body));

    const result = await client.getChannelHistory("C123", 5);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://slack.com/api/conversations.history"),
      expect.objectContaining({
        headers: {
          Authorization: "Bearer xoxb-test-token",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("getThreadReplies calls correct URL", async () => {
    const body = {
      ok: true,
      messages: [
        { text: "Parent", ts: "1234567890.123456" },
        { text: "Reply", ts: "1234567890.123457", thread_ts: "1234567890.123456" },
      ],
    };
    mockFetch.mockResolvedValueOnce(mockResponse(body));

    const result = await client.getThreadReplies("C123", "1234567890.123456");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://slack.com/api/conversations.replies"),
      expect.objectContaining({
        headers: {
          Authorization: "Bearer xoxb-test-token",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("getUsers calls correct URL", async () => {
    const body = {
      ok: true,
      members: [{ id: "U123", name: "testuser" }],
    };
    mockFetch.mockResolvedValueOnce(mockResponse(body));

    const result = await client.getUsers(100);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://slack.com/api/users.list"),
      expect.objectContaining({
        headers: {
          Authorization: "Bearer xoxb-test-token",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("getUserProfile calls correct URL", async () => {
    const body = {
      ok: true,
      profile: { real_name: "Test User", email: "test@example.com" },
    };
    mockFetch.mockResolvedValueOnce(mockResponse(body));

    const result = await client.getUserProfile("U123");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://slack.com/api/users.profile.get"),
      expect.objectContaining({
        headers: {
          Authorization: "Bearer xoxb-test-token",
          "Content-Type": "application/json",
        },
      }),
    );
  });
});
