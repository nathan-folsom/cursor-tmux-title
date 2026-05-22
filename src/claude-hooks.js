import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_FILE = join(CLAUDE_DIR, "settings.json");

const HOOK_MARKER = "cursor-tmux-title";

const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "Notification",
  "SessionEnd",
];

function isOurHook(entry) {
  const hooks = entry && entry.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h) =>
      h && typeof h.command === "string" && h.command.includes(HOOK_MARKER),
  );
}

function loadSettings() {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function hasClaudeHooks() {
  const config = loadSettings();
  if (!config.hooks || typeof config.hooks !== "object") return false;
  return Object.values(config.hooks).some(
    (entries) => Array.isArray(entries) && entries.some(isOurHook),
  );
}

export function registerClaudeHooks(command) {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  const config = loadSettings();
  if (!config.hooks || typeof config.hooks !== "object") config.hooks = {};

  let count = 0;
  for (const event of CLAUDE_HOOK_EVENTS) {
    const existing = config.hooks[event];
    const arr = Array.isArray(existing) ? existing : [];
    const withoutUs = arr.filter((entry) => !isOurHook(entry));
    config.hooks[event] = [
      ...withoutUs,
      { hooks: [{ type: "command", command, timeout: 5 }] },
    ];
    count++;
  }

  writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2) + "\n");
  return count;
}

export function unregisterClaudeHooks() {
  try {
    const config = loadSettings();
    if (!config.hooks || typeof config.hooks !== "object") return 0;

    let removed = 0;
    for (const event of Object.keys(config.hooks)) {
      const arr = config.hooks[event];
      if (!Array.isArray(arr)) continue;
      const before = arr.length;
      config.hooks[event] = arr.filter((entry) => !isOurHook(entry));
      removed += before - config.hooks[event].length;
      if (config.hooks[event].length === 0) delete config.hooks[event];
    }

    if (Object.keys(config.hooks).length === 0) delete config.hooks;

    writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2) + "\n");
    return removed;
  } catch {
    return 0;
  }
}
