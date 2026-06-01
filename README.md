# cursor-tmux-title

Track Cursor agent state in a per-window tmux option (`@cursor_state`) so you can reference it from your `set-titles-string`, status line, or window-status format. Gives you an at-a-glance answer to "which of my tmux windows have an idle agent ready for input?"

Sibling to [cursor-notify](../cursor-notify); same hook plumbing, different output channel.

## States

`@cursor_state` is a window-scoped tmux user option with four states:

| Value | Meaning |
|---|---|
| *unset* | No `cursor-agent` has run in this window since tmux started |
| `ready` | Agent is idle, waiting for your next prompt |
| `busy` | Agent is currently processing a prompt |
| `waiting` | The turn ended, but a background process the agent launched is still running |

State transitions are driven by Cursor hooks:

- `sessionStart` → `ready` (first time agent launches in this window)
- `beforeSubmitPrompt` → `busy`
- `stop` → `ready`
- `sessionEnd` → unset

…and by the equivalent Claude Code hooks:

- `SessionStart` → `ready`
- `UserPromptSubmit` → `busy` (also clears any stale background-pending flag from a prior turn)
- `PostToolUse` → `busy` (the agent is actively working again — also clears `ready` after a mid-turn `Notification`, e.g. once you answer a question or grant a permission)
- `Stop` → `ready`, or `waiting` if a background process is still pending (see below)
- `StopFailure` → `ready` (the turn ended on an API error — you're back at the prompt, not busy)
- `PostToolUseFailure` → `busy` (a tool failed but the agent is still mid-turn)
- `Notification` → `ready` (agent is waiting for your input mid-turn)
- `SessionEnd` → unset

### Distinguishing `waiting` (🟡) from `ready` (🟢)

When the agent runs a `Bash` command with `run_in_background: true`, the `PostToolUse`
hook sets a second window option, `@cursor_bg_pending`. If the turn then ends (`Stop`)
while that flag is set, the state becomes `waiting` instead of `ready` — "not busy, but
parked on a background process." The flag is cleared (so the next `Stop` goes back to
`ready`) when:

- the agent reads `BashOutput` showing the process completed/exited, or kills it (`KillShell`)
- you submit a new prompt (`UserPromptSubmit`)
- the session ends (`SessionEnd`)

This is a **best-effort heuristic**: Claude Code emits no dedicated "background process
finished" hook, so a genuinely long-lived background process (e.g. a dev server) will keep
the window in `waiting` until your next prompt. The flag is a single per-window boolean, so
with multiple concurrent background processes the first completion clears it.

## Install

```bash
cd cursor-tmux-title
npm install -g .
cursor-tmux-title install
```

This adds entries to `~/.cursor/hooks.json` for `sessionStart`, `beforeSubmitPrompt`, `stop`, and `sessionEnd`. They coexist with `cursor-notify` and any other hook tools.

## Tmux config

Reference the state from your `set-titles-string` (or `status-right`, `window-status-format`, etc.) using tmux's `==:` equality comparator inside a conditional:

```tmux
set -g set-titles on
set -g set-titles-string "#{b:session_path}#{?#{==:#{@cursor_state},ready}, 🟢,}"
```

The `#{?#{==:#{@cursor_state},ready}, 🟢,}` block expands to ` 🟢` only when the state equals `ready`, and to nothing when the state is `busy` or unset. tmux re-evaluates the format whenever the active pane changes, so the indicator follows you between panes correctly.

Want indicators for the other states too? Chain more conditionals — green for ready,
yellow for parked-on-background, and (say) a dim dot for busy:

```tmux
set -g set-titles-string "#{b:session_path}#{?#{==:#{@cursor_state},ready}, 🟢,}#{?#{==:#{@cursor_state},waiting}, 🟡,}#{?#{==:#{@cursor_state},busy}, ⚫,}"
```

Reload tmux config: `tmux source-file ~/.config/tmux/tmux.conf`.

## Verify

Inside a tmux pane:

```bash
cursor-tmux-title test    # cycles ready → busy → waiting → ready → unset over ~6s
cursor-tmux-title status  # shows install + current state
cursor-tmux-title doctor  # checks that BOTH halves are wired up
```

## Commands

| Command | What it does |
|---|---|
| `install` | Register hooks in `~/.cursor/hooks.json` |
| `uninstall` | Remove just this package's hook entries |
| `status` | Show install state, current tmux window, current `@cursor_state`, and whether a tmux format consumes it |
| `doctor` | Diagnose both halves: hooks installed (producer) **and** a tmux format that references `@cursor_state` with a branch for each state (consumer) |
| `tmux-snippet` | Print the recommended `set-titles-string` block, covering every state — paste into your `tmux.conf` |
| `test` | Cycle the state through `ready` → `busy` → `waiting` → `ready` → unset (must run inside tmux) |
| `clear` | Unset the state for the current window |
| `hook` | Internal entry point invoked by Cursor |

## How it works

Cursor pipes a JSON payload to the hook on each event. `cursor-tmux-title hook`:

1. Bails immediately if `TMUX` / `TMUX_PANE` aren't in the environment (so it's a no-op outside tmux).
2. Resolves the window id of the calling pane via `tmux display-message -p -t "$TMUX_PANE" '#{window_id}'`.
3. Runs `tmux set-option -w -t <window-id> @cursor_state <ready|busy>` (or `-u` to unset) based on the event.

Because `set-titles-string` is a tmux format, the OSC escape sent to the outer terminal updates automatically when the option changes — no extra refresh needed.

### Two halves: producer and consumer

This tool is only **half** of the picture, by design:

- **Producer** — this package. On each hook event it writes the `@cursor_state`
  window option. It has no opinion on how you display it.
- **Consumer** — your `tmux.conf`. A format string (`set-titles-string`,
  `status-right`, `window-status-format`, …) reads `@cursor_state` and renders an
  indicator however you like.

The two are bound only by a contract: the option name **`@cursor_state`** and its
value vocabulary (**`ready` / `busy` / `waiting`** / unset). They live in separate
places on purpose — different runtimes, and the styling is yours. The catch is that
neither half does anything visible alone, and the consumer half can silently fall
out of sync (e.g. a hand-copied format string that lacks a branch for a newly-added
state — which is easy to miss). Two commands keep the contract honest:

- **`cursor-tmux-title tmux-snippet`** emits the canonical format string, generated
  from the same state list the producer uses — so it can't drift.
- **`cursor-tmux-title doctor`** checks both halves: that hooks are installed *and*
  that some tmux format references `@cursor_state` with a branch for every state.
  Run it first if the indicator isn't showing up.

### Why a tmux user option (and not `rename-window`)?

`rename-window` would fight with tmux's `automatic-rename` and clobber your existing `set-titles-string`. A user option is cheap, scoped to the window, and slots cleanly into format strings with `#{?#{==:#{@cursor_state},ready},…}`.

### Edge cases

- **Killed agent processes** — if `cursor-agent` is SIGKILLed mid-prompt, no `stop` hook fires and the window stays stuck on `busy`. `sessionEnd` is the safety net; if even that doesn't fire, run `cursor-tmux-title clear`.
- **Interrupting Claude Code (Esc)** — verified against Claude Code v2.1.156: a user
  interrupt fires **no hook at all** (no `Stop`, `PostToolUseFailure`, or `Notification`).
  A hook-driven tool therefore cannot observe the interrupt as it happens, so the window
  stays `busy` until something else fires — your next `UserPromptSubmit`, or an idle
  `Notification` if/when one is emitted. There is no clean automatic fix for this in the
  current Claude Code; run `cursor-tmux-title clear` to reset the window immediately, or
  just send your next prompt. (If a future Claude Code version adds an interrupt hook, wire
  it to `ready` in `src/hook.js` and register it in `src/claude-hooks.js`.) Note: if you use
  Claude Code's **vim input mode**, the first Esc only leaves insert mode — it takes a
  second Esc to actually interrupt.
- **Multiple agents in one window** — state is per-window, so two concurrent agents in the same window share it. The last hook to fire wins. Run them in separate windows, or fork this package to scope per-pane (`-p` instead of `-w`).
- **Outside tmux** — hooks no-op silently.

### Debugging

Set `CURSOR_TMUX_TITLE_DEBUG=1` (logs to `~/.claude/cursor-tmux-title-debug.log`) or to an
absolute path to trace every hook event the tool receives, along with the key payload
fields (`notification_type`, `error_type`, `tool_name`, `run_in_background`, `reason`). Handy
for confirming which events your Claude Code build fires in undocumented situations like
interrupts. Unset the variable to turn tracing off.

## License

MIT
