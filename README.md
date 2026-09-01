# Prima Vista

A piano sight-reading trainer. Unlimited generated exercises with real harmony
behind them, graded in real time against what you actually play.

## Why it exists

See [`COMPETITIVE-ANALYSIS.md`](./COMPETITIVE-ANALYSIS.md). Short version:
Sight Reading Factory generates endless material but never hears you, and its
piano writing is widely criticised as unmusical. Piano Tree hears every note
but draws on a finite library and progresses by level rather than by
diagnosis. This combines both: a generator that knows what you just got wrong
and writes the next exercise around it.

## Running it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (typically `http://localhost:5173`).

```bash
npm run build    # production build to dist/
npm run preview  # serve the production build locally
npm run lint      # eslint
```

Connect a MIDI keyboard for real grading, or use the on-screen / computer
keyboard fallback. Everything runs in the browser — no account, no server.
Progress is stored in `localStorage` and exports to JSON from the Progress tab.

## Layout

```
src/
  core/
    theory.js      spelled pitches, keys, scale degrees, chord membership
    rhythm.js      rhythm-cell vocabulary, time signatures, metric weight
    harmony.js     functional progressions with cadence planning; voice leading
    generator.js   melody + accompaniment generation from a parameter envelope
    musicxml.js    score -> MusicXML (also the user-facing export)
    verovio.js     lazy-loaded Verovio toolkit; MusicXML -> engraved SVG
    grader.js      note matching, scoring, per-skill attribution
    adaptive.js    skill ratings, promotion, weakness-targeted parameters
    curtain.js     look-ahead curtain modes and their tick offsets
    levels.js      the 20-level graded path
    audio.js       WebAudio metronome, count-in, reference playback
    midi.js        Web MIDI input
    rng.js         seeded PRNG + the six-character exercise codes
    storage.js     localStorage profile, presets, settings, export/import
  components/
    Score.jsx         engraved score plus the playhead, curtain and note colouring
    PracticeView.jsx  one take: transport, playhead, live colouring, results
    TimingStrip.jsx   per-note timing chart shown after a take
    SetupPanel.jsx    the custom exercise builder
    ProgressView.jsx  skill map, note heatmap, score history
    PathView.jsx      the graded path
    Keyboard.jsx      on-screen / computer-keyboard piano input
    CompareView.jsx   how it stacks up against the incumbents
```

## Notes for maintainers

- **Everything is deterministic from a seed.** `generateExercise({ seed, ... })`
  always produces identical music. That is what makes exercise codes work, and
  it makes bugs reproducible — paste the code from the score header.
- **Ticks, not seconds.** `TPQ = 48` per quarter note, chosen because it divides
  by both 3 (triplets) and 16 (sixteenths). Seconds are derived at playback.
- **Engraving is Verovio's job, not ours.** The score model exports to
  MusicXML and Verovio — the engine behind scholarly and commercial editions —
  engraves it with the Bravura font: proper spacing, beam slopes, slur shapes,
  accidental stacking, collision avoidance.
- **We choose the element ids.** `xmlNoteId(hand, onset, midi)` goes into the
  MusicXML and survives into the rendered SVG, so live colouring is a lookup
  rather than a guess, and the grader keys its state by the same id.
- **The score overlay is imperative on purpose.** The playhead moves every
  animation frame; reconciling a React tree sixty times a second to slide one
  rectangle would be waste. Positions are measured as fractions of the
  rendered box so they survive a resize.
- **Verovio is a large WebAssembly module** (~2.4MB gzipped), so it is
  imported lazily and lands in its own chunk. The app shell stays small.
- **Timing uses the audio clock**, not `performance.now()` and not MIDI
  timestamps, so playback, metronome and grading all share one time base.
- **Recovery counts pitch errors, not lateness.** A wrong or dropped note opens
  an episode; two clean attacks in a row close it. Notes that are merely late
  deliberately do not count, because a player who is steadily behind the beat
  has a tempo problem (already reported as timing bias), not a derailment.
- **Three kinds of take are scored differently.** A first read of new music is
  the real sight-reading measurement and the only one that can advance a
  level. A replay is contaminated by familiarity, so it moves the skill map at
  half weight and never promotes — `seenSeeds` on the profile catches replays
  that arrive via a reload or a shared link, not just via the "try again"
  button. A curtain take is measuring reading fluency, not note knowledge, so
  it is kept out of the skill map entirely and tracked under
  `profile.lookAhead` instead.
