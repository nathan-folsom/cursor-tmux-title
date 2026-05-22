#!/usr/bin/env node

import {
  registerCursorHooks,
  unregisterCursorHooks,
  hasCursorHooks,
} from "./cursor-hooks.js";
import {
  registerClaudeHooks,
  unregisterClaudeHooks,
  hasClaudeHooks,
} from "./claude-hooks.js";
import { hookCommand } from "./hook.js";
import {
  isInsideTmux,
  getWindowId,
  setState,
  unsetState,
  getState,
  STATE_OPTION,
  STATE_READY,
  STATE_BUSY,
} from "./tmux.js";

const HELP = `
cursor-tmux-title — track Cursor agent state in a tmux window option

States (per tmux window):
  unset   No cursor-agent has run in this window
  ready   Agent is idle, waiting for input
  busy    Agent is processing a prompt

Commands:
  install            Register hooks in ~/.cursor/hooks.json
  uninstall          Remove hooks from ~/.cursor/hooks.json
  install-claude     Register hooks in ~/.claude/settings.json
  uninstall-claude   Remove hooks from ~/.claude/settings.json
  status             Show installation and current state
  test               Cycle through ready → busy → ready → unset (run inside tmux)
  clear              Unset the state for the current tmux window
  hook               (internal) Process a hook event from stdin
  help               Show this help message

Tmux setup:
  Reference the state in your set-titles-string, e.g.

    set -g set-titles on
    set -g set-titles-string "#{b:session_path}#{?#{==:#{@cursor_state},ready}, 🟢,}"
`.trim();

function resolveHookCommand() {
  const argv0 = process.argv[1] || "";
  if (argv0.includes("node_modules/.bin") || argv0.endsWith("/cursor-tmux-title")) {
    return "cursor-tmux-title hook";
  }
  return `node ${argv0} hook`;
}

function requireTmux() {
  if (!isInsideTmux()) {
    console.error("Not running inside tmux (TMUX/TMUX_PANE not set).");
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  switch (command) {
    case "install": {
      const cmd = resolveHookCommand();
      const count = registerCursorHooks(cmd);
      console.log(`Registered ${count} hook events in ~/.cursor/hooks.json`);
      console.log(`Hook command: ${cmd}`);
      break;
    }

    case "uninstall": {
      const removed = unregisterCursorHooks();
      if (removed > 0) {
        console.log(`Removed ${removed} hook entries from ~/.cursor/hooks.json`);
      } else {
        console.log("No cursor-tmux-title hooks found to remove.");
      }
      break;
    }

    case "install-claude": {
      const cmd = resolveHookCommand();
      const count = registerClaudeHooks(cmd);
      console.log(`Registered ${count} hook events in ~/.claude/settings.json`);
      console.log(`Hook command: ${cmd}`);
      break;
    }

    case "uninstall-claude": {
      const removed = unregisterClaudeHooks();
      if (removed > 0) {
        console.log(`Removed ${removed} hook entries from ~/.claude/settings.json`);
      } else {
        console.log("No cursor-tmux-title hooks found to remove.");
      }
      break;
    }

    case "status": {
      const cursorInstalled = hasCursorHooks();
      const claudeInstalled = hasClaudeHooks();
      console.log(`Cursor hooks installed: ${cursorInstalled ? "yes" : "no"}`);
      console.log(`Claude Code hooks installed: ${claudeInstalled ? "yes" : "no"}`);
      if (isInsideTmux()) {
        const windowId = getWindowId();
        const state = getState(windowId);
        console.log(`Tmux window: ${windowId || "unknown"}`);
        console.log(`State (${STATE_OPTION}): ${state || "unset"}`);
      } else {
        console.log("Tmux: not running inside a tmux session");
      }
      break;
    }

    case "test": {
      requireTmux();
      const windowId = getWindowId();
      if (!windowId) {
        console.error("Could not resolve tmux window id.");
        process.exit(1);
      }
      console.log(`Cycling state on ${windowId}: ready → busy → ready → unset`);
      setState(windowId, STATE_READY);
      await sleep(1500);
      setState(windowId, STATE_BUSY);
      await sleep(1500);
      setState(windowId, STATE_READY);
      await sleep(1500);
      unsetState(windowId);
      console.log("Done.");
      break;
    }

    case "clear": {
      requireTmux();
      const windowId = getWindowId();
      if (!windowId) {
        console.error("Could not resolve tmux window id.");
        process.exit(1);
      }
      unsetState(windowId);
      console.log(`Unset ${STATE_OPTION} on ${windowId}.`);
      break;
    }

    case "hook": {
      await hookCommand();
      break;
    }

    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
