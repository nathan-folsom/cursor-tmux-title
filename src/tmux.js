import { execFileSync } from "child_process";
import { appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const STATE_OPTION = "@cursor_state";
export const BG_PENDING_OPTION = "@cursor_bg_pending";
export const STATE_READY = "ready";
export const STATE_BUSY = "busy";
export const STATE_WAITING = "waiting";

export function isInsideTmux() {
  return Boolean(process.env.TMUX) && Boolean(process.env.TMUX_PANE);
}

function tmux(args) {
  return execFileSync("tmux", args, {
    encoding: "utf-8",
    timeout: 2000,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function getWindowId() {
  const pane = process.env.TMUX_PANE;
  if (!pane) return null;
  try {
    return tmux(["display-message", "-p", "-t", pane, "#{window_id}"]) || null;
  } catch {
    return null;
  }
}

export function setState(windowId, value) {
  if (!windowId) return false;
  try {
    tmux(["set-option", "-w", "-t", windowId, STATE_OPTION, value]);
    return true;
  } catch {
    return false;
  }
}

export function unsetState(windowId) {
  if (!windowId) return false;
  try {
    tmux(["set-option", "-w", "-t", windowId, "-u", STATE_OPTION]);
    return true;
  } catch {
    return false;
  }
}

export function getState(windowId) {
  if (!windowId) return null;
  try {
    const value = tmux([
      "display-message",
      "-p",
      "-t",
      windowId,
      `#{${STATE_OPTION}}`,
    ]);
    return value || null;
  } catch {
    return null;
  }
}

// --- The producer/consumer contract -----------------------------------------
// This package is the *producer*: it writes @cursor_state. Your tmux config is
// the *consumer*: it reads @cursor_state in a format string to render an
// indicator. The two are bound only by the option name and these state values.
// `busy` is intentionally rendered as nothing, so it isn't in DISPLAY_STATES
// (the states a format string is expected to have a visible branch for).
export const DISPLAY_STATES = [STATE_READY, STATE_WAITING];

const STATE_EMOJI = {
  [STATE_READY]: "🟢",
  [STATE_WAITING]: "🟡",
};

// tmux format options where @cursor_state is commonly referenced.
const FORMAT_OPTIONS = [
  "set-titles-string",
  "status-left",
  "status-right",
  "window-status-format",
  "window-status-current-format",
];

function getGlobalOption(name) {
  try {
    return tmux(["show-options", "-gv", name]);
  } catch {
    return "";
  }
}

export function titlesEnabled() {
  return getGlobalOption("set-titles") === "on";
}

// The canonical format string the consumer should use — derived from the same
// state vocabulary as the producer, so it can never drift out of sync (e.g.
// when a new state is added, this snippet gains its branch automatically).
export function recommendedTitlesString() {
  let s = "";
  for (const state of DISPLAY_STATES) {
    s += `#{?#{==:#{${STATE_OPTION}},${state}},${STATE_EMOJI[state]} ,}`;
  }
  return s + "#{b:session_path}";
}

export function tmuxSnippet() {
  return [
    "# cursor-tmux-title: render agent state in the window title",
    "set -g set-titles on",
    `set -g set-titles-string "${recommendedTitlesString()}"`,
  ].join("\n");
}

// Inspect whether the consumer half is wired up: which format options reference
// @cursor_state, and whether they have a visible branch for each DISPLAY_STATE.
export function inspectConsumer() {
  const referencing = [];
  let combined = "";
  for (const opt of FORMAT_OPTIONS) {
    const val = getGlobalOption(opt);
    if (val && val.includes(STATE_OPTION)) {
      referencing.push(opt);
      combined += " " + val;
    }
  }
  const missingStates = DISPLAY_STATES.filter((s) => !combined.includes(s));
  return {
    referencing,
    missingStates,
    usesTitles: referencing.includes("set-titles-string"),
  };
}

// A window-scoped flag recording that the agent launched a background process
// that may still be running after the turn ends. Used to distinguish a true
// `ready` (🟢) from a parked `waiting` (🟡) at Stop time.
export function setBgPending(windowId) {
  if (!windowId) return false;
  try {
    tmux(["set-option", "-w", "-t", windowId, BG_PENDING_OPTION, "1"]);
    return true;
  } catch {
    return false;
  }
}

export function clearBgPending(windowId) {
  if (!windowId) return false;
  try {
    tmux(["set-option", "-w", "-t", windowId, "-u", BG_PENDING_OPTION]);
    return true;
  } catch {
    return false;
  }
}

export function getBgPending(windowId) {
  if (!windowId) return false;
  try {
    const value = tmux([
      "display-message",
      "-p",
      "-t",
      windowId,
      `#{${BG_PENDING_OPTION}}`,
    ]);
    return value === "1";
  } catch {
    return false;
  }
}

// Best-effort event tracing, gated on the CURSOR_TMUX_TITLE_DEBUG env var.
// Set it to "1" to log to ~/.claude/cursor-tmux-title-debug.log, or to an
// absolute path to log there. Used to discover which hook events fire in
// undocumented situations (e.g. user interrupts). No-op when unset.
export function debugLog(event, payload) {
  const dbg = process.env.CURSOR_TMUX_TITLE_DEBUG;
  if (!dbg) return;
  const file =
    dbg === "1" || dbg === "true"
      ? join(homedir(), ".claude", "cursor-tmux-title-debug.log")
      : dbg;
  try {
    const fields = {
      notification_type: payload && payload.notification_type,
      error_type: payload && payload.error_type,
      tool_name: payload && payload.tool_name,
      run_in_background:
        payload && payload.tool_input && payload.tool_input.run_in_background,
      reason: payload && payload.reason,
    };
    appendFileSync(
      file,
      `${new Date().toISOString()}\t${event}\t${JSON.stringify(fields)}\n`,
    );
  } catch {
    // best-effort tracing only
  }
}
