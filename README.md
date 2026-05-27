# cursor-tmux-title

Track Cursor agent state in a per-window tmux option (`@cursor_state`) so you can reference it from your `set-titles-string`, status line, or window-status format. Gives you an at-a-glance answer to "which of my tmux windows have an idle agent ready for input?"

Sibling to [cursor-notify](../cursor-notify); same hook plumbing, different output channel.

## States

`@cursor_state` is a window-scoped tmux user option with three states:

| Value | Meaning |
|---|---|
| *unset* | No `cursor-agent` has run in this window since tmux started |
| `ready` | Agent is idle, waiting for your next prompt |
| `busy` | Agent is currently processing a prompt |

State transitions are driven by Cursor hooks:

- `sessionStart` → `ready` (first time agent launches in this window)
- `beforeSubmitPrompt` → `busy`
- `stop` → `ready`
- `sessionEnd` → unset

…and by the equivalent Claude Code hooks:

- `SessionStart` → `ready`
- `UserPromptSubmit` → `busy`
- `PostToolUse` → `busy` (the agent is actively working again — also clears `ready` after a mid-turn `Notification`, e.g. once you answer a question or grant a permission)
- `Stop` → `ready`
- `Notification` → `ready` (agent is waiting for your input mid-turn)
- `SessionEnd` → unset

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

Want a busy indicator too? Chain another conditional:

```tmux
set -g set-titles-string "#{b:session_path}#{?#{==:#{@cursor_state},ready}, 🟢,}#{?#{==:#{@cursor_state},busy}, 🟡,}"
```

Reload tmux config: `tmux source-file ~/.config/tmux/tmux.conf`.

## Verify

Inside a tmux pane:

```bash
cursor-tmux-title test    # cycles ready → busy → ready → unset over ~5s
cursor-tmux-title status  # shows install + current state
```

## Commands

| Command | What it does |
|---|---|
| `install` | Register hooks in `~/.cursor/hooks.json` |
| `uninstall` | Remove just this package's hook entries |
| `status` | Show install state, current tmux window, and current `@cursor_state` |
| `test` | Cycle the state through `ready` → `busy` → `ready` → unset (must run inside tmux) |
| `clear` | Unset the state for the current window |
| `hook` | Internal entry point invoked by Cursor |

## How it works

Cursor pipes a JSON payload to the hook on each event. `cursor-tmux-title hook`:

1. Bails immediately if `TMUX` / `TMUX_PANE` aren't in the environment (so it's a no-op outside tmux).
2. Resolves the window id of the calling pane via `tmux display-message -p -t "$TMUX_PANE" '#{window_id}'`.
3. Runs `tmux set-option -w -t <window-id> @cursor_state <ready|busy>` (or `-u` to unset) based on the event.

Because `set-titles-string` is a tmux format, the OSC escape sent to the outer terminal updates automatically when the option changes — no extra refresh needed.

### Why a tmux user option (and not `rename-window`)?

`rename-window` would fight with tmux's `automatic-rename` and clobber your existing `set-titles-string`. A user option is cheap, scoped to the window, and slots cleanly into format strings with `#{?#{==:#{@cursor_state},ready},…}`.

### Edge cases

- **Killed agent processes** — if `cursor-agent` is SIGKILLed mid-prompt, no `stop` hook fires and the window stays stuck on `busy`. `sessionEnd` is the safety net; if even that doesn't fire, run `cursor-tmux-title clear`.
- **Multiple agents in one window** — state is per-window, so two concurrent agents in the same window share it. The last hook to fire wins. Run them in separate windows, or fork this package to scope per-pane (`-p` instead of `-w`).
- **Outside tmux** — hooks no-op silently.

## License

MIT
