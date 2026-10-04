# lava-lamp

An animated lava lamp in a Claude Code side pane. Type `/lava-lamp` to open it and again to close it. Closing it stops its timer, so it costs nothing while hidden.

The wax behaves like a real lamp's. Blobs warm in the pool at the base and rise while warmer than the liquid. They cool under the cap and sink back. A blob whose temperature settles near the liquid's hovers mid-glass for a while. Blobs close to each other drag each other along, cling a little and trade heat, so their paths bend.

## Words

`/lava-lamp [words…]`. Words are case-insensitive, go in any order and can be combined. Your last choice is kept for the session, so a bare `/lava-lamp` reopens with it.

| Kind | Words |
|---|---|
| Speed | `veryslow`, `slow`, `normal`, `fast` |
| Colour | `orange`, `yellow`, `green`, `purple`, `blue`, `pink`. Each means a classic wax-in-liquid pair, e.g. `orange` is orange wax in violet. |
| Pairs | Any `<wax>-<liquid>`: wax and liquid from `orange`, `yellow`, `green`, `purple`, `blue`, `pink`, `red`, `turquoise`, `white`, `black`, `violet`; the liquid may also be `clear`, which lets your terminal's background show through. A colour used as liquid is drawn as a deep version of itself, and kept far enough from the wax to show it. Pairs taken from real lamps (e.g. `orange-yellow`, `white-red`, `orange-black`) keep their hand-tuned colours. |
| Rotate | `rotate` (or `rotating`) blends slowly through eight pairs. `rotate-clear` rotates only the wax, over a clear liquid. Any colour word turns rotation off. |
| Bubbles | `few` (big and heavy), `medium`, `many` (small and lively) |
| Outline | `lamp`, `nolamp` (hide the cap and base) |
| Close | `off` |

Examples: `/lava-lamp turquoise-violet few slow`, `/lava-lamp orange-clear`, `/lava-lamp white-black many`.

## Notes

- A side pane opened by a command appears at any terminal width. In a fullscreen terminal at least 110 columns wide it docks beside the conversation, otherwise it sits above the prompt.
- A reload or reopen starts a fresh simulation. A warm-up runs first, so the lamp does not open with all its wax in the pool.
- Tests: `claude plugin test plugins/lava-lamp`.

MIT licensed.
