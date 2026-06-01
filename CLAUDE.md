# cursor-tmux-title — agent guide

Tracks Cursor / Claude Code agent state in a per-window tmux option (`@cursor_state`:
`ready` | `busy` | `waiting` | unset) so a tmux format can show an at-a-glance indicator.

## Mental model: producer + consumer

The tool is only **half** the system, and most confusion comes from forgetting that:

- **Producer** = this package. Hooks fire → `src/hook.js` writes `@cursor_state` via
  `tmux set-option`. The contract (option name, state values, emoji, recommended format)
  lives in `src/tmux.js`.
- **Consumer** = the user's `tmux.conf`. A format string (`set-titles-string`, etc.)
  reads `@cursor_state` and renders it. Lives outside this repo.

Neither half is visible alone. The consumer can silently drift — e.g. a format string
missing a branch for a state. **If you add or rename a state, update `DISPLAY_STATES` and
`STATE_EMOJI` in `src/tmux.js`, then re-run `doctor`/`tmux-snippet` (below).**

## Commands to run (verification is built in — use it)

Run via the installed bin, or `node src/cli.js <cmd>` from the repo:

| When | Command | Why |
|---|---|---|
| After any change | `node src/cli.js doctor` | Checks **both** halves: hooks installed AND a tmux format references `@cursor_state` with a branch for every `DISPLAY_STATE`. Flags: not-referenced / missing-branch / ok. |
| After changing states/emoji | `node src/cli.js tmux-snippet` | Prints the canonical `set-titles-string`, generated from `DISPLAY_STATES` so it can't drift. Eyeball it. |
| Quick sanity (inside tmux) | `node src/cli.js test` | Cycles `ready → busy → waiting → ready → unset` so you can watch the title react. |
| Inspect live state | `node src/cli.js status` | Install state + current `@cursor_state` + consumer check. |
| Reset a stuck window | `node src/cli.js clear` | Unsets `@cursor_state`. |

`doctor`, `status`, `test`, and `clear` need to run **inside a tmux pane**. After editing a
state value, the highest-signal check is: `node src/cli.js doctor` should report the
consumer is wired with no missing-branch warnings.

## Hook plumbing

- Event → state mapping is the `switch` in `src/hook.js` (`processEvent`). Cursor and
  Claude Code event names are handled side by side.
- Registration: `src/cursor-hooks.js` (`~/.cursor/hooks.json`) and `src/claude-hooks.js`
  (`~/.claude/settings.json`). Adding a new hook event means adding it to the relevant
  `*_HOOK_EVENTS` list **and** handling it in the `switch`, then re-running `install` /
  `install-claude`.
- The hook command is `node src/cli.js hook`, so edits to `src/` take effect on the next
  hook invocation — but newly *registered* events only fire in Claude Code sessions started
  after `install-claude` (hooks load at session start).
- Debug tracing: set `CURSOR_TMUX_TITLE_DEBUG=1` (or a path) to log every event + key
  payload fields — how the interrupt behavior below was diagnosed.

## Known limitation: user interrupt (Esc)

A user interrupt fires **no hook** in Claude Code (verified v2.1.156; see upstream
anthropics/claude-code#9516). The window stays `busy` until the next prompt — there is no
hook-based fix. Don't add speculative interrupt handling; wire a real `ready` transition
only if/when Anthropic ships an interrupt hook.
