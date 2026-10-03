# claude-mods

Claude Code mods: small plugins that add panes and commands inside a Claude Code session.

| Mod | What you get |
|---|---|
| [lava-lamp](plugins/lava-lamp) | An animated lava lamp in a side pane. Real wax-in-liquid colour pairs, and blobs that heat, rise, cool, sink and nudge each other. |

## Install

```bash
claude plugin marketplace add CtrlAltFocus/claude-mods
claude plugin install lava-lamp@ctrlaltfocus-mods
```

Then start a session and type `/lava-lamp`.

Mods use Claude Code's function-hook plugin API. These were built and tested on Claude Code 2.1.288.

## Licence

MIT. See [LICENSE](LICENSE).
