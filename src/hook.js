import {
  isInsideTmux,
  getWindowId,
  setState,
  unsetState,
  STATE_READY,
  STATE_BUSY,
} from "./tmux.js";

const EVENT_TRANSITIONS = {
  // Cursor events
  sessionStart: { type: "set", value: STATE_READY },
  beforeSubmitPrompt: { type: "set", value: STATE_BUSY },
  stop: { type: "set", value: STATE_READY },
  sessionEnd: { type: "unset" },
  // Claude Code events
  SessionStart: { type: "set", value: STATE_READY },
  UserPromptSubmit: { type: "set", value: STATE_BUSY },
  Stop: { type: "set", value: STATE_READY },
  Notification: { type: "set", value: STATE_READY },
  SessionEnd: { type: "unset" },
};

export function processEvent(payload) {
  if (!isInsideTmux()) return;

  const event = payload && payload.hook_event_name;
  if (!event) return;

  const transition = EVENT_TRANSITIONS[event];
  if (!transition) return;

  const windowId = getWindowId();
  if (!windowId) return;

  if (transition.type === "set") {
    setState(windowId, transition.value);
  } else if (transition.type === "unset") {
    unsetState(windowId);
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
