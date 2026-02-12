export interface ListChannelsArgs {
  limit?: number;
  cursor?: string;
}

export interface PostMessageArgs {
  channel_id: string;
  text: string;
}

export interface ReplyToThreadArgs {
  channel_id: string;
  thread_ts: string;
  text: string;
}

export interface AddReactionArgs {
  channel_id: string;
  timestamp: string;
  reaction: string;
}

export interface GetChannelHistoryArgs {
  channel_id: string;
  limit?: number;
}

export interface GetThreadRepliesArgs {
  channel_id: string;
  thread_ts: string;
}

export interface GetUsersArgs {
  cursor?: string;
  limit?: number;
}

export interface GetUserProfileArgs {
  user_id: string;
}

export interface AgentIdentity {
  username: string;
  icon_emoji?: string;
  icon_url?: string;
  color?: string;
  role?: string;
}

export interface AgentConfig {
  version: string;
  defaultIdentity: AgentIdentity;
  agents: Record<string, AgentIdentity>;
}

export interface PostMessageOptions {
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
