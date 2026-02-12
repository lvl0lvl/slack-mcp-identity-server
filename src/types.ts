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
