import { describe, it, expect, vi, beforeEach } from "vitest";
import { appendFileSync } from "node:fs";
import { MessageLogger, type MessageLogEntry } from "../../src/message-logger.js";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockAppend = vi.mocked(appendFileSync);

function sampleEntry(overrides: Partial<MessageLogEntry> = {}): MessageLogEntry {
  return {
    timestamp: "2026-02-12T18:00:00.000Z",
    channel: "C123",
    text: "Hello world",
    delivered: true,
    ...overrides,
  };
}

describe("MessageLogger", () => {
  beforeEach(() => {
    mockAppend.mockReset();
    vi.restoreAllMocks();
  });

  it("does not call appendFileSync when constructed with no path", () => {
    const logger = new MessageLogger();
    logger.log(sampleEntry());
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("does not call appendFileSync when constructed with empty string", () => {
    const logger = new MessageLogger("");
    logger.log(sampleEntry());
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("writes JSONL to the specified path", () => {
    const logger = new MessageLogger("/tmp/test.jsonl");
    const entry = sampleEntry();
    logger.log(entry);
    expect(mockAppend).toHaveBeenCalledOnce();
    expect(mockAppend).toHaveBeenCalledWith(
      "/tmp/test.jsonl",
      JSON.stringify(entry) + "\n",
    );
  });

  it("writes valid JSON per line", () => {
    const logger = new MessageLogger("/tmp/test.jsonl");
    logger.log(sampleEntry());
    const written = mockAppend.mock.calls[0][1] as string;
    const parsed = JSON.parse(written.trim());
    expect(parsed.timestamp).toBe("2026-02-12T18:00:00.000Z");
    expect(parsed.channel).toBe("C123");
    expect(parsed.text).toBe("Hello world");
    expect(parsed.delivered).toBe(true);
  });

  it("does not throw on write failure and logs warning", () => {
    mockAppend.mockImplementation(() => {
      throw new Error("disk full");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new MessageLogger("/tmp/test.jsonl");

    expect(() => logger.log(sampleEntry())).not.toThrow();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toContain("Failed to write message log");
  });

  it("includes identity fields in log entry", () => {
    const logger = new MessageLogger("/tmp/test.jsonl");
    logger.log(sampleEntry({ username: "[AI] Architect", icon_emoji: ":building_construction:" }));
    const written = mockAppend.mock.calls[0][1] as string;
    const parsed = JSON.parse(written.trim());
    expect(parsed.username).toBe("[AI] Architect");
    expect(parsed.icon_emoji).toBe(":building_construction:");
  });

  it("records delivery success with slack_ts", () => {
    const logger = new MessageLogger("/tmp/test.jsonl");
    logger.log(sampleEntry({ delivered: true, slack_ts: "1707764400.000100" }));
    const parsed = JSON.parse((mockAppend.mock.calls[0][1] as string).trim());
    expect(parsed.delivered).toBe(true);
    expect(parsed.slack_ts).toBe("1707764400.000100");
    expect(parsed.error).toBeUndefined();
  });

  it("records delivery failure with error", () => {
    const logger = new MessageLogger("/tmp/test.jsonl");
    logger.log(sampleEntry({ delivered: false, error: "channel_not_found" }));
    const parsed = JSON.parse((mockAppend.mock.calls[0][1] as string).trim());
    expect(parsed.delivered).toBe(false);
    expect(parsed.error).toBe("channel_not_found");
  });
});
