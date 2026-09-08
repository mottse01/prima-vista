# Prima Vista

A piano sight-reading trainer. Unlimited generated exercises with real harmony
behind them, graded in real time against what you actually play.

## Why it exists

See [`COMPETITIVE-ANALYSIS.md`](./COMPETITIVE-ANALYSIS.md). Short version:
Sight Reading Factory is a mature generator with assessment and classroom
tools. Piano Tree combines a large repertoire library with real-time feedback.
Prima Vista is deliberately narrower: it protects the integrity of a fresh
read, diagnoses the specific skill that broke down, and generates the next
piano study around that evidence.

Two documents carry the intent behind the code, and anything working on this
repository should read both before changing behaviour:

- [`docs/reading-pedagogy.md`](./docs/reading-pedagogy.md) — what the levels
  teach, how the app chooses what to put in front of a reader next, and which
  of those decisions rest on published evidence rather than on judgement.
- [`docs/the-reply.md`](./docs/the-reply.md) — the story the expedition tells,
  and the reason each mechanic is shaped the way it is. It is a design
  document, not a description of current behaviour, and it says so. Its three
  rules — the fiction never gates the instrument, never fakes the measurement,
  and never rewards with a number — bind changes to the expedition.

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
npm test          # deterministic generation, scoring and audio regressions
npm run acceptance # 1,000 hard-valid generations at each of 10 levels
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
    stylePacks.js  validated, versioned JSON genre models
    harmony.js     pack-driven progressions, cadence splicing, voice leading
    generator.js   form -> harmony -> motif -> development -> surface realisation
    validator.js   hard pedagogy rules, soft musical checks, coherence band
    fragments.js   provenance-checked public-domain motif recombination
    repertoire.js  fixed public-domain repertoire mode
    musicxml.js    score -> MusicXML (also the user-facing export)
    verovio.js     lazy-loaded Verovio toolkit; MusicXML -> engraved SVG
    grader.js      note matching, scoring, per-skill attribution
    fluency.js     pulse steadiness and hesitation, as fractions of a beat
    syllabus.js    which reading strands each level can actually present
    pacing.js      reading tempo calibrated inside each level's own band
    adaptive.js    skill ratings, promotion, weakness-targeted parameters
    curtain.js     look-ahead curtain modes and their tick offsets
    levels.js      the 10-level graded path and exam-board crosswalk
    audio.js       live WebAudio plus locally rendered media reference playback
    midi.js        Web MIDI input
    rng.js         seeded PRNG + six-character variation seeds
    share.js       exact URL recipes + exercise fingerprints
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

- **Everything is deterministic from a seed and its parameters.**
  `generateExercise({ seed, ... })` always produces identical music for the same
  recipe. Exact share links carry both; the short seed is a convenient way to
  replay a variation inside the same setup.
- **Style lives in data.** Ten genre packs live in `src/data/style-packs/` and
  are schema-checked at startup. The Auto setting uses the currently
  hand-audited Classical and Hymn/Chorale packs; the remaining packs are
  selectable previews until corpus calibration is complete.
- **Every generated score passes a validator before display.** Bar arithmetic,
  range and ledger lines, melodic interval and hand-shift caps, chromatic-event
  counts, simultaneous span, collisions, cadence arrivals, licensed harmonic
  seams and non-chord tones, subdivision, audible development, and the
  coherence band are hard gates. Ten strict candidates are ranked first; only
  if all ten fail may ten progressively softer candidates be considered. Hard
  failures and critic-rejected candidates are never emitted.
- **The public-domain pipeline has one license boundary.**
  `tools/corpus_pipeline/` records provenance in SQLite and accepts only public
  domain, CC0, or explicitly approved permissive sources. NonCommercial and
  ShareAlike material is excluded from the commercial path.
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
- **Generated does not mean random-walk.** A pack-authored form fixes phrase
  functions and cadences first. A pack transition/trigram model then supplies
  harmony, including a whole-progression bridge solve around protected cadence
  formulas. Exactly one explicit motif records its rhythm cell, contour, and
  seed scale degrees; exact, diatonic-transposition, reharmonisation, inversion,
  augmentation, diminution, fragmentation, and interval-expansion transforms
  develop that same object rather than generating independent bars.
- **Corpus calibration is reproducible.** The offline Python pipeline mines
  licensed, hand-audited genre buckets into bigrams, trigrams, phrase cadence
  candidates, rhythm and interval distributions, accompaniment clusters,
  fragment provenance, and coherence quantiles. `npm run prepare:evaluation`
  creates the blinded A/B and teacher-review packages required before a preview
  pack can be promoted.
- **Audio has a robust dual path.** Live key sounds stay on low-latency
  WebAudio. “Hear the score” and the practice count-in/metronome render locally
  to WAV media, which is more reliable in iOS webviews and embedded Sites;
  WebAudio remains the transport fallback.
- **Recovery counts pitch errors, not lateness.** A wrong or dropped note opens
  an episode; two clean attacks in a row close it. Notes that are merely late
  deliberately do not count, because a player who is steadily behind the beat
  has a tempo problem (already reported as timing bias), not a derailment.
- **Four kinds of take are scored differently.** A first read of new music is
  the real sight-reading measurement and the only one that can advance a
  level. A replay is contaminated by familiarity, so it moves the skill map at
  half weight and never promotes — `seenExercises` on the profile catches replays
  that arrive via a reload or a shared link, not just via the "try again"
  button. An assisted take (reference playback or guide keys) follows the same
  half-weight rule. A curtain take measures reading fluency, not note knowledge,
  so it is kept out of the skill map entirely and tracked under
  `profile.lookAhead` instead.
