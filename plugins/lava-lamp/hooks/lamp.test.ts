import { expect, test } from 'claude-code/testing'

import {
  BUBBLES,
  DEFAULT_OPTIONS,
  DT,
  FLOOR,
  GLASS_RIM,
  HELP,
  METAL,
  METAL_DARK,
  PAIR_NAMES,
  PAIR_OF,
  PALETTES,
  ROTATE_PERIOD_S,
  ROTATION,
  SCHEMES,
  SPEED_STEP,
  THRESHOLD,
  TOP_EDGE,
  V_MAX,
  WARMUP_STEPS,
  advanceFrame,
  blobsOf,
  canonicalHalf,
  createSim,
  describe,
  field,
  frame,
  pairOf,
  parseArgs,
  rotationAt,
  schemeAt,
  simOf,
  simTime,
  simulate,
  step,
} from './lamp'
import type { Glass, Segment, Sim, SimOptions } from './lamp'

const width = (row: { text: string }[]) => row.reduce((sum, seg) => sum + seg.text.length, 0)
const colours = (f: Segment[][]) =>
  new Set(f.flat().flatMap(s => [s.color, s.backgroundColor]).filter((c): c is string => c !== undefined))

// A 40-wide lamp's glass as `frame` builds it: field units are glass heights.
const GLASS: Glass = { half: v => (40 * (v < 0.66 ? 0.25 + 0.21 * (v / 0.66) : 0.46 - 0.1 * ((v - 0.66) / 0.34))) / 42, widest: (40 * 0.46) / 42 }

// The colour tests choose a moment by its clock `t` and do not care where the wax is, so
// they draw one settled lamp per look (built once) at an explicit `t`. A frame reads its
// lamp by reference: stringify it before stepping that lamp again.
const settled = new Map<string, Sim>()
const settledLamp = (look: { bubbles?: SimOptions['bubbles']; lamp?: boolean }) => {
  const key = `${look.bubbles ?? 'medium'}|${look.lamp ?? true}`
  if (!settled.has(key)) settled.set(key, createSim({ bubbles: look.bubbles, lamp: look.lamp }))
  return settled.get(key)!
}
const frameAt = (columns: number, rows: number, t: number, look: Parameters<typeof frame>[3] = {}) =>
  frame(columns, rows, settledLamp(look), look, t)

test('field exceeds the threshold at a blob centre and not far away', async () => {
  const list = blobsOf(simulate({}, 900), GLASS)
  for (const b of list) if (b.v > 0) expect(field(list, b.u, b.v) > THRESHOLD).toBe(true)
  expect(field(list, 50, 50) < THRESHOLD).toBe(true)
})

test('a frame has exactly the asked rows, each row exactly the asked width', async () => {
  for (const look of [{}, { lamp: false }, { palette: 'blue' as const }])
    for (const [w, h] of [[40, 30], [20, 12], [7, 3], [1, 1], [60, 50]] as const) {
      const f = frameAt(w, h, 12.3, look)
      expect(f.length).toBe(h)
      for (const row of f) expect(width(row)).toBe(w)
    }
})

test('runs merge: a row is a handful of segments, not one per cell', async () => {
  const f = frameAt(40, 30, 5)
  const longest = Math.max(...f.map(row => row.length))
  expect(longest < 40).toBe(true)
})

test('a frame is deterministic for a fixed lamp and changes as the lamp steps', async () => {
  const a = simulate({}, 300)
  const b = simulate({}, 300)
  const before = JSON.stringify(frame(30, 20, a))
  expect(before).toBe(JSON.stringify(frame(30, 20, b)))
  expect(before).toBe(JSON.stringify(frame(30, 20, a)))
  for (let i = 0; i < 400; i++) step(a) // ten seconds of lamp time
  expect(JSON.stringify(frame(30, 20, a)) === before).toBe(false)
})

test('words parse in any order and case, and combine', async () => {
  const p = parseArgs('  Purple SLOW nolamp ')
  expect(p).toEqual({ ok: true, options: { speed: 'slow', palette: 'purple', lamp: false }, off: false, words: 3 })
  const q = parseArgs('lamp fast', { speed: 'slow', palette: 'green', lamp: false })
  expect(q).toEqual({ ok: true, options: { speed: 'fast', palette: 'green', lamp: true }, off: false, words: 2 })
  expect(parseArgs('')).toEqual({ ok: true, options: DEFAULT_OPTIONS, off: false, words: 0 })
  expect(describe({ speed: 'slow', palette: 'purple', lamp: false })).toBe('slow · purple wax in blue · medium bubbles · no lamp outline')
})

test('an unknown word is rejected and names itself', async () => {
  expect(parseArgs('slow mauve')).toEqual({ ok: false, unknown: ['mauve'] })
})

test('off is recognised, alone or beside other words', async () => {
  const alone = parseArgs('off')
  expect(alone.ok && alone.off).toBe(true)
  const mixed = parseArgs('OFF blue')
  expect(mixed.ok && mixed.off && mixed.options.palette === 'blue').toBe(true)
})

test('each palette draws its own colours', async () => {
  const sets = PALETTES.map(palette => colours(frameAt(40, 30, 17, { palette })))
  for (let a = 0; a < sets.length; a++)
    for (let b = a + 1; b < sets.length; b++) {
      const shared = [...sets[a]!].filter(c => sets[b]!.has(c) && c !== METAL && c !== METAL_DARK)
      expect(shared.length).toBe(0)
    }
})

test('nolamp fills the pane: no metal, no empty cell', async () => {
  const f = frameAt(40, 30, 9, { lamp: false })
  for (const seg of f.flat()) {
    expect(seg.backgroundColor === undefined).toBe(false)
    expect(seg.color === METAL || seg.color === METAL_DARK || seg.backgroundColor === METAL || seg.backgroundColor === METAL_DARK).toBe(false)
  }
  const lamp = frameAt(40, 30, 9)
  expect(colours(lamp).has(METAL)).toBe(true)
})

// N normal frames and 2N slow, 4N veryslow or N/2 fast frames are the same number of
// fixed steps, so they leave the same state (and draw the same frame).
const afterFrames = (speed: 'veryslow' | 'slow' | 'normal' | 'fast', frames: number, options: SimOptions = {}) => {
  const sim = createSim(options)
  for (let i = 0; i < frames; i++) advanceFrame(sim, speed)
  return sim
}

test('speed words are steps per frame: 2N slow frames equal N normal frames, state and all', async () => {
  expect(SPEED_STEP).toEqual({ veryslow: 1, slow: 2, normal: 4, fast: 8 })
  const normal = afterFrames('normal', 40)
  for (const [speed, frames] of [['slow', 80], ['veryslow', 160], ['fast', 20]] as const) {
    const other = afterFrames(speed, frames)
    expect(JSON.stringify(other)).toBe(JSON.stringify(normal))
    expect(JSON.stringify(frame(30, 20, other))).toBe(JSON.stringify(frame(30, 20, normal)))
  }
  // Half-way there it is not the same lamp, so the equality above is not vacuous.
  expect(JSON.stringify(afterFrames('slow', 40)) === JSON.stringify(normal)).toBe(false)
  // At normal one second of lamp time passes per second of wall time (ten frames).
  expect(Math.abs(simTime(afterFrames('normal', 10)) - 1) < 1e-9).toBe(true)
})

test('a hot pool of wax always lies across the bottom of the glass', async () => {
  const sim = createSim()
  for (let k = 0; k < 80; k++) {
    for (let i = 0; i < 292; i++) step(sim) // 7.3 s of lamp time
    const list = blobsOf(sim, GLASS)
    for (const u of [-0.25, 0, 0.25]) expect(field(list, u, 0.98) > THRESHOLD).toBe(true)
  }
})

test('a moving blob is taller than it is wide; blobs are not in step', async () => {
  const sim = createSim()
  let moving = 0
  for (let k = 0; k < 100; k++) {
    for (let i = 0; i < 124; i++) step(sim) // 3.1 s
    const wax = blobsOf(sim, GLASS).filter(b => b.kind === 'wax')
    for (const b of wax)
      if (Math.abs(b.vel) > 0.02 && b.v > 0.25) {
        moving++
        expect(b.ry > b.rx).toBe(true)
      }
    expect(new Set(wax.map(b => b.v.toFixed(2))).size > 1).toBe(true)
  }
  expect(moving > 20).toBe(true)
})

// ------------------------------------------------------------ yellow, rotate

const channels = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
const cellsOf = (f: Segment[][]) =>
  f.flatMap(row => row.flatMap(seg => [...seg.text].map(() => ({ color: seg.color, bg: seg.backgroundColor }))))
const farApart = (a?: string, b?: string) =>
  (a === undefined) !== (b === undefined) || (a !== undefined && b !== undefined && channels(a).some((x, i) => Math.abs(x - channels(b)[i]!) > 4))

test('yellow parses and draws colours no other palette draws', async () => {
  expect(PALETTES.includes('yellow')).toBe(true)
  const p = parseArgs('YELLOW slow')
  expect(p).toEqual({ ok: true, options: { speed: 'slow', palette: 'yellow', lamp: true }, off: false, words: 2 })
  expect(describe({ speed: 'normal', palette: 'yellow', lamp: true })).toBe('normal speed · yellow wax in blue · medium bubbles · lamp outline')
  for (const t of [3, 17, 41]) {
    const yellow = colours(frameAt(40, 30, t, { palette: 'yellow' }))
    for (const other of PALETTES.filter(x => x !== 'yellow')) {
      const shared = [...colours(frameAt(40, 30, t, { palette: other }))].filter(c => yellow.has(c) && c !== METAL && c !== METAL_DARK)
      expect(shared.length).toBe(0)
    }
  }
  // Clearly not orange: the gold wax is far greener than orange's orange-red.
  expect(SCHEMES.yellow.mid[1] - SCHEMES.orange.mid[1] > 60).toBe(true)
})

test('rotate parses, replaces a fixed colour, and a later colour word turns it off', async () => {
  const r = parseArgs('rotate')
  expect(r.ok && r.options.rotate === true && r.words === 1).toBe(true)
  const after = parseArgs('blue rotate')
  expect(after.ok && after.options.rotate === true).toBe(true)
  const off = parseArgs('rotate pink')
  expect(off).toEqual({ ok: true, options: { speed: 'normal', palette: 'pink', lamp: true }, off: false, words: 2 })
  expect(off.ok && off.options.rotate === undefined).toBe(true)
  // Rotation set earlier is switched off by a colour word in a later command, and kept by other words.
  const on = { speed: 'normal', palette: 'orange', lamp: true, rotate: true } as const
  const kept = parseArgs('slow nolamp', on)
  expect(kept.ok && kept.options.rotate === true).toBe(true)
  const cleared = parseArgs('green', on)
  expect(cleared.ok && cleared.options.rotate === undefined && cleared.options.palette === 'green').toBe(true)
  expect(describe({ ...on, speed: 'slow' })).toBe('slow · rotating colours · medium bubbles · lamp outline')
  expect(parseArgs('rotate mauve')).toEqual({ ok: false, unknown: ['mauve'] })
})

test('rotate holds each palette, then blends into the next in order, and wraps', async () => {
  const hold = ROTATE_PERIOD_S * 0.25
  ROTATION.forEach((name, i) => {
    const r = rotationAt(i * ROTATE_PERIOD_S + hold)
    expect([r.from, r.to === ROTATION[(i + 1) % ROTATION.length], r.mix]).toEqual([name, true, 0])
    // While holding, the frame is exactly the fixed palette's frame.
    const t = i * ROTATE_PERIOD_S + hold
    expect(JSON.stringify(frameAt(40, 30, t, { palette: 'blue', rotate: true }))).toBe(JSON.stringify(frameAt(40, 30, t, { palette: name })))
  })
  expect(new Set(ROTATION).size).toBe(ROTATION.length)
  expect(rotationAt(ROTATION.length * ROTATE_PERIOD_S + hold).from).toBe(ROTATION[0])
  // Midway through a blend the colours belong to neither neighbour.
  const t = ROTATE_PERIOD_S * 0.75
  const mixed = colours(frameAt(40, 30, t, { rotate: true }))
  for (const name of [ROTATION[0]!, ROTATION[1]!])
    expect([...colours(frameAt(40, 30, t, { palette: name }))].filter(c => mixed.has(c) && c !== METAL && c !== METAL_DARK).length).toBe(0)
})

test('rotate: far-apart times use different colours, nearby times blend smoothly', async () => {
  const early = colours(frameAt(40, 30, 5, { rotate: true }))
  const late = colours(frameAt(40, 30, 5 + 2 * ROTATE_PERIOD_S, { rotate: true }))
  expect([...early].filter(c => late.has(c) && c !== METAL && c !== METAL_DARK).length).toBe(0)
  // The scheme never jumps: tiny steps move every channel by well under a rounding unit,
  // across several full cycles including the hold/blend joins and the wrap.
  const look = { palette: 'orange', rotate: true } as const
  let prev = schemeAt(look, 0)
  let worst = 0
  for (let t = 0.01; t < ROTATE_PERIOD_S * ROTATION.length * 2.2; t += 0.01) {
    const next = schemeAt(look, t)
    for (const key of ['top', 'bottom', 'edge', 'mid', 'hot'] as const)
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(next[key][c]! - prev[key][c]!))
    prev = next
  }
  expect(worst < 0.5).toBe(true)
  // And a whole frame a few milliseconds later is nearly identical, cell for cell, mid-blend.
  const t = ROTATE_PERIOD_S * 0.75
  const a = cellsOf(frameAt(40, 30, t, { rotate: true, lamp: false }))
  const b = cellsOf(frameAt(40, 30, t + 0.005, { rotate: true, lamp: false }))
  expect(a.length).toBe(b.length)
  const changed = a.filter((c, i) => farApart(c.color, b[i]!.color) || farApart(c.bg, b[i]!.bg)).length
  expect(changed / a.length < 0.02).toBe(true)
  // Yet the same time a full half-blend later is plainly another colour.
  const c = cellsOf(frameAt(40, 30, t + ROTATE_PERIOD_S * 0.25, { rotate: true, lamp: false }))
  expect(c.filter((x, i) => farApart(x.color, a[i]!.color) || farApart(x.bg, a[i]!.bg)).length / a.length > 0.5).toBe(true)
})

test('rotate is deterministic for a fixed time', async () => {
  for (const t of [0, 12.34, 52.5, 400])
    expect(JSON.stringify(frameAt(30, 20, t, { rotate: true }))).toBe(JSON.stringify(frameAt(30, 20, t, { rotate: true })))
  expect(JSON.stringify(schemeAt({ palette: 'pink', rotate: true }, 77.7))).toBe(JSON.stringify(schemeAt({ palette: 'blue', rotate: true }, 77.7)))
})

test('speed words scale the rotation pace like they scale the motion', async () => {
  // 300 frames = 30 s of wall time: fast has gone 60 s of lamp time, normal 30, slow 15, veryslow 7.5.
  const on = (speed: 'veryslow' | 'slow' | 'normal' | 'fast') => rotationAt(simTime(afterFrames(speed, 300))).from
  expect([on('veryslow'), on('slow'), on('normal'), on('fast')]).toEqual([ROTATION[0], ROTATION[0], ROTATION[1], ROTATION[2]])
  // A lamp draws its colours at its own clock: 600 slow frames and 300 normal ones are one frame under rotation too.
  const slow = afterFrames('slow', 600)
  const normal = afterFrames('normal', 300)
  expect(Math.abs(simTime(normal) - 30) < 1e-9).toBe(true)
  expect(JSON.stringify(frame(30, 20, slow, { rotate: true }))).toBe(JSON.stringify(frame(30, 20, normal, { rotate: true })))
  // And the clock is separate from the wax: a lamp restarted at a carried-over clock keeps its colours' place.
  const restarted = createSim({}, 900)
  expect(restarted.clock).toBe(900)
  expect(Math.abs(simTime(restarted) - 22.5) < 1e-9).toBe(true)
  expect(rotationAt(simTime(restarted)).from).toBe(ROTATION[0])
  expect(createSim().clock).toBe(0)
  expect(createSim().tick).toBe(WARMUP_STEPS)
})

// ------------------------------------------------------------ wax-in-liquid pairs

const WORD_PAIRS = {
  orange: 'orange-violet',
  yellow: 'yellow-blue',
  green: 'green-blue',
  purple: 'purple-blue',
  blue: 'blue-blue',
  pink: 'pink-pink',
} as const
const ALL_PAIRS = [
  ...Object.values(WORD_PAIRS),
  'turquoise-violet',
  'red-violet',
  'yellow-pink',
  'orange-yellow',
  'white-red',
  'orange-black',
  'yellow-clear',
  'green-clear',
  'purple-clear',
] as const
const CLEAR_PAIRS = ['yellow-clear', 'green-clear', 'purple-clear'] as const

type Detail = { ch: string; color?: string; bg?: string }
const detail = (f: Segment[][]): Detail[][] =>
  f.map(row => row.flatMap(seg => [...seg.text].map(ch => ({ ch, color: seg.color, bg: seg.backgroundColor }))))
const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!

test('every single colour word means its default pair, in every way it is used', async () => {
  expect([...PALETTES].sort()).toEqual(Object.keys(WORD_PAIRS).sort())
  for (const [word, pair] of Object.entries(WORD_PAIRS)) {
    const w = word as keyof typeof WORD_PAIRS
    expect(PAIR_OF[w]).toBe(pair)
    expect(pairOf(w)).toBe(pair)
    expect(schemeAt({ palette: w }, 4)).toEqual(schemeAt({ palette: pair }, 4))
    expect(SCHEMES[w]).toEqual(SCHEMES[pair])
    expect(JSON.stringify(frameAt(40, 30, 11, { palette: w }))).toBe(JSON.stringify(frameAt(40, 30, 11, { palette: pair })))
    // The word is stored as typed, so options saved by an older version keep working.
    const p = parseArgs(word)
    expect(p.ok && p.options.palette === w).toBe(true)
  }
  // The six describe themselves as their pair.
  const said = (palette: keyof typeof WORD_PAIRS) => describe({ speed: 'normal', palette, lamp: true })
  expect(said('orange')).toContain('orange wax in violet')
  expect(said('yellow')).toContain('yellow wax in blue')
  expect(said('green')).toContain('green wax in blue')
  expect(said('purple')).toContain('purple wax in blue')
  expect(said('blue')).toContain('light blue wax in dark blue')
  expect(said('pink')).toContain('pink wax in deep pink')
})

test('every named pair parses, any case, and means itself', async () => {
  expect([...PAIR_NAMES].sort()).toEqual([...ALL_PAIRS].sort())
  for (const pair of ALL_PAIRS) {
    const p = parseArgs(pair.toUpperCase(), { speed: 'slow', palette: 'green', lamp: true, rotate: true })
    expect(p).toEqual({ ok: true, options: { speed: 'slow', palette: pair, lamp: true }, off: false, words: 1 })
    expect(p.ok && p.options.rotate === undefined).toBe(true)
    expect(pairOf(pair)).toBe(pair)
  }
  expect(parseArgs('yellow-clear slow few')).toEqual({ ok: true, options: { speed: 'slow', palette: 'yellow-clear', lamp: true, bubbles: 'few' }, off: false, words: 3 })
  // Unknown combinations are refused, not guessed.
  expect(parseArgs('blue-clear')).toEqual({ ok: false, unknown: ['blue-clear'] })
  expect(parseArgs('violet-orange')).toEqual({ ok: false, unknown: ['violet-orange'] })
  // Every pair draws a frame of its own, and says something of its own.
  const frames = ALL_PAIRS.map(pair => JSON.stringify(frameAt(40, 30, 17, { palette: pair })))
  expect(new Set(frames).size).toBe(ALL_PAIRS.length)
  expect(new Set(ALL_PAIRS.map(palette => describe({ speed: 'normal', palette, lamp: true }))).size).toBe(ALL_PAIRS.length)
  // The unknown-word reply lists every pair.
  for (const pair of ALL_PAIRS) expect(HELP.includes(pair)).toBe(true)
})

test('the pairs look like their descriptions: saturated liquid, glowing at the base, wax that contrasts', async () => {
  for (const pair of ALL_PAIRS) {
    const s = SCHEMES[pair]
    expect(s.clear).toBe(pair.endsWith('-clear'))
    if (s.clear) continue
    expect(s.top.reduce((a, b) => a + b) <= s.bottom.reduce((a, b) => a + b)).toBe(true)
    // Wax stands off the liquid at both ends of the glass.
    for (const liquid of [s.top, s.bottom]) {
      expect(Math.abs(luma(s.mid) - luma(liquid)) > 40).toBe(true)
      expect(Math.abs(luma(s.hot) - luma(liquid)) > 40).toBe(true)
      expect(Math.hypot(s.edge[0] - liquid[0], s.edge[1] - liquid[1], s.edge[2] - liquid[2]) > 60).toBe(true)
    }
    // Deep saturated colour, not grey (the black liquid is the exception).
    if (pair !== 'orange-black') for (const liquid of [s.top, s.bottom]) expect((Math.max(...liquid) - Math.min(...liquid)) / Math.max(...liquid) > 0.5).toBe(true)
  }
  const bottomLuma = (pair: (typeof ALL_PAIRS)[number]) => luma(SCHEMES[pair].bottom)
  // The blue pair keeps its hue with a liquid darker than any other coloured one.
  const blue = SCHEMES['blue-blue']
  expect(blue.bottom[2] > blue.bottom[0] && blue.bottom[2] > blue.bottom[1]).toBe(true)
  expect(blue.mid[2] > blue.mid[0] && blue.mid[2] > blue.mid[1]).toBe(true)
  for (const pair of ALL_PAIRS.filter(p => !p.endsWith('-clear') && p !== 'blue-blue' && p !== 'orange-black')) expect(bottomLuma('blue-blue') < bottomLuma(pair) * 0.7).toBe(true)
  // The pink liquid is a very dark magenta/plum; the orange-yellow one is the one bright liquid.
  const pink = SCHEMES['pink-pink']
  expect(pink.bottom[0] > pink.bottom[1] && pink.bottom[2] > pink.bottom[1] && luma(pink.bottom) < 40).toBe(true)
  for (const pair of ALL_PAIRS.filter(p => !p.endsWith('-clear') && p !== 'orange-yellow')) expect(bottomLuma('orange-yellow') > bottomLuma(pair) * 2).toBe(true)
})

// ------------------------------------------------------------ clear liquid

test('a clear liquid draws no background: half-blocks carry the wax, empty cells carry nothing', async () => {
  const kinds = { both: 0, top: 0, bottom: 0, neither: 0 }
  for (const pair of CLEAR_PAIRS)
    for (const steps of [100, 700, 1700]) {
      const [w, h] = [40, 30]
      const sim = simulate({ lamp: false }, steps)
      const f = frame(w, h, sim, { palette: pair, lamp: false })
      const cells = detail(f)
      // The pixels as the renderer sees them: nolamp is a plain body, glass heights are rows * 2.
      const glassH = h * 2
      const cx = (w - 1) / 2
      const list = blobsOf(sim, { half: () => w / 2 / glassH, widest: w / 2 / glassH })
      const wax = (x: number, y: number) => field(list, (x - cx) / glassH, y / glassH) >= THRESHOLD
      expect(cells.length).toBe(h)
      cells.forEach((row, r) =>
        row.forEach((c, x) => {
          const top = wax(x, r * 2)
          const bottom = wax(x, r * 2 + 1)
          if (!top && !bottom) {
            kinds.neither++
            expect(c).toEqual({ ch: ' ', color: undefined, bg: undefined })
          } else if (top && !bottom) {
            kinds.top++
            expect(c.ch).toBe('▀')
            expect(c.color !== undefined && c.bg === undefined).toBe(true)
          } else if (!top && bottom) {
            kinds.bottom++
            expect(c.ch).toBe('▄')
            expect(c.color !== undefined && c.bg === undefined).toBe(true)
          } else {
            kinds.both++
            expect(c.bg !== undefined).toBe(true)
          }
        }),
      )
    }
  // Not vacuous: all four kinds of cell occurred.
  expect(Object.values(kinds).every(n => n > 0)).toBe(true)
})

test('a clear frame merges runs with "no colour" as its own value, and still has exact width', async () => {
  for (const pair of CLEAR_PAIRS)
    for (const lamp of [true, false]) {
      const f = frameAt(40, 30, 23, { palette: pair, lamp })
      expect(f.length).toBe(30)
      for (const row of f) {
        expect(width(row)).toBe(40)
        expect(row.length < 40).toBe(true)
        // Adjacent runs always differ somewhere (else they would have merged),
        // and an empty run is one glyph repeated.
        row.forEach((seg, i) => {
          const prev = row[i - 1]
          if (prev) expect(prev.color !== seg.color || prev.backgroundColor !== seg.backgroundColor || prev.text[0] !== seg.text[0]).toBe(true)
          expect(new Set(seg.text).size).toBe(1)
        })
      }
    }
})

test('a clear lamp keeps its outline visible: metal cap and base, and a glass rim down both sides', async () => {
  for (const pair of CLEAR_PAIRS) {
    const lamp = frameAt(40, 30, 9, { palette: pair })
    expect(colours(lamp).has(METAL)).toBe(true)
    const rim = detail(lamp).flat().filter(c => c.color === GLASS_RIM || c.bg === GLASS_RIM).length
    expect(rim > 30).toBe(true)
    // Only a clear liquid needs the rim, and the rim is nothing the plain body draws.
    expect(colours(frameAt(40, 30, 9, { palette: 'yellow-blue' })).has(GLASS_RIM)).toBe(false)
    expect(colours(frameAt(40, 30, 9, { palette: pair, lamp: false })).has(GLASS_RIM)).toBe(false)
  }
})

// ------------------------------------------------------------ rotate, in pairs

test('rotate cycles the eight pairs in order, never a clear, bright or black one', async () => {
  expect(ROTATION).toEqual(['orange-violet', 'yellow-blue', 'green-blue', 'turquoise-violet', 'purple-blue', 'pink-pink', 'red-violet', 'blue-blue'])
  for (const pair of ROTATION) {
    expect(PAIR_NAMES.includes(pair)).toBe(true)
    expect(pair.endsWith('-clear') || pair === 'orange-yellow' || pair === 'white-red' || pair === 'orange-black').toBe(false)
  }
  for (let t = 0; t < ROTATE_PERIOD_S * ROTATION.length * 2; t += 1.3) {
    const r = rotationAt(t)
    expect(ROTATION.includes(r.from) && ROTATION.includes(r.to)).toBe(true)
    expect(schemeAt({ palette: 'yellow-clear', rotate: true }, t).clear).toBe(false)
  }
  // Every cell of a rotating nolamp frame has a background: there is never a clear liquid in it.
  for (const t of [0, 10, 22, 37, 100, 160])
    for (const row of detail(frameAt(30, 20, t, { rotate: true, lamp: false, palette: 'green-clear' }))) for (const c of row) expect(c.bg !== undefined).toBe(true)
})

test('rotate blends the liquid with the wax, so the background always matches its wax', async () => {
  ROTATION.forEach((from, i) => {
    const to = ROTATION[(i + 1) % ROTATION.length]!
    const a = SCHEMES[from]
    const b = SCHEMES[to]
    // Held: wax and liquid are exactly the pair's.
    const held = schemeAt({ palette: 'blue', rotate: true }, i * ROTATE_PERIOD_S + ROTATE_PERIOD_S * 0.25)
    for (const key of ['top', 'bottom', 'edge', 'mid', 'hot'] as const) expect(held[key]).toEqual(a[key])
    // Midway through the blend (smoothstep of one half is one half): both are the midpoint.
    const mid = schemeAt({ palette: 'blue', rotate: true }, i * ROTATE_PERIOD_S + ROTATE_PERIOD_S * 0.75)
    for (const key of ['top', 'bottom', 'edge', 'mid', 'hot'] as const)
      for (let c = 0; c < 3; c++) expect(Math.abs(mid[key][c]! - (a[key][c]! + b[key][c]!) / 2) < 1e-9).toBe(true)
    // A quarter of the way into the blend, wax and liquid are at the same fraction of their journeys.
    const q = schemeAt({ palette: 'blue', rotate: true }, i * ROTATE_PERIOD_S + ROTATE_PERIOD_S * 0.625)
    const fraction = (key: 'top' | 'bottom' | 'edge' | 'mid' | 'hot') => {
      let best = 0
      let f = 0
      for (let c = 0; c < 3; c++) {
        const d = b[key][c]! - a[key][c]!
        if (Math.abs(d) > Math.abs(best)) {
          best = d
          f = (q[key][c]! - a[key][c]!) / d
        }
      }
      return Math.abs(best) < 4 ? undefined : f
    }
    const fractions = (['top', 'bottom', 'edge', 'mid', 'hot'] as const).map(fraction).filter((f): f is number => f !== undefined)
    expect(fractions.length > 2).toBe(true)
    for (const f of fractions) expect(Math.abs(f - fractions[0]!) < 1e-9).toBe(true)
  })
  // The liquid really moves: the step from orange-violet to yellow-blue ends on another liquid.
  const start = schemeAt({ palette: 'blue', rotate: true }, 0)
  const end = schemeAt({ palette: 'blue', rotate: true }, ROTATE_PERIOD_S)
  expect(start.bottom).toEqual(SCHEMES['orange-violet'].bottom)
  expect(end.bottom).toEqual(SCHEMES['yellow-blue'].bottom)
  expect(JSON.stringify(start.bottom) === JSON.stringify(end.bottom)).toBe(false)
  // And in a frame: halfway through, the liquid cells are neither neighbour's liquid.
  const t = ROTATE_PERIOD_S * 0.75
  const liquidOf = (palette: (typeof ALL_PAIRS)[number]) => new Set(detail(frameAt(30, 20, t, { palette, lamp: false })).flat().filter(c => c.ch === ' ' && c.bg !== undefined).map(c => c.bg))
  const mixedLiquid = detail(frameAt(30, 20, t, { rotate: true, lamp: false })).flat().filter(c => c.ch === ' ' && c.bg !== undefined).map(c => c.bg)
  expect(mixedLiquid.length > 0).toBe(true)
  const neighbours = new Set([...liquidOf('orange-violet'), ...liquidOf('yellow-blue')])
  expect(mixedLiquid.filter(c => neighbours.has(c)).length).toBe(0)
})

// ------------------------------------------------------------ bubble count

test('few, medium and many words parse, combine, win by order, and are named in the reply', async () => {
  expect(parseArgs('few')).toEqual({ ok: true, options: { speed: 'normal', palette: 'orange', lamp: true, bubbles: 'few' }, off: false, words: 1 })
  const p = parseArgs('MANY slow')
  expect(p.ok && p.options.bubbles === 'many' && p.options.speed === 'slow').toBe(true)
  const later = parseArgs('few medium many few')
  expect(later.ok && later.options.bubbles === 'few').toBe(true)
  // Kept by other words; medium is a word of its own (normal is the speed).
  const kept = parseArgs('green', { speed: 'fast', palette: 'blue', lamp: false, bubbles: 'many' })
  expect(kept.ok && kept.options.bubbles === 'many' && kept.options.palette === 'green').toBe(true)
  const back = parseArgs('medium', { speed: 'fast', palette: 'blue', lamp: false, bubbles: 'many' })
  expect(back.ok && back.options.bubbles === 'medium').toBe(true)
  expect('bubbles' in DEFAULT_OPTIONS).toBe(false)
  expect(describe({ speed: 'slow', palette: 'yellow', lamp: true, bubbles: 'few' })).toBe('slow · yellow wax in blue · few big bubbles · lamp outline')
  expect(describe({ speed: 'fast', palette: 'white-red', lamp: false, bubbles: 'many' })).toBe('fast · white wax in red · many small bubbles · no lamp outline')
  expect(describe({ speed: 'normal', palette: 'purple-clear', lamp: true })).toBe('normal speed · purple wax in clear liquid · medium bubbles · lamp outline')
})


const waxOf = (sim: Sim) => blobsOf(sim, GLASS).filter(b => b.kind === 'wax')

test('few has fewer, larger blobs than medium, which has fewer than many', async () => {
  for (const steps of [0, 308, 1240, 5140]) {
    const few = simulate({ bubbles: 'few' }, steps)
    const medium = simulate({}, steps)
    const many = simulate({ bubbles: 'many' }, steps)
    expect(few.bodies.length).toBe(BUBBLES.few.count)
    expect(medium.bodies.length).toBe(5)
    expect(simulate({ bubbles: 'medium' }, steps).bodies.length).toBe(5)
    expect(many.bodies.length).toBe(BUBBLES.many.count)
    const [wf, wm, wn] = [waxOf(few), waxOf(medium), waxOf(many)] as const
    expect([wf.length, wm.length, wn.length]).toEqual([3, 5, 9])
    const mean = (list: { rx: number }[]) => list.reduce((a, b) => a + b.rx, 0) / list.length
    expect(mean(wf) > mean(wm) && mean(wm) > mean(wn)).toBe(true)
    // Few is a lot of wax in a few thick blobs.
    const area = (list: { rx: number; ry: number }[]) => list.reduce((a, b) => a + b.rx * b.ry, 0)
    expect(area(wf) > area(wm)).toBe(true)
  }
  expect(BUBBLES.few.count < BUBBLES.medium.count && BUBBLES.medium.count < BUBBLES.many.count).toBe(true)
  // The three really draw differently.
  const frames = (['few', 'medium', 'many'] as const).map(bubbles => JSON.stringify(frame(40, 30, simulate({ bubbles }, 800), { bubbles })))
  expect(new Set(frames).size).toBe(3)
  expect(JSON.stringify(frame(40, 30, simulate({ bubbles: 'medium' }, 800), { bubbles: 'medium' }))).toBe(JSON.stringify(frame(40, 30, simulate({}, 800))))
})

// Mean vertical speed over `steps` steps, every blob, every step.
const meanSpeed = (options: SimOptions, steps: number) => {
  const sim = createSim(options)
  let sum = 0
  let n = 0
  for (let i = 0; i < steps; i++) {
    step(sim)
    for (const b of sim.bodies) {
      sum += Math.abs(b.vy)
      n++
    }
  }
  return sum / n
}

test('heavier blobs move a bit more slowly, smaller ones a bit more lively, but only modestly', async () => {
  const few = meanSpeed({ bubbles: 'few' }, 12000)
  const medium = meanSpeed({}, 12000)
  const many = meanSpeed({ bubbles: 'many' }, 12000)
  expect(few < medium && medium < many).toBe(true)
  expect(few / medium > 0.4 && many / medium < 1.6).toBe(true)
})

test('the pool at the base and the layer at the top are there in all three bubble counts', async () => {
  for (const bubbles of ['few', 'medium', 'many'] as const) {
    const sim = createSim({ bubbles })
    let topRowWax = 0
    for (let k = 0; k < 80; k++) {
      for (let i = 0; i < 292; i++) step(sim)
      const list = blobsOf(sim, GLASS)
      expect(list.filter(b => b.kind === 'pool').length).toBe(3)
      const cap = list.filter(b => b.kind === 'cap')
      expect(cap.length).toBe(1)
      expect(field(list, cap[0]!.u, cap[0]!.v) > THRESHOLD).toBe(true)
      for (const u of [-0.25, 0, 0.25]) expect(field(list, u, 0.98) > THRESHOLD).toBe(true)
      // On screen: the last glass row is wax across its middle at every sampled moment...
      const rows = detail(frame(40, 30, sim, { palette: 'yellow-clear', lamp: false, bubbles }))
      for (const c of rows[rows.length - 1]!.slice(12, 28)) expect(c.color !== undefined || c.bg !== undefined).toBe(true)
      // ...and the thin top layer's lower edge breathes in and out of the first row.
      if (rows[0]!.some(c => c.color !== undefined || c.bg !== undefined)) topRowWax++
    }
    expect(topRowWax > 0).toBe(true)
  }
})

test('frames have exactly the asked rows and widths for every bubble count, outline and size', async () => {
  for (const bubbles of ['few', 'medium', 'many'] as const)
    for (const lamp of [true, false]) {
      const sim = simulate({ bubbles, lamp }, 500)
      for (const [w, h] of [[40, 30], [20, 12], [7, 3], [1, 1], [60, 50], [14, 10], [90, 6]] as const) {
        const f = frame(w, h, sim, { bubbles, lamp })
        expect(f.length).toBe(h)
        for (const row of f) expect(width(row)).toBe(w)
      }
    }
})

// ------------------------------------------------------------ the simulation

// The state of a lamp, to the last digit: any two runs of the same steps must agree on it.
const stateOf = (sim: Sim) => JSON.stringify(sim)

test('determinism: two runs of the same steps give identical states and frames, whatever else ran between', async () => {
  for (const bubbles of ['few', 'medium', 'many'] as const)
    for (const lamp of [true, false]) {
      const a = simulate({ bubbles, lamp }, 3000)
      // Another lamp stepped and drawn in between (a module-level clock or generator would show).
      const other = simulate({ bubbles: 'many' }, 700)
      expect(JSON.stringify(frame(30, 20, other))).toBe(JSON.stringify(frame(30, 20, other)))
      const b = simulate({ bubbles, lamp }, 3000)
      expect(stateOf(a)).toBe(stateOf(b))
      expect(JSON.stringify(frame(34, 22, a, { bubbles, lamp }))).toBe(JSON.stringify(frame(34, 22, b, { bubbles, lamp })))
      // The same steps taken in separate batches land on the same state.
      const c = createSim({ bubbles, lamp })
      for (let i = 0; i < 3000; i++) step(c)
      expect(stateOf(a)).toBe(stateOf(c))
    }
  // Different blob counts are different lamps, and a lamp moves.
  expect(stateOf(simulate({}, 100)) === stateOf(simulate({ bubbles: 'few' }, 100))).toBe(false)
  expect(stateOf(simulate({}, 100)) === stateOf(simulate({}, 101))).toBe(false)
})

test('a new lamp is already settled: wax is spread through the glass, not all in the pool, and not all alike', async () => {
  for (const bubbles of ['few', 'medium', 'many'] as const) {
    const sim = createSim({ bubbles })
    expect(sim.bodies.filter(b => b.y < 0.85).length >= sim.bodies.length / 2).toBe(true)
    expect(new Set(sim.bodies.map(b => b.y.toFixed(1))).size >= 2).toBe(true)
    expect(new Set(sim.bodies.map(b => b.T.toFixed(2))).size >= 2).toBe(true)
  }
})

// Two blobs side by side, one warm (it rises) and one cooled (it sinks).
const pairOfBlobs = (interact: boolean) =>
  simOf(
    [
      // They pass each other mid-glass, so neither reaches the cap or the floor within the run:
      // a blob pinned at the floor would look the same with or without its neighbour.
      { id: 1, x: -0.11, y: 0.62, vx: 0, vy: 0, T: 0.7, r: 0.1 },
      { id: 2, x: 0.11, y: 0.4, vx: 0, vy: 0, T: 0.2, r: 0.1 },
    ],
    { interact },
  )

test('heat and buoyancy: warm wax rises, cooled wax sinks', async () => {
  const warm = simOf([{ id: 1, x: 0, y: 0.6, vx: 0, vy: 0, T: 0.8, r: 0.1 }])
  const cool = simOf([{ id: 1, x: 0, y: 0.5, vx: 0, vy: 0, T: 0.1, r: 0.1 }])
  for (let i = 0; i < 120; i++) {
    step(warm)
    step(cool)
  }
  expect(warm.bodies[0]!.vy < -0.02 && warm.bodies[0]!.y < 0.55).toBe(true)
  expect(cool.bodies[0]!.vy > 0.02 && cool.bodies[0]!.y > 0.55).toBe(true)
})

test('interaction counterfactual: a rising and a sinking blob side by side bend each other; with it off they are as if alone', async () => {
  const on = pairOfBlobs(true)
  const off = pairOfBlobs(false)
  const aloneRising = simOf([pairOfBlobs(true).bodies[0]!])
  const aloneSinking = simOf([pairOfBlobs(true).bodies[1]!])
  for (let i = 0; i < 200; i++) {
    step(on)
    step(off)
    step(aloneRising)
    step(aloneSinking)
  }
  const [riseOn, sinkOn] = on.bodies as [Sim['bodies'][number], Sim['bodies'][number]]
  const [riseOff, sinkOff] = off.bodies as [Sim['bodies'][number], Sim['bodies'][number]]
  // Interaction off is no interaction: each blob goes exactly where it goes alone.
  expect(JSON.stringify(riseOff)).toBe(JSON.stringify(aloneRising.bodies[0]))
  expect(JSON.stringify(sinkOff)).toBe(JSON.stringify(aloneSinking.bodies[0]))
  // They really are a rising and a sinking blob, alone.
  expect(riseOff.y < 0.4 && sinkOff.y > 0.8).toBe(true)
  // With it on, each holds the other back: the riser rises less far and the sinker sinks less far...
  expect(riseOn.y - riseOff.y > 0.03).toBe(true)
  expect(sinkOff.y - sinkOn.y > 0.03).toBe(true)
  // ...and each ends measurably elsewhere than it would alone.
  expect(Math.hypot(riseOn.x - riseOff.x, riseOn.y - riseOff.y) > 0.04).toBe(true)
  expect(Math.hypot(sinkOn.x - sinkOff.x, sinkOn.y - sinkOff.y) > 0.04).toBe(true)
})

test('blobs in touch trade heat: a warm and a cool blob side by side end closer in temperature than alone', async () => {
  const touching = (interact: boolean) =>
    simOf(
      [
        { id: 1, x: -0.1, y: 0.5, vx: 0, vy: 0, T: 0.7, r: 0.1 },
        { id: 2, x: 0.1, y: 0.5, vx: 0, vy: 0, T: 0.3, r: 0.1 },
      ],
      { interact },
    )
  const on = touching(true)
  const off = touching(false)
  for (let i = 0; i < 80; i++) {
    step(on)
    step(off)
  }
  const gap = (sim: Sim) => Math.abs(sim.bodies[0]!.T - sim.bodies[1]!.T)
  expect(gap(on) < gap(off) - 0.005).toBe(true)
})

test('hovering: across a long run some blob lingers mid-glass, all but still', async () => {
  const sim = createSim()
  const run = new Map<number, number>()
  let longest = 0
  for (let i = 0; i < 24000; i++) {
    step(sim)
    for (const b of sim.bodies) {
      const still = b.y > 0.25 && b.y < 0.75 && Math.abs(b.vy) < 0.004
      const n = still ? (run.get(b.id) ?? 0) + 1 : 0
      run.set(b.id, n)
      longest = Math.max(longest, n)
    }
  }
  // At least three seconds of lamp time.
  expect(longest * DT >= 3).toBe(true)
})

test('the motion is not only up and down: blobs drift sideways while travelling much of the glass', async () => {
  const sim = createSim()
  let sx = 0
  let sy = 0
  const lo = sim.bodies.map(b => b.y)
  const hi = sim.bodies.map(b => b.y)
  const left = sim.bodies.map(b => b.x)
  const right = sim.bodies.map(b => b.x)
  for (let i = 0; i < 24000; i++) {
    step(sim)
    sim.bodies.forEach((b, k) => {
      sx += Math.abs(b.vx)
      sy += Math.abs(b.vy)
      lo[k] = Math.min(lo[k]!, b.y)
      hi[k] = Math.max(hi[k]!, b.y)
      left[k] = Math.min(left[k]!, b.x)
      right[k] = Math.max(right[k]!, b.x)
    })
  }
  // Sideways motion is real but secondary: a lamp's wax mostly rises and sinks. Above about a
  // third of vertical it reads as blobs swimming sideways on their own.
  expect(sx / sy > 0.1).toBe(true)
  expect(sx / sy < 0.35).toBe(true)
  // Every blob travels most of the glass's height and some way across it.
  sim.bodies.forEach((_, k) => {
    expect(hi[k]! - lo[k]! > 0.5).toBe(true)
    expect(right[k]! - left[k]! > 0.08).toBe(true)
  })
})

test('a blob that is barely rising or sinking does not wander sideways on its own', async () => {
  const sim = createSim()
  let still = 0
  let stillX = 0
  for (let i = 0; i < 24000; i++) {
    step(sim)
    for (const b of sim.bodies)
      if (Math.abs(b.vy) < 0.003) {
        still++
        stillX += Math.abs(b.vx)
      }
  }
  expect(still > 1000).toBe(true)
  expect(stillX / still < 0.01).toBe(true)
})

test('stability: 20,000 steps, every blob inside the walls, speeds bounded, nothing NaN, never frozen', async () => {
  for (const bubbles of ['few', 'medium', 'many'] as const)
    for (const lamp of [true, false]) {
      const sim = createSim({ bubbles, lamp })
      // Violations are counted, not asserted per step: a hundred thousand `expect`s outrun the test's time limit.
      const broken = { notFinite: 0, outsideWalls: 0, outsideHeight: 0, tooFast: 0, badHeat: 0 }
      let late = 0
      let n = 0
      for (let i = 0; i < 20000; i++) {
        step(sim)
        for (const b of sim.bodies) {
          if (![b.x, b.y, b.vx, b.vy, b.T, b.r].every(Number.isFinite)) broken.notFinite++
          if (!(Math.abs(b.x) <= canonicalHalf(lamp, b.y) - 0.85 * b.r + 1e-9)) broken.outsideWalls++
          if (!(b.y >= TOP_EDGE + 0.9 * b.r - 1e-9 && b.y <= FLOOR + 1e-9)) broken.outsideHeight++
          if (!(Math.hypot(b.vx, b.vy) <= V_MAX + 1e-9)) broken.tooFast++
          if (!(b.T >= 0 && b.T <= 1)) broken.badHeat++
          if (i >= 15000) {
            late += Math.hypot(b.vx, b.vy)
            n++
          }
        }
      }
      expect(broken).toEqual({ notFinite: 0, outsideWalls: 0, outsideHeight: 0, tooFast: 0, badHeat: 0 })
      // Still moving at the end: the mean speed over the last 5,000 steps is well above a rest.
      expect(late / n > 0.01).toBe(true)
    }
})

test('a blob never sticks to a wall: pushed at one, it slides along it', async () => {
  const sim = simOf([{ id: 3, x: 0.2, y: 0.5, vx: 0.1, vy: 0.04, T: 0.45, r: 0.1 }], { lamp: true })
  let moved = 0
  for (let i = 0; i < 80; i++) {
    const before = sim.bodies[0]!.y
    step(sim)
    moved += Math.abs(sim.bodies[0]!.y - before)
    expect(Math.abs(sim.bodies[0]!.x) <= canonicalHalf(true, sim.bodies[0]!.y) - 0.085 + 1e-9).toBe(true)
  }
  expect(moved > 0.02).toBe(true)
})

// How far up a blob's top edge gets before it turns back, and how in step blobs move.
const rhythm = (bubbles: 'few' | 'medium' | 'many') => {
  const sim = createSim({ bubbles })
  const vys: number[][] = sim.bodies.map(() => [])
  const prev = sim.bodies.map(b => b.vy)
  const turns: number[] = []
  for (let i = 0; i < 24000; i++) {
    step(sim)
    sim.bodies.forEach((b, k) => {
      if (i % 8 === 0) vys[k]!.push(b.vy)
      if (prev[k]! < -0.004 && b.vy >= 0) turns.push(b.y - b.r)
      if (Math.abs(b.vy) > 0.004 || b.vy >= 0) prev[k] = b.vy
    })
  }
  const corr = (a: number[], c: number[]) => {
    const ma = a.reduce((s, x) => s + x, 0) / a.length
    const mc = c.reduce((s, x) => s + x, 0) / c.length
    let num = 0
    let da = 0
    let dc = 0
    for (let i = 0; i < a.length; i++) {
      num += (a[i]! - ma) * (c[i]! - mc)
      da += (a[i]! - ma) ** 2
      dc += (c[i]! - mc) ** 2
    }
    return num / Math.sqrt(da * dc)
  }
  const pairs: number[] = []
  for (let i = 0; i < vys.length; i++) for (let j = i + 1; j < vys.length; j++) pairs.push(corr(vys[i]!, vys[j]!))
  // Turns fall in two groups, under the cap and mid-glass (a trip that gives up), so a median
  // flips between them on any small change; the share that reaches the cap does not.
  return { reach: turns.filter(y => y < 0.12).length / turns.length, meanCorr: pairs.reduce((s, x) => s + x, 0) / pairs.length }
}

test('rising wax reaches up under the cap before it turns back', async () => {
  expect(rhythm('medium').reach > 0.38).toBe(true)
})

test('blobs keep their own rhythm instead of rising and sinking in step', async () => {
  for (const bubbles of ['few', 'medium'] as const) expect(rhythm(bubbles).meanCorr < 0.5).toBe(true)
})

test('a hot blob meeting the cap settles against it instead of being thrown back', async () => {
  const sim = simOf([{ id: 3, x: 0, y: 0.45, vx: 0, vy: 0, T: 0.85, r: 0.07 }])
  let arrived = -1
  let rebound = 0
  for (let i = 0; i < 400; i++) {
    step(sim)
    const b = sim.bodies[0]!
    if (arrived < 0 && b.y - b.r < 0.05) arrived = i
    if (arrived >= 0 && i - arrived < 80 && b.T > 0.6) rebound = Math.max(rebound, b.vy)
  }
  expect(arrived >= 0).toBe(true)
  // Still far warmer than the liquid, it must not head back down faster than a slow settle.
  expect(rebound < 0.025).toBe(true)
})

test('a blob does not suddenly contract when it reaches the cap', async () => {
  for (const bubbles of ['medium', 'many'] as const) {
    const sim = createSim({ bubbles })
    const hist: number[][] = sim.bodies.map(() => [])
    let worst = 0
    for (let i = 0; i < 24000; i++) {
      step(sim)
      blobsOf(sim, GLASS)
        .filter(b => b.kind === 'wax')
        .forEach((b, k) => {
          const h = hist[k]!
          h.push(b.ry)
          if (h.length > 10) h.shift()
          // Within a quarter of a second, near the cap, a blob's height must not fall by a quarter.
          if (h.length === 10 && b.v - b.ry < 0.1) worst = Math.max(worst, 1 - h[9]! / h[0]!)
        })
    }
    expect(worst < 0.25).toBe(true)
  }
})

test('rotating is read as rotate, and rotate-clear rotates the wax over a clear liquid', async () => {
  const a = parseArgs('rotating')
  expect(a.ok && a.options.rotate === true).toBe(true)
  const b = parseArgs('rotate-clear few')
  expect(b.ok && b.options.rotate === 'clear').toBe(true)
  expect(b.ok && describe(b.options).includes('rotating wax in clear liquid')).toBe(true)
  const c = parseArgs('rotating-clear')
  expect(c.ok && c.options.rotate === 'clear').toBe(true)
  // A fixed colour word after it turns rotation off, as with rotate.
  const d = parseArgs('rotate-clear green')
  expect(d.ok && d.options.rotate === undefined && d.options.palette === 'green').toBe(true)
})

test('rotate-clear keeps the liquid clear while the wax colour moves through the rotation', async () => {
  const look = { palette: 'orange' as const, rotate: 'clear' as const }
  const early = schemeAt(look, 0)
  const later = schemeAt(look, ROTATE_PERIOD_S * 2.2)
  expect(early.clear && later.clear).toBe(true)
  expect(JSON.stringify(early.mid) !== JSON.stringify(later.mid)).toBe(true)
  // The wax follows the same rotation as rotate does.
  expect(JSON.stringify(early.mid)).toBe(JSON.stringify(schemeAt({ palette: 'orange', rotate: true }, 0).mid))
})
