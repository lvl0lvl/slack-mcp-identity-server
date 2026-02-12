import { appendFileSync } from "node:fs";

export interface MessageLogEntry {
  timestamp: string;
  channel: string;
  username?: string;
  icon_emoji?: string;
  text: string;
  thread_ts?: string;
  slack_ts?: string;
  delivered: boolean;
  error?: string;
}

export class MessageLogger {
  private logPath: string | undefined;

  constructor(logPath?: string) {
    this.logPath = logPath || undefined;
  }

  log(entry: MessageLogEntry): void {
    if (!this.logPath) return;

    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
    } catch (err) {
      console.error(
        `Warning: Failed to write message log to ${this.logPath}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
