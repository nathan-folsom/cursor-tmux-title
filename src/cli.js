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
  titlesEnabled,
  inspectConsumer,
  tmuxSnippet,
  STATE_OPTION,
  STATE_READY,
  STATE_BUSY,
  STATE_WAITING,
} from "./tmux.js";

const HELP = `
cursor-tmux-title — track Cursor agent state in a tmux window option

States (per tmux window):
  unset    No cursor-agent has run in this window
  ready    Agent is idle, waiting for input
  busy     Agent is processing a prompt
  waiting  Turn ended but a background process is still running

Commands:
  install            Register hooks in ~/.cursor/hooks.json
  uninstall          Remove hooks from ~/.cursor/hooks.json
  install-claude     Register hooks in ~/.claude/settings.json
  uninstall-claude   Remove hooks from ~/.claude/settings.json
  status             Show installation and current state
  doctor             Check that both halves are wired up (hooks + tmux format)
  tmux-snippet       Print the recommended tmux config block (covers all states)
  test               Cycle through ready → busy → waiting → ready → unset (run inside tmux)
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

// Report whether the consumer half (a tmux format referencing @cursor_state) is
// wired up. Shared by `status` and `doctor`.
function printConsumerWiring(indent = "") {
  if (!isInsideTmux()) {
    console.log(`${indent}Tmux display: not inside tmux (can't check title wiring)`);
    return;
  }
  const { referencing, missingStates, usesTitles } = inspectConsumer();
  if (referencing.length === 0) {
    console.log(
      `${indent}Tmux display: ✗ no tmux format references ${STATE_OPTION} — the indicator won't render`,
    );
    console.log(
      `${indent}              run \`cursor-tmux-title tmux-snippet\` and add it to your tmux.conf`,
    );
    return;
  }
  console.log(
    `${indent}Tmux display: ✓ ${STATE_OPTION} referenced in ${referencing.join(", ")}`,
  );
  if (usesTitles && !titlesEnabled()) {
    console.log(`${indent}              ⚠ set-titles is off — run \`set -g set-titles on\``);
  }
  if (missingStates.length > 0) {
    console.log(
      `${indent}              ⚠ no visible branch for: ${missingStates.join(", ")} — those states won't show`,
    );
    console.log(
      `${indent}              \`cursor-tmux-title tmux-snippet\` prints a format covering every state`,
    );
  }
}

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
      printConsumerWiring();
      break;
    }

    case "doctor": {
      const cursorInstalled = hasCursorHooks();
      const claudeInstalled = hasClaudeHooks();
      console.log("Producer (hooks that set @cursor_state):");
      console.log(
        `  Claude Code: ${claudeInstalled ? "✓ installed" : "✗ not installed — run `install-claude`"}`,
      );
      console.log(
        `  Cursor:      ${cursorInstalled ? "✓ installed" : "✗ not installed — run `install`"}`,
      );
      if (!cursorInstalled && !claudeInstalled) {
        console.log("  → No hooks installed; @cursor_state will never update.");
      }
      console.log("");
      console.log("Consumer (tmux format that renders @cursor_state):");
      printConsumerWiring("  ");
      if (isInsideTmux()) {
        const state = getState(getWindowId());
        console.log(`  Current ${STATE_OPTION}: ${state || "unset"}`);
      }
      break;
    }

    case "tmux-snippet": {
      console.log(tmuxSnippet());
      break;
    }

    case "test": {
      requireTmux();
      const windowId = getWindowId();
      if (!windowId) {
        console.error("Could not resolve tmux window id.");
        process.exit(1);
      }
      console.log(
        `Cycling state on ${windowId}: ready → busy → waiting → ready → unset`,
      );
      setState(windowId, STATE_READY);
      await sleep(1500);
      setState(windowId, STATE_BUSY);
      await sleep(1500);
      setState(windowId, STATE_WAITING);
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
