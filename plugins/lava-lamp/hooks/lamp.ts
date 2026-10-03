// Pure lava-lamp maths: a small physics simulation of wax blobs in a heated
// glass, drawn as a metaball field sampled on half-block pixels (two square-ish
// pixels per terminal cell), shaded, then packed into runs.
//
// The motion is simulated, not scripted. Each blob carries a position, a
// velocity and a temperature. The bulb warms wax near the base and the top
// cools it; warm wax is buoyant and rises, cooled wax sinks, and wax whose
// temperature has settled near the liquid's hangs mid-glass. The liquid is thick
// (strong drag), so everything is slow and smooth. Blobs also act on each other,
// each force fading to nothing a few radii out: a moving blob drags a neighbour
// toward its own velocity (entrainment), wax clings weakly to wax while a soft
// core keeps blobs apart, and blobs in touch trade heat.
//
// The simulation advances in fixed steps of DT seconds. A speed word only changes
// how many steps run per drawn frame, so one seed traces one path at every speed.
//
// Colour is a wax-in-liquid pair as sold for real lamps: a wax gradient (edge,
// mid, hot core) over a liquid gradient (top to bottom, brighter at the bulb).
// A `clear` liquid has no colour of its own, so the terminal background shows.

import type { LavaBubbles, LavaColourWord, LavaOptions, LavaPair, LavaPalette, LavaSpeed } from '../types'

// An ellipse of influence: centre (u across, v down) and radii, all in
// glass-height units. `vel` is the vertical speed (glass heights per second,
// positive downwards).
export type Blob = { u: number; v: number; rx: number; ry: number; vel: number; kind: 'pool' | 'cap' | 'wax' }

// One run of identical cells within a row: `text` is `text.length` cells wide.
// An absent colour means the terminal's own (a distinct value when runs merge).
export type Segment = { text: string; color?: string; backgroundColor?: string }

// The glass in field units: its half-width at depth v, and the widest half-width.
export type Glass = { half: (v: number) => number; widest: number }

export const THRESHOLD = 1

// ---------------------------------------------------------------- colour tables

type RGB = [number, number, number]

// `clear`: the liquid draws no background; `top` and `bottom` are then unused.
type Scheme = { top: RGB; bottom: RGB; edge: RGB; mid: RGB; hot: RGB; clear: boolean }

type Wax = { edge: RGB; mid: RGB; hot: RGB }
type Liquid = { top: RGB; bottom: RGB }

const WAX = {
  orange: { edge: [150, 18, 20], mid: [235, 90, 20], hot: [255, 214, 90] },
  // A deeper orange, so it stands out from the light yellow liquid it floats in.
  orangeDeep: { edge: [128, 26, 6], mid: [206, 62, 8], hot: [238, 110, 22] },
  // Amber at the rim, gold between, pale lemon at the core.
  yellow: { edge: [176, 104, 0], mid: [244, 184, 16], hot: [255, 250, 170] },
  green: { edge: [22, 112, 34], mid: [96, 204, 44], hot: [224, 255, 128] },
  purple: { edge: [118, 34, 156], mid: [172, 64, 214], hot: [244, 178, 255] },
  lightBlue: { edge: [44, 112, 206], mid: [104, 186, 252], hot: [216, 246, 255] },
  pink: { edge: [164, 22, 92], mid: [246, 84, 152], hot: [255, 204, 196] },
  turquoise: { edge: [8, 118, 128], mid: [38, 212, 198], hot: [198, 255, 244] },
  red: { edge: [118, 8, 20], mid: [240, 48, 52], hot: [255, 150, 118] },
  white: { edge: [168, 160, 172], mid: [232, 228, 236], hot: [255, 255, 255] },
} satisfies Record<string, Wax>

// Deep, saturated liquids; the bottom is the brighter end (the bulb's glow).
const VIOLET: Liquid = { top: [50, 12, 100], bottom: [78, 22, 144] }

const scheme = (wax: Wax, liquid: Liquid | undefined): Scheme => ({
  top: liquid?.top ?? [0, 0, 0],
  bottom: liquid?.bottom ?? [0, 0, 0],
  edge: wax.edge,
  mid: wax.mid,
  hot: wax.hot,
  clear: liquid === undefined,
})

// Every named pair: the words that mean exactly it. `label` is how a reply says it.
// Pairs that share a liquid word are tuned to their wax (a royal blue under
// yellow, a teal under green), as real lamps' blues differ.
const PAIR_TABLE: Record<LavaPair, { label: string; scheme: Scheme }> = {
  'orange-violet': { label: 'orange wax in violet', scheme: scheme(WAX.orange, VIOLET) },
  'yellow-blue': { label: 'yellow wax in blue', scheme: scheme(WAX.yellow, { top: [10, 24, 108], bottom: [16, 46, 160] }) },
  'green-blue': { label: 'green wax in blue', scheme: scheme(WAX.green, { top: [4, 40, 92], bottom: [8, 68, 132] }) },
  'purple-blue': { label: 'purple wax in blue', scheme: scheme(WAX.purple, { top: [10, 16, 84], bottom: [16, 30, 128] }) },
  // Same hue as its wax, the liquid very very dark.
  'blue-blue': { label: 'light blue wax in dark blue', scheme: scheme(WAX.lightBlue, { top: [3, 6, 20], bottom: [6, 15, 46] }) },
  // A very dark plum-magenta, so the pink wax keeps its contrast.
  'pink-pink': { label: 'pink wax in deep pink', scheme: scheme(WAX.pink, { top: [40, 4, 34], bottom: [68, 8, 54] }) },
  'turquoise-violet': { label: 'turquoise wax in violet', scheme: scheme(WAX.turquoise, VIOLET) },
  'red-violet': { label: 'red wax in violet', scheme: scheme(WAX.red, { top: [32, 10, 88], bottom: [52, 18, 128] }) },
  'yellow-pink': { label: 'yellow wax in pink', scheme: scheme(WAX.yellow, { top: [96, 8, 62], bottom: [142, 16, 94] }) },
  // The one bright background: a light, luminous liquid.
  'orange-yellow': { label: 'orange wax in yellow', scheme: scheme(WAX.orangeDeep, { top: [244, 214, 84], bottom: [255, 232, 122] }) },
  'white-red': { label: 'white wax in red', scheme: scheme(WAX.white, { top: [108, 6, 12], bottom: [158, 10, 20] }) },
  'orange-black': { label: 'orange wax in black', scheme: scheme(WAX.orange, { top: [4, 3, 6], bottom: [16, 9, 9] }) },
  'yellow-clear': { label: 'yellow wax in clear liquid', scheme: scheme(WAX.yellow, undefined) },
  'green-clear': { label: 'green wax in clear liquid', scheme: scheme(WAX.green, undefined) },
  'purple-clear': { label: 'purple wax in clear liquid', scheme: scheme(WAX.purple, undefined) },
}

export const PAIR_NAMES = Object.keys(PAIR_TABLE) as LavaPair[]

// What each single colour word means. A saved option keeps the word as typed
// and is resolved here at draw time, so options saved earlier stay valid.
export const PAIR_OF: Record<LavaColourWord, LavaPair> = {
  orange: 'orange-violet',
  yellow: 'yellow-blue',
  green: 'green-blue',
  purple: 'purple-blue',
  blue: 'blue-blue',
  pink: 'pink-pink',
}

// The single colour words, then the same words and every pair as schemes.
export const PALETTES: LavaColourWord[] = ['orange', 'purple', 'green', 'blue', 'pink', 'yellow']

export const SCHEMES = Object.fromEntries([
  ...PAIR_NAMES.map(name => [name, PAIR_TABLE[name].scheme]),
  ...PALETTES.map(word => [word, PAIR_TABLE[PAIR_OF[word]].scheme]),
]) as Record<LavaPalette, Scheme>

// The pair a palette (word or pair) draws; an unrecognised saved value draws the default.
export function pairOf(palette: LavaPalette): LavaPair {
  if (Object.hasOwn(PAIR_OF, palette)) return PAIR_OF[palette as LavaColourWord]
  return Object.hasOwn(PAIR_TABLE, palette) ? (palette as LavaPair) : PAIR_OF.orange
}

// `rotate` walks these in order, every blend running between pairs whose wax
// and liquid both move together. No clear liquid (nothing to blend) and none of
// the bright or black backgrounds.
export const ROTATION: LavaPair[] = ['orange-violet', 'yellow-blue', 'green-blue', 'turquoise-violet', 'purple-blue', 'pink-pink', 'red-violet', 'blue-blue']
// Simulation seconds per pair: held for the first half, then blended into
// the next over the second half. Simulation time already scales with the speed
// word (see SPEED_STEP), so rotation speeds up and slows down with the motion:
// 30 s per pair at normal, 120 s at veryslow, 60 s at slow, 15 s at fast.
export const ROTATE_PERIOD_S = 30
const ROTATE_HOLD = 0.5

// ---------------------------------------------------------------- options

export const DEFAULT_OPTIONS: LavaOptions = { speed: 'normal', palette: 'orange', lamp: true }

// One simulation step is DT seconds; a speed word is how many steps run per
// 100 ms frame (whole steps, so the same step count gives the same state at any
// speed). At normal that is one second of lamp time per second of wall time.
export const DT_MS = 25
export const DT = DT_MS / 1000
export const SPEED_STEP: Record<LavaSpeed, number> = { veryslow: 1, slow: 2, normal: 4, fast: 8 }

export const SPEEDS: LavaSpeed[] = ['veryslow', 'slow', 'normal', 'fast']
export const BUBBLE_WORDS: LavaBubbles[] = ['few', 'medium', 'many']
export const WORDS: string[] = [...SPEEDS, ...PALETTES, ...PAIR_NAMES, ...BUBBLE_WORDS, 'rotate', 'lamp', 'nolamp', 'off']

// The words, grouped, for the reply to an unknown one.
export const HELP = [
  `speeds: ${SPEEDS.join(', ')}`,
  `colours: ${PALETTES.join(', ')}, rotate`,
  `wax-liquid pairs: ${PAIR_NAMES.join(', ')}`,
  `bubbles: ${BUBBLE_WORDS.join(', ')}`,
  'outline: lamp, nolamp',
  'off',
].join(' · ')

// How many blobs, how big (a multiplier on radius) and how sluggish (a multiplier
// on the liquid's drag: heavier blobs respond more slowly). The pool and the top
// layer are the same in all three.
export const BUBBLES: Record<LavaBubbles, { count: number; size: number; pace: number }> = {
  few: { count: 3, size: 1.7, pace: 1.3 },
  medium: { count: 5, size: 1, pace: 1 },
  many: { count: 9, size: 0.62, pace: 0.9 },
}

const bubblesOf = (b: LavaBubbles | undefined) => BUBBLES[b ?? 'medium'] ?? BUBBLES.medium

export type Parsed =
  | { ok: true; options: LavaOptions; off: boolean; words: number }
  | { ok: false; unknown: string[] }

// `/lava-lamp` words, any order and case; a later word of the same kind wins.
// A colour or pair word is fixed colour and turns rotation off; `rotate` replaces it.
// Any unknown word rejects the whole line so nothing half-applies.
export function parseArgs(args: string, prev: LavaOptions = DEFAULT_OPTIONS): Parsed {
  const words = args.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0)
  const unknown = words.filter(w => !WORDS.includes(w))
  if (unknown.length > 0) return { ok: false, unknown }
  const options = { ...prev }
  let off = false
  for (const w of words) {
    if ((SPEEDS as string[]).includes(w)) options.speed = w as LavaSpeed
    else if ((PALETTES as string[]).includes(w) || (PAIR_NAMES as string[]).includes(w)) {
      options.palette = w as LavaPalette
      delete options.rotate
    } else if ((BUBBLE_WORDS as string[]).includes(w)) options.bubbles = w as LavaBubbles
    else if (w === 'rotate') options.rotate = true
    else if (w === 'lamp') options.lamp = true
    else if (w === 'nolamp') options.lamp = false
    else if (w === 'off') off = true
  }
  return { ok: true, options, off, words: words.length }
}

const BUBBLE_LABEL: Record<LavaBubbles, string> = { few: 'few big bubbles', medium: 'medium bubbles', many: 'many small bubbles' }

export function describe(o: LavaOptions): string {
  const speed = o.speed === 'normal' ? 'normal speed' : o.speed === 'veryslow' ? 'very slow' : o.speed
  const colour = o.rotate === true ? 'rotating colours' : PAIR_TABLE[pairOf(o.palette)].label
  return `${speed} · ${colour} · ${BUBBLE_LABEL[o.bubbles ?? 'medium'] ?? BUBBLE_LABEL.medium} · ${o.lamp ? 'lamp outline' : 'no lamp outline'}`
}

// ---------------------------------------------------------------- motion

// Deterministic pseudo-random in [0, 1) from two integers.
function hash(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + 0.5) * 43758.5453
  return s - Math.floor(s)
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const smooth = (s: number) => s * s * (3 - 2 * s)
const mixN = (a: number, b: number, k: number) => a + (b - a) * k
const ramp = (x: number, from: number, to: number) => smooth(clamp((x - from) / (to - from), 0, 1))

// The simulated glass is a fixed canonical one, whatever size the pane is: u is
// across (glass-height units, 0 at the middle), v is down (0 top, 1 bottom). The
// drawing stretches the result sideways to the real glass (see `blobsOf`).
const WIDEST_LAMP = 0.43
const WIDEST_PLAIN = 0.33
// The lamp glass's half-width at depth v, as a fraction of its widest.
const lampProfile = (v: number) => (v < 0.66 ? 0.25 + 0.21 * (v / 0.66) : 0.46 - 0.1 * ((v - 0.66) / 0.34)) / 0.46
const canonicalWidest = (lamp: boolean) => (lamp ? WIDEST_LAMP : WIDEST_PLAIN)
export const canonicalHalf = (lamp: boolean, v: number) => (lamp ? WIDEST_LAMP * lampProfile(clamp(v, 0, 1)) : WIDEST_PLAIN)

// ---- the force model. Units: glass heights, seconds. Temperature runs 0..1.

const R_REF = 0.1 // a medium blob's radius: the unit of weight and thermal mass
const GAMMA = 1.5 // drag, 1/s: the liquid is thick, so a blob's speed follows its push
const BUOYANCY = 0.5 // upward acceleration per unit of temperature above the liquid's
const T_LIQUID = 0.45 // the temperature wax must exceed to float
const GRAVITY = 0.01 // the small pull that makes wax at exactly T_LIQUID sink slowly
export const V_MAX = 0.14 // speed clamp, per blob
// Sideways motion is damped harder than vertical: nothing in a lamp pushes wax sideways on its
// own, so a blob moves across only when a neighbour, the roll or a wall carries it.
const LATERAL_DRAG = 2.5
const SWAY = 0.03 // peak sideways acceleration of the seeded wobble, felt only while a blob travels
const ROLL = 0.08 // 1/s: how firmly cooled wax settles toward its own side of the glass, warm wax toward the middle

// Heat: the liquid is warm at the bulb and cool at the top (and breathes slowly),
// the bulb heats wax near the base, the top cools it. Each blob trades heat with
// the liquid slowly, scaled down by its size (a big blob has more to warm).
const liquidTemp = (v: number, t: number) => 0.28 + 0.3 * v + 0.03 * Math.sin(t * 0.035 + 4 * v)
const FLICKER = 0.05 // 1/s: the seeded wobble in each blob's heat, so no two cycles repeat
const K_LIQUID = 0.03 // 1/s
const K_BULB = 0.12 // 1/s, at full strength under the hot spot
const K_TOP = 0.1 // 1/s
const BULB_FROM = 0.7 // the bulb's reach: none above this depth, full below BULB_TO
const BULB_TO = 0.92
const TOP_FROM = 0.22 // the top's chill: full above TOP_TO, none below this depth
const TOP_TO = 0.04

// Blob against blob. `s` is the centre distance over the sum of the radii, so
// s = 1 is rims touching. Everything fades to nothing at RANGE ("a few radii").
const RANGE = 2.4
const ENTRAIN = 0.4 // 1/s: pull of a neighbour's velocity on a blob's own
// Entrainment reaches less far than cling: a blob passing close drags its neighbour, while blobs
// merely nearby keep their own rhythm instead of locking into step.
const ENTRAIN_RANGE = 1.6
const CLING = 0.012 // peak attraction between wax and wax
const CORE = 0.6 // soft repulsion, at its strongest when two blobs' centres coincide
const CORE_S = 1.5 // inside this separation (in the sum of their radii) it pushes apart, beyond it wax clings
const HEAT_SHARE = 0.01 // 1/s: heat traded between blobs in touch

const WALL_SOFT = 0.05 // the soft boundary's depth
const WALL_PUSH = 0.35 // its acceleration at the wall itself
export const TOP_EDGE = 0.03 // the highest a blob's rim may go (the layer of wax at the top is above it)
const STICK = 0.06 // extra pull that holds wax in the pool until it is hot enough to tear free
export const FLOOR = 0.985 // the lowest a blob's centre may go: down in the pool

// A blob: `id` seeds its private traits; (x, y) the centre, y down; T its temperature.
export type Body = { id: number; x: number; y: number; vx: number; vy: number; T: number; r: number }

export type SimOptions = { bubbles?: LavaBubbles; lamp?: boolean; interact?: boolean }

// The whole state of a lamp. `tick` counts every step ever taken (the physics'
// own clock, warm-up included); `clock` counts steps of lamp time shown, which is
// what `rotate` reads, and which a restarted lamp may carry over.
export type Sim = { bubbles: LavaBubbles; lamp: boolean; interact: boolean; bodies: Body[]; tick: number; clock: number }

export const WARMUP_STEPS = 4200

// Seconds of lamp time a clock count stands for.
export const simTime = (sim: Sim) => sim.clock * DT

// One blob's own traits, from its id and size.
function traits(b: Body) {
  const heft = b.r / R_REF
  return {
    weight: heft * heft,
    thermal: Math.max(0.6, Math.sqrt(heft)) * (0.8 + 0.4 * hash(b.id, 16)),
    bulb: 0.5 + hash(b.id, 11),
    chill: 0.6 + 0.8 * hash(b.id, 17),
    density: (hash(b.id, 12) - 0.5) * 0.2,
    flicker: FLICKER * (0.5 + hash(b.id, 18)),
    beat: 0.1 + 0.2 * hash(b.id, 19),
    side: hash(b.id, 20) < 0.5 ? -1 : 1,
    omega: 0.08 + 0.12 * hash(b.id, 13),
    phase: 2 * Math.PI * hash(b.id, 14),
    sway: SWAY * (0.5 + hash(b.id, 15)),
  }
}

function newBody(id: number, glassW: number, lamp: boolean, size: number): Body {
  const r = clamp(glassW * (0.2 + 0.12 * hash(id, 3)), 0.035, 0.11) * size
  const y = 0.2 + 0.7 * hash(id, 8)
  const room = Math.max(0, canonicalHalf(lamp, y) - r * 0.85)
  return { id, x: (hash(id, 7) - 0.5) * 2 * room, y, vx: 0, vy: 0, T: 0.15 + 0.7 * hash(id, 9), r }
}

// A lamp from explicit blobs (a test places them), not yet stepped.
export function simOf(bodies: Body[], options: SimOptions = {}, clock = 0): Sim {
  return { bubbles: options.bubbles ?? 'medium', lamp: options.lamp ?? true, interact: options.interact ?? true, bodies, tick: 0, clock }
}

// The initial lamp for a seed: the options' blobs, then WARMUP_STEPS of settling,
// so the wax is already spread through the glass rather than all in the pool.
export function createSim(options: SimOptions = {}, clock = 0): Sim {
  const lamp = options.lamp ?? true
  const profile = bubblesOf(options.bubbles)
  const bodies: Body[] = []
  for (let i = 0; i < profile.count; i++) bodies.push(newBody(i, canonicalWidest(lamp), lamp, profile.size))
  const sim = simOf(bodies, options, clock)
  for (let i = 0; i < WARMUP_STEPS; i++) step(sim, false)
  return sim
}

// A fresh lamp advanced `steps` steps (lamp time counted from 0).
export function simulate(options: SimOptions, steps: number): Sim {
  const sim = createSim(options)
  for (let i = 0; i < steps; i++) step(sim)
  return sim
}

// Closeness weight: 1 at touching rims or nearer, falling smoothly to 0 at RANGE.
const nearness = (s: number) => (1 - clamp((s - 1) / (RANGE - 1), 0, 1)) ** 2
// Heat passes only between blobs in touch.
const contact = (s: number) => (1 - clamp((s - 0.9) / 0.9, 0, 1)) ** 2

// One fixed step. `tick` is the physics clock; `counted` is whether it also
// advances the lamp time shown.
export function step(sim: Sim, counted = true): void {
  const { bodies } = sim
  const n = bodies.length
  const t = sim.tick * DT
  const pace = bubblesOf(sim.bubbles).pace
  const widest = canonicalWidest(sim.lamp)
  const acc = bodies.map(() => ({ ax: 0, ay: 0, dT: 0 }))
  const own = bodies.map(traits)
  const spotX = 0.6 * widest * Math.sin(t * 0.045)

  for (let i = 0; i < n; i++) {
    const b = bodies[i]!
    const k = own[i]!
    const a = acc[i]!
    // Buoyancy lifts warm wax (y is down, so up is negative); drag resists; a seeded sway drifts it sideways.
    const lift = BUOYANCY * (b.T - T_LIQUID - k.density) - GRAVITY - STICK * ramp(b.y, 0.88, 0.97)
    const drag = GAMMA * pace
    a.ay = -lift - drag * b.vy
    // The convection roll: warm wax climbs the middle, cooled wax sinks down its side of the glass.
    const sinking = ramp(b.vy, 0, 0.03)
    const lane = k.side * 0.7 * Math.max(0, canonicalHalf(sim.lamp, b.y) - b.r) * sinking
    // The wobble is a travelling blob's wake: a blob at rest or hovering does not wander sideways.
    const travelling = ramp(Math.abs(b.vy), 0.004, 0.04)
    a.ax = -drag * LATERAL_DRAG * b.vx + k.sway * travelling * Math.sin(k.omega * t + k.phase) + ROLL * (lane - b.x)
    // Soft walls: the glass's side at this depth, the top, the floor.
    const room = canonicalHalf(sim.lamp, b.y) - b.r * 0.85
    const into = Math.abs(b.x) - (room - WALL_SOFT)
    if (into > 0) a.ax -= Math.sign(b.x) * WALL_PUSH * Math.min(1, into / WALL_SOFT)
    const high = TOP_EDGE + 0.9 * b.r + WALL_SOFT - b.y
    if (high > 0) a.ay += WALL_PUSH * Math.min(1, high / WALL_SOFT)
    const low = b.y - (FLOOR - WALL_SOFT)
    if (low > 0) a.ay -= WALL_PUSH * Math.min(1, low / WALL_SOFT)
    // Heat: with the liquid, from the bulb (strongest over a slowly wandering hot spot), from the top's chill.
    const bulb = ramp(b.y, BULB_FROM, BULB_TO) * (0.4 + 0.6 * Math.exp(-(((b.x - spotX) / (0.5 * widest)) ** 2)))
    const chill = ramp(b.y, TOP_FROM, TOP_TO)
    a.dT = (K_LIQUID * (liquidTemp(b.y, t) - b.T) + K_BULB * k.bulb * bulb * (1 - b.T) - K_TOP * k.chill * chill * b.T + k.flicker * Math.sin(k.beat * t + k.phase)) / k.thermal
  }

  if (sim.interact)
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = bodies[i]!
        const b = bodies[j]!
        const ai = acc[i]!
        const aj = acc[j]!
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d < 1e-9) {
          dx = (i + j) % 2 === 0 ? 1 : -1
          dy = 0
          d = 1
        }
        const s = d / (a.r + b.r)
        if (s >= RANGE) continue
        const near = nearness(s)
        // The lighter blob gives way more, as momentum would have it.
        const wa = (2 * own[j]!.weight) / (own[i]!.weight + own[j]!.weight)
        const wb = 2 - wa
        // Entrainment: each is pulled toward the other's velocity.
        const grip = (1 - clamp((s - 1) / (ENTRAIN_RANGE - 1), 0, 1)) ** 2
        const dvx = b.vx - a.vx
        const dvy = b.vy - a.vy
        ai.ax += ENTRAIN * grip * dvx * wa
        ai.ay += ENTRAIN * grip * dvy * wa
        aj.ax -= ENTRAIN * grip * dvx * wb
        aj.ay -= ENTRAIN * grip * dvy * wb
        // Cling and core: along the line between centres, positive toward the other.
        const pull = s < CORE_S ? -CORE * (1 - s / CORE_S) ** 2 : CLING * Math.sin((Math.PI * (s - CORE_S)) / (RANGE - CORE_S))
        const ux = dx / d
        const uy = dy / d
        ai.ax += pull * ux * wa
        ai.ay += pull * uy * wa
        aj.ax -= pull * ux * wb
        aj.ay -= pull * uy * wb
        // Heat traded between blobs in touch.
        const share = HEAT_SHARE * contact(s) * (b.T - a.T)
        ai.dT += share * wa
        aj.dT -= share * wb
      }

  for (let i = 0; i < n; i++) {
    const b = bodies[i]!
    const a = acc[i]!
    b.vx += a.ax * DT
    b.vy += a.ay * DT
    const speed = Math.hypot(b.vx, b.vy)
    if (speed > V_MAX) {
      b.vx *= V_MAX / speed
      b.vy *= V_MAX / speed
    }
    b.x += b.vx * DT
    b.y += b.vy * DT
    b.T = clamp(b.T + a.dT * DT, 0, 1)
    // The hard edge behind the soft one: never outside, never stuck (only the velocity into a wall is lost).
    const room = Math.max(0, canonicalHalf(sim.lamp, b.y) - b.r * 0.85)
    if (Math.abs(b.x) > room) {
      b.x = Math.sign(b.x) * room
      if (b.vx * b.x > 0) b.vx = 0
    }
    const top = TOP_EDGE + 0.9 * b.r
    if (b.y < top) {
      b.y = top
      if (b.vy < 0) b.vy = 0
    } else if (b.y > FLOOR) {
      b.y = FLOOR
      if (b.vy > 0) b.vy = 0
    }
  }
  sim.tick++
  if (counted) sim.clock++
}

// One drawn frame's worth of simulation at `speed`: a speed word is only how many
// fixed steps that is, so every speed walks the same path.
export function advanceFrame(sim: Sim, speed: LavaSpeed): void {
  for (let i = 0; i < SPEED_STEP[speed]; i++) step(sim)
}

// Every metaball of a lamp drawn in `glass`: the bottom pool, a thin cap at the
// top, and the simulated blobs. The simulated glass is stretched sideways to the
// real one, and the blobs grow or shrink with it, within limits.
export function blobsOf(sim: Sim, glass: Glass): Blob[] {
  const W = glass.widest
  const t = sim.tick * DT
  const k = W / canonicalWidest(sim.lamp)
  const size = clamp(k, 0.6, 1.4)
  const list: Blob[] = []
  for (let j = -1; j <= 1; j++)
    list.push({
      u: j * 0.55 * W,
      v: 1.01,
      rx: 0.6 * W,
      ry: 0.08 + 0.012 * Math.sin(t * 0.13 + j * 2.1),
      vel: 0,
      kind: 'pool',
    })
  list.push({ u: 0.1 * W * Math.sin(t * 0.05), v: -0.035, rx: 0.55 * W, ry: 0.03 + 0.012 * Math.sin(t * 0.09 + 1), vel: 0, kind: 'cap' })
  for (const b of sim.bodies) {
    // Hot rising wax is soft and pulls long; cooler sinking wax stays rounder; wax that has all but stopped under the cap slumps wider.
    const vel = b.vy
    const flat = 1 - 0.2 * ramp(b.y, 0.22, 0.06) * (1 - Math.min(1, Math.abs(vel) / 0.02))
    const stretch = flat * (1 + Math.min(0.6, Math.abs(vel) * (vel < 0 ? 8 : 5)))
    const r = b.r * size
    list.push({ u: b.x * k, v: b.y, rx: r / Math.sqrt(stretch), ry: r * stretch, vel, kind: 'wax' })
  }
  return list
}

// Each blob's influence falls smoothly to nothing at twice its radius (a
// compact kernel, as xscreensaver's lavalite uses, so a dozen blobs do not sum
// into one fog), scaled so a lone blob crosses THRESHOLD exactly at its rim.
const REACH2 = 4
const RIM = (1 - 1 / REACH2) ** 2
export function field(list: Blob[], u: number, v: number): number {
  let sum = 0
  for (const b of list) {
    const q = ((u - b.u) / b.rx) ** 2 + ((v - b.v) / b.ry) ** 2
    if (q < REACH2) sum += (1 - q / REACH2) ** 2 / RIM
  }
  return sum
}

// ---------------------------------------------------------------- colour

const hex = (c: number[]) =>
  '#' + c.map(x => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('')

const mix = (a: number[], b: number[], k: number) => a.map((c, i) => c + (b[i]! - c) * k)

const mixRGB = (a: RGB, b: RGB, k: number): RGB => [mixN(a[0], b[0], k), mixN(a[1], b[1], k), mixN(a[2], b[2], k)]

// Where `rotate` is at simulation time t: the pair it is on, the next one,
// and how far (0..1) the blend into it has got. A pure function of t.
export function rotationAt(t: number): { from: LavaPair; to: LavaPair; mix: number } {
  const n = ROTATION.length
  const p = t / ROTATE_PERIOD_S
  const step = Math.floor(p)
  const f = p - step
  const at = ((step % n) + n) % n
  return {
    from: ROTATION[at]!,
    to: ROTATION[(at + 1) % n]!,
    mix: f < ROTATE_HOLD ? 0 : smooth((f - ROTATE_HOLD) / (1 - ROTATE_HOLD)),
  }
}

// The colour scheme in force at time t: the fixed palette, or the rotating blend
// of wax and liquid together, so the background always matches its wax.
export function schemeAt(look: { palette: LavaPalette; rotate?: boolean }, t: number): Scheme {
  if (look.rotate !== true) return SCHEMES[pairOf(look.palette)]
  const { from, to, mix: k } = rotationAt(t)
  const a = SCHEMES[from]
  const b = SCHEMES[to]
  return {
    top: mixRGB(a.top, b.top, k),
    bottom: mixRGB(a.bottom, b.bottom, k),
    edge: mixRGB(a.edge, b.edge, k),
    mid: mixRGB(a.mid, b.mid, k),
    hot: mixRGB(a.hot, b.hot, k),
    clear: false,
  }
}

export const METAL = hex([96, 92, 110])
export const METAL_DARK = hex([58, 54, 70])
// The glass's side edge, drawn only where a clear liquid would leave it invisible.
export const GLASS_RIM = hex([88, 98, 126])

// Colours are quantised (steps) so neighbouring cells share them and merge.
// Wax is hottest (brightest) deep inside a blob and near the heated base.
// Liquid in a clear pair is `undefined`: no colour, so the terminal shows.
function lavaColor(f: number, v: number, s: Scheme): string | undefined {
  const q = (x: number, steps: number) => Math.round(x * steps) / steps
  if (f < THRESHOLD && s.clear) return undefined
  const bg = mix(s.top, s.bottom, q(clamp(v, 0, 1), 4))
  if (f < THRESHOLD * 0.55) return hex(bg)
  if (f < THRESHOLD) return hex(mix(bg, s.edge, q((f - THRESHOLD * 0.55) / (THRESHOLD * 0.45), 3) * 0.6))
  const heat = q(clamp((f - THRESHOLD) / 0.8 + (v - 0.55) * 0.4, 0, 1), 6)
  return hex(heat < 0.5 ? mix(s.edge, s.mid, heat * 2) : mix(s.mid, s.hot, (heat - 0.5) * 2))
}

// ---------------------------------------------------------------- drawing

type Shape = (x: number, y: number) => string | undefined

export type Look = { palette: LavaPalette; lamp: boolean; rotate?: boolean; bubbles?: LavaBubbles }

// The lamp silhouette over a w × h2 pixel grid (h2 = 2 × rows); a plain filled
// body when the outline is off or there is no room for a cap and a base.
function shape(w: number, h2: number, t: number, look: Look, sim: Sim): Shape {
  const colours = schemeAt(look, t)
  const hasLamp = look.lamp && w >= 14 && h2 >= 20
  const capH = hasLamp ? Math.max(2, Math.round(h2 * 0.12)) : 0
  const baseH = hasLamp ? Math.max(3, Math.round(h2 * 0.16)) : 0
  const glassTop = capH
  const glassH = Math.max(1, h2 - capH - baseH)
  const cx = (w - 1) / 2
  // Narrow at the top, widest two-thirds down, a little in at the bottom.
  const halfPx = (v: number) => (hasLamp ? w * (v < 0.66 ? 0.25 + 0.21 * (v / 0.66) : 0.46 - 0.1 * ((v - 0.66) / 0.34)) : w / 2)
  const glass: Glass = { half: v => halfPx(v) / glassH, widest: (hasLamp ? w * 0.46 : w / 2) / glassH }
  const list = blobsOf(sim, glass)
  const metal = (x: number, half: number) => (Math.abs(x - cx) < half * 0.4 ? METAL : METAL_DARK)
  return (x, y) => {
    if (!hasLamp) {
      const v = y / glassH
      return lavaColor(field(list, (x - cx) / glassH, v), v, colours)
    }
    if (y < glassTop) {
      const half = w * (0.18 + 0.06 * (y / capH))
      return Math.abs(x - cx) <= half ? metal(x, half) : undefined
    }
    if (y >= glassTop + glassH) {
      const k = (y - glassTop - glassH) / baseH
      const half = w * (k < 0.3 ? 0.36 - 0.06 * (k / 0.3) : 0.3 + 0.18 * ((k - 0.3) / 0.7))
      return Math.abs(x - cx) <= half ? metal(x, half) : undefined
    }
    const v = (y - glassTop) / glassH
    const dx = Math.abs(x - cx)
    if (dx > halfPx(v)) return undefined
    const c = lavaColor(field(list, (x - cx) / glassH, v), v, colours)
    // A clear liquid leaves nothing to show the glass by, so edge it.
    if (c === undefined && dx > halfPx(v) - 1.2) return GLASS_RIM
    return c
  }
}

type Cell = { ch: string; color?: string; backgroundColor?: string }

// Top pixel over bottom pixel; `undefined` is no colour (outside the lamp, or a
// clear liquid), which the half-block glyph leaves to the terminal.
function cell(top: string | undefined, bottom: string | undefined): Cell {
  if (top === undefined && bottom === undefined) return { ch: ' ' }
  if (top === undefined) return { ch: '▄', color: bottom }
  if (top === bottom) return { ch: ' ', backgroundColor: top }
  return { ch: '▀', color: top, backgroundColor: bottom }
}

// A frame of exactly `rows` rows, each row's segments `columns` cells wide: the
// wax where `sim` has it, the colours (and so `rotate`) at `t` seconds of lamp
// time, which is the sim's own clock unless a caller says otherwise.
export function frame(columns: number, rows: number, sim: Sim, look: Partial<Look> = {}, t: number = simTime(sim)): Segment[][] {
  const full: Look = {
    palette: look.palette ?? DEFAULT_OPTIONS.palette,
    lamp: look.lamp ?? DEFAULT_OPTIONS.lamp,
    rotate: look.rotate === true,
    bubbles: look.bubbles,
  }
  const w = Math.max(0, Math.floor(columns))
  const h = Math.max(0, Math.floor(rows))
  const paint = shape(w, h * 2, t, full, sim)
  const out: Segment[][] = []
  for (let r = 0; r < h; r++) {
    const row: Segment[] = []
    let run: Segment | undefined
    for (let x = 0; x < w; x++) {
      const c = cell(paint(x, r * 2), paint(x, r * 2 + 1))
      if (run !== undefined && run.color === c.color && run.backgroundColor === c.backgroundColor && run.text[0] === c.ch)
        run.text += c.ch
      else {
        run = { text: c.ch, color: c.color, backgroundColor: c.backgroundColor }
        row.push(run)
      }
    }
    out.push(row)
  }
  return out
}
