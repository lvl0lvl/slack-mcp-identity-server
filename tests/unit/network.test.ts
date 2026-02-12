import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "../../src/network.js";

describe("fetchWithRetry", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = mockFetch as any;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  it("returns response on successful first attempt", async () => {
    const resp = {
      status: 200,
      json: () => Promise.resolve({ ok: true }),
      headers: { get: () => null },
    };
    mockFetch.mockResolvedValueOnce(resp);

    const result = await fetchWithRetry("https://slack.com/api/test", {});

    expect(result).toBe(resp);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("retries on 5xx and succeeds on second attempt", async () => {
    const failResp = {
      status: 500,
      headers: { get: () => null },
    };
    const successResp = {
      status: 200,
      json: () => Promise.resolve({ ok: true }),
      headers: { get: () => null },
    };
    mockFetch
      .mockResolvedValueOnce(failResp)
      .mockResolvedValueOnce(successResp);

    const promise = fetchWithRetry("https://slack.com/api/test", {}, 3);

    // Advance past the 1-second backoff for first retry
    await vi.advanceTimersByTimeAsync(1_500);

    const result = await promise;
    expect(result).toBe(successResp);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws after all retries exhausted on 5xx", async () => {
    const failResp = {
      status: 503,
      headers: { get: () => null },
    };
    mockFetch
      .mockResolvedValueOnce(failResp)
      .mockResolvedValueOnce(failResp)
      .mockResolvedValueOnce(failResp);

    const promise = fetchWithRetry("https://slack.com/api/test", {}, 3);

    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow("Slack API unavailable after 3 attempts");

    // Advance past all backoff delays: 1s + 2s + 4s = 7s
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
  });

  it("returns immediately on 4xx without retry", async () => {
    const resp = {
      status: 400,
      json: () => Promise.resolve({ ok: false, error: "invalid_arg" }),
      headers: { get: () => null },
    };
    mockFetch.mockResolvedValueOnce(resp);

    const result = await fetchWithRetry("https://slack.com/api/test", {}, 3);

    expect(result).toBe(resp);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("retries on network error (fetch throws)", async () => {
    const networkError = new Error("ECONNREFUSED");
    const successResp = {
      status: 200,
      json: () => Promise.resolve({ ok: true }),
      headers: { get: () => null },
    };

    mockFetch
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(successResp);

    const promise = fetchWithRetry("https://slack.com/api/test", {}, 3);

    // Advance past the 1-second backoff
    await vi.advanceTimersByTimeAsync(1_500);

    const result = await promise;
    expect(result).toBe(successResp);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Slack API unreachable"),
    );
  });
});
