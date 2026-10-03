import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { DEFAULT_OPTIONS, DT_MS, HELP, advanceFrame, createSim, describe, frame, parseArgs } from './lamp'
import type { Sim } from './lamp'
import type { LavaOptions } from '../types'

const PANE = 'lava-lamp'
const FRAME_MS = 100
// Lamp time in ms (what `rotate` reads), kept so a reload does not restart the colours.
// The wax itself is `lamp` below.
const clock = atom({ plugin: 'lava-lamp', key: 'clockMs' } as const, 0)
const options = atom({ plugin: 'lava-lamp', key: 'options' } as const, DEFAULT_OPTIONS)

// Module state: a reload starts this over (and the engine cancels the old
// timer), so the render hook restarts the clock when it finds none running, and
// the wax starts again from a freshly settled lamp.
let timer: Timer | undefined
let lamp: Sim | undefined

// The live simulation, made (settled) when there is none or when the blob count or
// outline changed. Called after the caller's last await, so no other caller can
// interleave between the check and the assignment.
function simFor(look: LavaOptions, persistedMs: number): Sim {
  const bubbles = look.bubbles ?? 'medium'
  if (lamp === undefined || lamp.bubbles !== bubbles || lamp.lamp !== look.lamp)
    lamp = createSim({ bubbles, lamp: look.lamp }, lamp?.clock ?? Math.round(persistedMs / DT_MS))
  return lamp
}

function start($: EngineInterface) {
  if (timer !== undefined) return
  timer = $.clock.every(FRAME_MS, () => {
    void (async () => {
      const look = await read($, options)
      const persistedMs = await read($, clock)
      const sim = simFor(look, persistedMs)
      advanceFrame(sim, look.speed)
      const ms = sim.clock * DT_MS
      await update($, clock, () => ms)
    })()
  })
}

function stop() {
  timer?.cancel()
  timer = undefined
}

const HINT = '[veryslow|slow|normal|fast] [orange|yellow|green|purple|blue|pink|<wax>-<liquid>|rotate] [few|medium|many] [lamp|nolamp] [off]'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lava-lamp', description: 'Toggle the lava lamp pane, or set its speed, wax-in-liquid colours (or rotating colours), bubble count and outline', argumentHint: HINT })
    return next(e)
  })

  on('command.run', { command: 'lava-lamp' }, async ($, e) => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    const parsed = parseArgs(e.args, await read($, options))
    if (!parsed.ok)
      return { text: `Lava lamp: unknown ${parsed.unknown.map(w => `"${w}"`).join(', ')}. Nothing changed. Words: ${HELP}.` }
    if (parsed.words > 0) await update($, options, () => parsed.options)
    const now = describe(parsed.options)
    // Bare `/lava-lamp` toggles; `off` closes; any other words open (or keep open).
    if (parsed.off || (parsed.words === 0 && isOpen)) {
      if (isOpen) await $.ui.close({ id: PANE })
      stop()
      return { text: parsed.words > 1 ? `Lava lamp off (next time: ${now}).` : 'Lava lamp off.' }
    }
    if (!isOpen) {
      const opened = await $.ui.open({ id: PANE, title: 'Lava lamp' })
      if (!opened.isPlaced) return { text: `Lava lamp not shown: ${opened.reason}` }
    }
    start($)
    return { text: `Lava lamp: ${now}.${parsed.words === 0 ? ' /lava-lamp again to turn it off.' : ''}` }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) stop()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    start($)
    const persistedMs = await read($, clock)
    const look = await read($, options)
    const columns = Math.max(1, e.props.bodyColumns)
    const viewRows = e.viewport?.rows ?? 24
    const rows =
      e.props.placement === 'dock' ? Math.max(4, viewRows - 6) : Math.max(4, Math.min(16, Math.floor(viewRows / 2)))
    const lines = frame(columns, rows, simFor(look, persistedMs), look)
    return (
      <Box flexDirection="column">
        {lines.map(row => (
          <Text wrap="truncate-end">
            {row.map(seg => (
              <Text color={seg.color} backgroundColor={seg.backgroundColor}>
                {seg.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
    )
  })
}
