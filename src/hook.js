import {
  isInsideTmux,
  getWindowId,
  setState,
  unsetState,
  setBgPending,
  clearBgPending,
  getBgPending,
  debugLog,
  STATE_READY,
  STATE_BUSY,
  STATE_WAITING,
} from "./tmux.js";

// A PostToolUse for a Bash command launched with run_in_background:true means
// the agent kicked off a process that may outlive the turn.
function isBackgroundLaunch(payload) {
  return (
    payload.tool_name === "Bash" &&
    payload.tool_input &&
    payload.tool_input.run_in_background === true
  );
}

// Signals that a previously-backgrounded process is now finished: the agent
// either killed it (KillShell) or read output showing it exited/completed.
function isBackgroundComplete(payload) {
  if (payload.tool_name === "KillShell") return true;
  if (payload.tool_name === "BashOutput") {
    const resp = payload.tool_response;
    const text = typeof resp === "string" ? resp : JSON.stringify(resp || "");
    return /\b(completed|exited|exit code|killed)\b/i.test(text);
  }
  return false;
}

export function processEvent(payload) {
  if (!isInsideTmux()) return;

  const event = payload && payload.hook_event_name;
  if (!event) return;

  const windowId = getWindowId();
  if (!windowId) return;

  debugLog(event, payload);

  switch (event) {
    // --- session lifecycle ---
    case "sessionStart":
    case "SessionStart":
      setState(windowId, STATE_READY);
      return;

    case "sessionEnd":
    case "SessionEnd":
      clearBgPending(windowId);
      unsetState(windowId);
      return;

    // --- user starts a turn ---
    case "beforeSubmitPrompt":
    case "UserPromptSubmit":
      // New turn: any pending-background context from a prior turn is stale.
      clearBgPending(windowId);
      setState(windowId, STATE_BUSY);
      return;

    // --- agent is actively working ---
    case "PostToolUse":
      if (isBackgroundLaunch(payload)) {
        setBgPending(windowId);
      } else if (isBackgroundComplete(payload)) {
        clearBgPending(windowId);
      }
      setState(windowId, STATE_BUSY);
      return;

    // --- a tool failed, but the agent is still mid-turn (a non-zero exit
    //     doesn't end the turn). Note: a user interrupt does NOT fire this
    //     event in Claude Code v2.1.x — it fires no hook at all.
    case "PostToolUseFailure":
      setState(windowId, STATE_BUSY);
      return;

    // --- turn ended ---
    case "stop":
    case "Stop":
      // Parked on a background process → waiting (🟡); otherwise ready (🟢).
      setState(windowId, getBgPending(windowId) ? STATE_WAITING : STATE_READY);
      return;

    case "StopFailure":
      // Turn ended due to an API error — back at the prompt, not busy.
      setState(windowId, STATE_READY);
      return;

    // --- agent waiting for user mid-turn (permission / idle prompt) ---
    case "Notification":
      setState(windowId, STATE_READY);
      return;

    default:
      return;
  }
}

export async function hookCommand() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.stdout.write("{}\n");
    return;
  }

  try {
    processEvent(payload);
  } catch {
    // best-effort: still return {} so Cursor doesn't error
  }

  process.stdout.write("{}\n");
}
