import type { PostMessageOptions, UpdateMessageOptions } from "./types.js";
import { SlackRateLimiter } from "./rate-limiter.js";
import { fetchWithRetry } from "./network.js";
import { MessageLogger } from "./message-logger.js";

export class SlackClient {
  private botHeaders: { Authorization: string; "Content-Type": string };
  private rateLimiter: SlackRateLimiter;
  private logger: MessageLogger;

  constructor(botToken: string, logger?: MessageLogger) {
    this.botHeaders = {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    };
    this.rateLimiter = new SlackRateLimiter();
    this.logger = logger ?? new MessageLogger();
  }

  private async apiCall(
    method: string,
    url: string,
    options: RequestInit,
    priority?: number,
  ): Promise<any> {
    return this.rateLimiter.enqueue(
      method,
      async () => {
        const response = await fetchWithRetry(url, options);
        const result = await response.json();
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
          result._retryAfter = retryAfter;
        }
        return result;
      },
      priority,
    );
  }

  async authTest(): Promise<any> {
    return this.apiCall("auth.test", "https://slack.com/api/auth.test", {
      method: "POST",
      headers: this.botHeaders,
    });
  }

  async getChannels(limit: number = 100, cursor?: string): Promise<any> {
    const predefinedChannelIds = process.env.SLACK_CHANNEL_IDS;
    if (!predefinedChannelIds) {
      const params = new URLSearchParams({
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: Math.min(limit, 200).toString(),
        team_id: process.env.SLACK_TEAM_ID!,
      });

      if (cursor) {
        params.append("cursor", cursor);
      }

      return this.apiCall(
        "conversations.list",
        `https://slack.com/api/conversations.list?${params}`,
        { headers: this.botHeaders },
      );
    }

    const predefinedChannelIdsArray = predefinedChannelIds.split(",").map((id: string) => id.trim());
    const channels = [];

    for (const channelId of predefinedChannelIdsArray) {
      const params = new URLSearchParams({
        channel: channelId,
      });

      const data = await this.apiCall(
        "conversations.info",
        `https://slack.com/api/conversations.info?${params}`,
        { headers: this.botHeaders },
      );

      if (data.ok && data.channel && !data.channel.is_archived) {
        channels.push(data.channel);
      }
    }

    return {
      ok: true,
      channels,
      response_metadata: { next_cursor: "" },
    };
  }

  async postMessage(opts: PostMessageOptions, priority?: number): Promise<any> {
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

    const result = await this.apiCall(
      "chat.postMessage",
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: this.botHeaders,
        body: JSON.stringify(body),
      },
      priority,
    );

    this.logger.log({
      timestamp: new Date().toISOString(),
      channel: opts.channel_id,
      username: opts.username,
      icon_emoji: opts.icon_emoji,
      text: opts.text,
      thread_ts: opts.thread_ts,
      slack_ts: result.ts,
      delivered: result.ok === true,
      error: result.ok ? undefined : result.error,
    });

    return result;
  }

  async postReply(
    channel_id: string,
    thread_ts: string,
    text: string,
    username?: string,
    icon_emoji?: string,
    icon_url?: string,
    priority?: number,
  ): Promise<any> {
    return this.postMessage({
      channel_id,
      text,
      thread_ts,
      username,
      icon_emoji,
      icon_url,
    }, priority);
  }

  async addReaction(
    channel_id: string,
    timestamp: string,
    reaction: string,
  ): Promise<any> {
    return this.apiCall(
      "reactions.add",
      "https://slack.com/api/reactions.add",
      {
        method: "POST",
        headers: this.botHeaders,
        body: JSON.stringify({
          channel: channel_id,
          timestamp,
          name: reaction,
        }),
      },
    );
  }

  async getChannelHistory(
    channel_id: string,
    limit: number = 10,
  ): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      limit: limit.toString(),
    });

    return this.apiCall(
      "conversations.history",
      `https://slack.com/api/conversations.history?${params}`,
      { headers: this.botHeaders },
    );
  }

  async getThreadReplies(channel_id: string, thread_ts: string): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      ts: thread_ts,
    });

    return this.apiCall(
      "conversations.replies",
      `https://slack.com/api/conversations.replies?${params}`,
      { headers: this.botHeaders },
    );
  }

  async getUsers(limit: number = 100, cursor?: string): Promise<any> {
    const params = new URLSearchParams({
      limit: Math.min(limit, 200).toString(),
      team_id: process.env.SLACK_TEAM_ID!,
    });

    if (cursor) {
      params.append("cursor", cursor);
    }

    return this.apiCall(
      "users.list",
      `https://slack.com/api/users.list?${params}`,
      { headers: this.botHeaders },
    );
  }

  async getUserProfile(user_id: string): Promise<any> {
    const params = new URLSearchParams({
      user: user_id,
      include_labels: "true",
    });

    return this.apiCall(
      "users.profile.get",
      `https://slack.com/api/users.profile.get?${params}`,
      { headers: this.botHeaders },
    );
  }

  async updateMessage(opts: UpdateMessageOptions): Promise<any> {
    const body: Record<string, unknown> = {
      channel: opts.channel_id,
      ts: opts.timestamp,
      text: opts.text,
    };

    if (opts.blocks) body.blocks = opts.blocks;
    if (opts.metadata) body.metadata = opts.metadata;

    return this.apiCall(
      "chat.update",
      "https://slack.com/api/chat.update",
      {
        method: "POST",
        headers: this.botHeaders,
        body: JSON.stringify(body),
      },
    );
  }

  async createChannel(name: string, isPrivate: boolean = false): Promise<any> {
    return this.apiCall(
      "conversations.create",
      "https://slack.com/api/conversations.create",
      {
        method: "POST",
        headers: this.botHeaders,
        body: JSON.stringify({
          name,
          is_private: isPrivate,
          team_id: process.env.SLACK_TEAM_ID!,
        }),
      },
    );
  }

  async archiveChannel(channel_id: string): Promise<any> {
    return this.apiCall(
      "conversations.archive",
      "https://slack.com/api/conversations.archive",
      {
        method: "POST",
        headers: this.botHeaders,
        body: JSON.stringify({ channel: channel_id }),
      },
    );
  }

  async setChannelTopic(channel_id: string, topic: string): Promise<any> {
    return this.apiCall(
      "conversations.setTopic",
      "https://slack.com/api/conversations.setTopic",
      {
        method: "POST",
        headers: this.botHeaders,
        body: JSON.stringify({ channel: channel_id, topic }),
      },
    );
  }

  async setChannelPurpose(channel_id: string, purpose: string): Promise<any> {
    return this.apiCall(
      "conversations.setPurpose",
      "https://slack.com/api/conversations.setPurpose",
      {
        method: "POST",
        headers: this.botHeaders,
        body: JSON.stringify({ channel: channel_id, purpose }),
      },
    );
  }

  async removeReaction(
    channel_id: string,
    timestamp: string,
    reaction: string,
  ): Promise<any> {
    return this.apiCall(
      "reactions.remove",
      "https://slack.com/api/reactions.remove",
      {
        method: "POST",
        headers: this.botHeaders,
        body: JSON.stringify({
          channel: channel_id,
          timestamp,
          name: reaction,
        }),
      },
    );
  }

  async pinMessage(channel_id: string, timestamp: string): Promise<any> {
    return this.apiCall(
      "pins.add",
      "https://slack.com/api/pins.add",
      {
        method: "POST",
        headers: this.botHeaders,
        body: JSON.stringify({
          channel: channel_id,
          timestamp,
        }),
      },
    );
  }

  async unpinMessage(channel_id: string, timestamp: string): Promise<any> {
    return this.apiCall(
      "pins.remove",
      "https://slack.com/api/pins.remove",
      {
        method: "POST",
        headers: this.botHeaders,
        body: JSON.stringify({
          channel: channel_id,
          timestamp,
        }),
      },
    );
  }

  async searchMessages(
    query: string,
    sort: string = "timestamp",
    sort_dir: string = "desc",
    count: number = 20,
    userToken?: string,
  ): Promise<any> {
    if (!userToken) {
      return {
        ok: false,
        error: "user_token_required",
        message: "slack_search_messages requires SLACK_USER_TOKEN to be configured. The search.messages API only works with user tokens (xoxp-), not bot tokens.",
      };
    }

    const params = new URLSearchParams({
      query,
      sort,
      sort_dir,
      count: Math.min(count, 100).toString(),
    });

    return this.apiCall(
      "search.messages",
      `https://slack.com/api/search.messages?${params}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
      },
    );
  }
}
