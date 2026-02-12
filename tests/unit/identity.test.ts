import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadAgentConfig, resolveIdentity } from "../../src/identity.js";
import type { AgentConfig } from "../../src/types.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from "node:fs";
const mockReadFileSync = vi.mocked(readFileSync);

const validConfig: AgentConfig = {
  version: "1.0",
  defaultIdentity: {
    username: "Bot",
    icon_emoji: ":robot_face:",
  },
  agents: {
    "agent-alpha": {
      username: "Alpha",
      icon_emoji: ":large_blue_circle:",
    },
    "agent-beta": {
      username: "Beta",
      icon_emoji: ":large_green_circle:",
    },
  },
};

describe("loadAgentConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockReadFileSync.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns null when SLACK_AGENT_CONFIG_PATH is not set", () => {
    delete process.env.SLACK_AGENT_CONFIG_PATH;
    const result = loadAgentConfig();
    expect(result).toBeNull();
  });

  it("returns config when file exists and is valid", () => {
    process.env.SLACK_AGENT_CONFIG_PATH = "/path/to/config.json";
    mockReadFileSync.mockReturnValue(JSON.stringify(validConfig));

    const result = loadAgentConfig();

    expect(result).toEqual(validConfig);
    expect(mockReadFileSync).toHaveBeenCalledWith("/path/to/config.json", "utf-8");
  });

  it("returns null and logs warning when file not found", () => {
    process.env.SLACK_AGENT_CONFIG_PATH = "/nonexistent/config.json";
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = loadAgentConfig();

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
    consoleSpy.mockRestore();
  });

  it("throws on invalid config missing version", () => {
    process.env.SLACK_AGENT_CONFIG_PATH = "/path/to/config.json";
    const invalidConfig = { defaultIdentity: { username: "Bot" }, agents: {} };
    mockReadFileSync.mockReturnValue(JSON.stringify(invalidConfig));

    expect(() => loadAgentConfig()).toThrow("expected version");
  });

  it("throws on invalid config with wrong version", () => {
    process.env.SLACK_AGENT_CONFIG_PATH = "/path/to/config.json";
    const invalidConfig = { version: "2.0", defaultIdentity: { username: "Bot" }, agents: {} };
    mockReadFileSync.mockReturnValue(JSON.stringify(invalidConfig));

    expect(() => loadAgentConfig()).toThrow('expected version "1.0", got "2.0"');
  });

  it("throws on invalid config missing defaultIdentity", () => {
    process.env.SLACK_AGENT_CONFIG_PATH = "/path/to/config.json";
    const invalidConfig = { version: "1.0", agents: {} };
    mockReadFileSync.mockReturnValue(JSON.stringify(invalidConfig));

    expect(() => loadAgentConfig()).toThrow("missing defaultIdentity");
  });
});

describe("resolveIdentity", () => {
  it("returns explicit identity when username is provided (tier 1)", () => {
    const result = resolveIdentity(
      { username: "Custom User", icon_emoji: ":star:", icon_url: undefined },
      validConfig,
    );

    expect(result).toEqual({
      username: "Custom User",
      icon_emoji: ":star:",
      icon_url: undefined,
    });
  });

  it("explicit username takes priority over agent_id (tier 1 > tier 2)", () => {
    const result = resolveIdentity(
      { username: "Override", agent_id: "agent-alpha" },
      validConfig,
    );

    expect(result?.username).toBe("Override");
  });

  it("returns agent config when agent_id matches (tier 2)", () => {
    const result = resolveIdentity(
      { agent_id: "agent-alpha" },
      validConfig,
    );

    expect(result).toEqual({
      username: "Alpha",
      icon_emoji: ":large_blue_circle:",
    });
  });

  it("returns default identity when agent_id does not match (tier 3)", () => {
    const result = resolveIdentity(
      { agent_id: "unknown-agent" },
      validConfig,
    );

    expect(result).toEqual({
      username: "Bot",
      icon_emoji: ":robot_face:",
    });
  });

  it("returns default identity when no args provided but config exists (tier 3)", () => {
    const result = resolveIdentity({}, validConfig);

    expect(result).toEqual({
      username: "Bot",
      icon_emoji: ":robot_face:",
    });
  });

  it("returns null when no config and no explicit params (tier 4)", () => {
    const result = resolveIdentity({}, null);

    expect(result).toBeNull();
  });

  it("returns null when config is null and agent_id provided (tier 4)", () => {
    const result = resolveIdentity({ agent_id: "agent-alpha" }, null);

    expect(result).toBeNull();
  });
});
