interface QueuedRequest {
  method: string;
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  priority: number;
  enqueuedAt: number;
}

export class SlackRateLimiter {
  private methodWindows: Map<string, number[]> = new Map();
  private queue: QueuedRequest[] = [];
  private processing = false;
  private retryAfter: number = 0;

  /** Per-method rate limits (requests per minute). */
  private readonly METHOD_LIMITS: Record<string, number> = {
    'chat.postMessage': 300,
    'chat.update': 50,
    'conversations.list': 20,
    'conversations.info': 20,
    'conversations.create': 20,
    'conversations.history': 50,
    'conversations.replies': 50,
    'conversations.setTopic': 20,
    'conversations.setPurpose': 20,
    'conversations.archive': 20,
    'reactions.add': 20,
    'reactions.remove': 20,
    'search.messages': 20,
    'pins.add': 20,
    'pins.remove': 20,
    'users.list': 20,
    'users.profile.get': 100,
    'auth.test': 100,
  };

  async enqueue<T>(
    method: string,
    execute: () => Promise<T>,
    priority: number = 2,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        method,
        execute,
        resolve,
        reject,
        priority,
        enqueuedAt: Date.now(),
      });
      this.queue.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      if (this.retryAfter > Date.now()) {
        await this.sleep(this.retryAfter - Date.now());
      }

      const item = this.queue[0];

      // Log queue delay warning
      const waitTime = Date.now() - item.enqueuedAt;
      if (waitTime > 10_000) {
        console.error(
          `Queue delay warning: ${item.method} waited ${Math.ceil(waitTime / 1000)}s (queue depth: ${this.queue.length})`,
        );
      }

      const limit = this.METHOD_LIMITS[item.method];

      if (limit && !this.canProceed(item.method, limit)) {
        await this.sleep(this.getWaitTime(item.method));
        continue;
      }

      this.queue.shift();
      this.recordRequest(item.method);

      try {
        const result = await item.execute();

        if (result && !result.ok && result.error === 'ratelimited') {
          const retryAfterSec = parseInt(result._retryAfter, 10) || 1;
          this.retryAfter = Date.now() + (retryAfterSec * 1000);
          console.error(`Rate limited on ${item.method}, retrying after ${retryAfterSec}s`);
          this.queue.unshift(item);
          continue;
        }

        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
    }

    this.processing = false;
  }

  private canProceed(method: string, perMinute: number): boolean {
    const timestamps = this.methodWindows.get(method);
    if (!timestamps) return true;
    const windowStart = Date.now() - 60_000;
    return timestamps.filter(t => t > windowStart).length < perMinute;
  }

  private recordRequest(method: string): void {
    if (!this.methodWindows.has(method)) {
      this.methodWindows.set(method, []);
    }
    const timestamps = this.methodWindows.get(method)!;
    timestamps.push(Date.now());
    const cutoff = Date.now() - 60_000;
    this.methodWindows.set(method, timestamps.filter(t => t > cutoff));
  }

  private getWaitTime(method: string): number {
    const timestamps = this.methodWindows.get(method);
    if (!timestamps || timestamps.length === 0) return 0;
    const oldest = Math.min(...timestamps);
    return Math.max(0, oldest + 60_000 - Date.now() + 100);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
