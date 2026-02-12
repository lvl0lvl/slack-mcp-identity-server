import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlackRateLimiter } from "../../src/rate-limiter.js";

describe("SlackRateLimiter", () => {
  let limiter: SlackRateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new SlackRateLimiter();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("enqueue and execute a single request", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });

    const promise = limiter.enqueue("chat.postMessage", execute);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("enforces per-method limits by queuing excess requests", async () => {
    const results: number[] = [];

    // conversations.list has a limit of 20/min
    // Enqueue 21 requests — the 21st should be queued
    const promises: Promise<any>[] = [];
    for (let i = 0; i < 21; i++) {
      const idx = i;
      promises.push(
        limiter.enqueue("conversations.list", async () => {
          results.push(idx);
          return { ok: true, idx };
        }),
      );
    }

    // Process the first 20
    await vi.advanceTimersByTimeAsync(0);

    // First 20 should have executed
    expect(results.length).toBe(20);

    // Advance past the 60-second window + buffer so the 21st can execute
    await vi.advanceTimersByTimeAsync(61_000);

    expect(results.length).toBe(21);
    expect(results[20]).toBe(20);
  });

  it("dequeues priority 0 before priority 3", async () => {
    const order: string[] = [];

    // Fill the method limit so subsequent requests must be queued
    // Use a method with limit of 1 effective request to force queuing
    // We'll use conversations.list (20/min) but enqueue 20 first to fill it
    const fillerPromises: Promise<any>[] = [];
    for (let i = 0; i < 20; i++) {
      fillerPromises.push(
        limiter.enqueue("conversations.list", async () => {
          return { ok: true };
        }, 2),
      );
    }

    // Process fillers
    await vi.advanceTimersByTimeAsync(0);

    // Now the window is full. Enqueue priority 3 first, then priority 0.
    const p3 = limiter.enqueue("conversations.list", async () => {
      order.push("priority-3");
      return { ok: true };
    }, 3);

    const p0 = limiter.enqueue("conversations.list", async () => {
      order.push("priority-0");
      return { ok: true };
    }, 0);

    // Advance time past the window so queued items can execute
    await vi.advanceTimersByTimeAsync(61_000);

    await Promise.all([p3, p0]);

    // Priority 0 should have executed before priority 3
    expect(order[0]).toBe("priority-0");
    expect(order[1]).toBe("priority-3");
  });

  it("handles 429 ratelimited response by pausing and retrying", async () => {
    let callCount = 0;
    const execute = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, error: "ratelimited", _retryAfter: "5" };
      }
      return { ok: true, data: "success" };
    });

    const promise = limiter.enqueue("chat.postMessage", execute);
    await vi.advanceTimersByTimeAsync(0);

    // First call returned 429, should log and set retryAfter
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Rate limited on chat.postMessage"),
    );

    // Advance past the 5-second retry-after window
    await vi.advanceTimersByTimeAsync(6_000);

    const result = await promise;
    expect(result).toEqual({ ok: true, data: "success" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("logs queue delay warning when item waits > 10 seconds", async () => {
    // Fill the rate limit window
    const fillerPromises: Promise<any>[] = [];
    for (let i = 0; i < 20; i++) {
      fillerPromises.push(
        limiter.enqueue("conversations.list", async () => ({ ok: true })),
      );
    }
    await vi.advanceTimersByTimeAsync(0);

    // Enqueue one more — it will be delayed
    const delayed = limiter.enqueue("conversations.list", async () => ({ ok: true }));

    // Advance 15 seconds — not enough for window expiry but enough for delay warning
    await vi.advanceTimersByTimeAsync(15_000);

    // Advance past window
    await vi.advanceTimersByTimeAsync(50_000);
    await delayed;

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Queue delay warning"),
    );
  });

  it("re-enqueues 429 request at front of queue", async () => {
    const order: string[] = [];
    let firstCall = true;

    const rateLimitedExecute = vi.fn().mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        return { ok: false, error: "ratelimited", _retryAfter: "1" };
      }
      order.push("retried");
      return { ok: true };
    });

    const normalExecute = vi.fn().mockImplementation(async () => {
      order.push("normal");
      return { ok: true };
    });

    const p1 = limiter.enqueue("chat.postMessage", rateLimitedExecute);
    const p2 = limiter.enqueue("chat.postMessage", normalExecute);

    await vi.advanceTimersByTimeAsync(0);

    // Advance past retry-after
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.all([p1, p2]);

    // The retried request should execute before the normal one
    expect(order[0]).toBe("retried");
    expect(order[1]).toBe("normal");
  });
});
