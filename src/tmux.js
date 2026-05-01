import { execFileSync } from "child_process";

export const STATE_OPTION = "@cursor_state";
export const STATE_READY = "ready";
export const STATE_BUSY = "busy";

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
