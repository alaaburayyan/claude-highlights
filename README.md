# Highlights

A Claude Code mod that turns Claude's replies into live, color-coded highlights in a side pane, so you can follow a long answer without reading all of it.

As a reply streams, each paragraph is summarized by Haiku into short one-line points:

| | Meaning |
| --- | --- |
| 🔵 **step** | Claude is starting a new phase of the work (also taken from its task list) |
| 🟢 **done** | Something finished, confirmed or working |
| 🟠 **notice** | An assumption, a choice, a caveat or a question for you |
| 🔴 **act** | An error, a risk, or something you must do yourself |

Earlier questions stay in the pane, grayed out, with the newest at the bottom. The pane follows new highlights unless you scroll up.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install highlights --marketplace alaaburayyan/claude-highlights
```

Answer `y` to add the marketplace, pick a scope (user scope loads it in every session), and set the options if asked. The pane opens on its own at the start of each session.

## Use

- `/highlights` shows or hides the pane.
- The top of the pane holds the color legend and "Highlights Tokens", the Haiku tokens the highlights have used this session (one line when the pane is wide, two when narrow). The points follow right below.
- Interrupting a reply clears its highlights.

## Options

| Option | Default | |
| --- | --- | --- |
| `maxHighlights` | `5` | Most green, orange and red points kept per question; `0` means unlimited. Blue steps are always kept. |

## Privacy and cost

- Each paragraph of the main reply (not subagents) is sent to Haiku through your own Claude Code session, so it uses your account's usage.
- Code blocks are stripped before summarizing. Inline code, API keys, tokens, JWTs, passwords, connection strings, emails, private keys and long hex/base64 strings are replaced with `[hidden]` in everything the pane shows, and the model is told never to repeat them.
- Once a question reaches its highlight limit, no further model calls are made for it.

## Develop

```
claude --plugin-dir .
```

```
claude plugin validate .
```

```
claude plugin test .
```

The engine writes the API types to `.claude-plugin/types/` when it loads the mod; after that, `tsc -p .` type-checks it.

## License

[MIT](LICENSE)
