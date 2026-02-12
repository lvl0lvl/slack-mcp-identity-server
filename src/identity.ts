import { readFileSync } from "node:fs";
import type { AgentConfig, AgentIdentity } from "./types.js";

export function loadAgentConfig(): AgentConfig | null {
  const configPath = process.env.SLACK_AGENT_CONFIG_PATH;
  if (!configPath) return null;

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    console.error(`Warning: Agent config file not found at ${configPath}`);
    return null;
  }

  const config = JSON.parse(raw) as AgentConfig;

  if (config.version !== "1.0") {
    throw new Error(`Invalid agent config: expected version "1.0", got "${config.version}"`);
  }

  if (!config.defaultIdentity || !config.defaultIdentity.username) {
    throw new Error("Invalid agent config: missing defaultIdentity with username");
  }

  return config;
}

export function resolveIdentity(
  args: {
    username?: string;
    icon_emoji?: string;
    icon_url?: string;
    agent_id?: string;
  },
  config: AgentConfig | null,
): AgentIdentity | null {
  // Tier 1: Explicit parameters take highest priority
  if (args.username) {
    return {
      username: args.username,
      icon_emoji: args.icon_emoji,
      icon_url: args.icon_url,
    };
  }

  // Tier 2: Look up by agent_id in config
  if (args.agent_id && config?.agents[args.agent_id]) {
    return config.agents[args.agent_id];
  }

  // Tier 3: Fall back to default identity from config
  if (config?.defaultIdentity) {
    return config.defaultIdentity;
  }

  // Tier 4: No identity override
  return null;
}
