// How fast the wax moves: how many simulation steps run per drawn frame.
export type LavaSpeed = 'veryslow' | 'slow' | 'normal' | 'fast'

// A single colour word: shorthand for that colour's default wax-in-liquid pair.
export type LavaColourWord = 'orange' | 'purple' | 'green' | 'blue' | 'pink' | 'yellow'

// Colours that can be the wax of a lamp, and the liquid it floats in (the same
// colours, and `clear`, which has no colour of its own).
export type LavaWaxColour = 'orange' | 'yellow' | 'green' | 'purple' | 'blue' | 'pink' | 'red' | 'turquoise' | 'white' | 'black' | 'violet'
export type LavaLiquidColour = LavaWaxColour | 'clear'

// A wax in a liquid, named `<wax>-<liquid>`: any wax colour with any liquid. A
// `-clear` liquid draws no background, so the terminal's own shows through.
export type LavaPair = `${LavaWaxColour}-${LavaLiquidColour}`

// What `palette` may hold: a colour word (kept as typed, so options saved by an
// older version stay valid) or a named pair.
export type LavaPalette = LavaColourWord | LavaPair

// How many blobs of wax: few big ones, a medium handful, or many small ones.
export type LavaBubbles = 'few' | 'medium' | 'many'

// What `/lava-lamp <words>` sets; a bare `/lava-lamp` reopens with the last.
// `rotate` cycles slowly through a set of pairs and, while set, overrides `palette` ('clear': wax only, clear liquid);
// a colour word removes it. An absent `bubbles` means `medium`.
export type LavaOptions = { speed: LavaSpeed; palette: LavaPalette; lamp: boolean; rotate?: boolean | 'clear'; bubbles?: LavaBubbles }

declare module 'claude-code' {
  interface PluginState {
    'lava-lamp': {
      // Lamp time in milliseconds (25 ms per simulation step), advanced per frame by
      // the speed's step count. It is what `rotate` reads and survives a reload; the
      // wax itself is module state that restarts, already settled, after one.
      clockMs: number
      options: LavaOptions
    }
  }
}
