# Sight-reading apps: where the gap is

Research notes behind **Prima Vista**, the piano sight-reading trainer in
`src/sightread/`. Sources are listed at the bottom; both competitors' own sites
were unreachable from this environment, so product detail comes from their
public marketing copy as reported in search results, plus practitioner reviews
and forum threads.

## Sight Reading Factory

**What it does well**

- Generates unlimited exercises on demand — you can never memorise the material.
- Very fine-grained teacher control: exact rhythm patterns, key and time
  signature, pitch range, leaps, accidentals, dynamics and articulations, with
  saved parameter sets to return to.
- Broad instrument coverage — many instruments, voice, and full ensembles.
- Strong classroom tooling: student accounts, assessment, and a Live Practice
  mode that casts transposed parts to every student's device at once.
- Print-first, which is what band and choir directors actually need.

**Where it falls down for pianists**

- *It never hears you.* It renders notes and stops. There is no measurement of
  what you played, so there is no diagnosis and no adaptation.
- *The piano writing sounds computer-made.* This is the most consistent
  complaint from pianists: odd chord progressions that "don't make sense", a
  thin left hand, and none of the accompaniment variety real piano music has.
  Reviewers who rate it highly for other instruments single out piano as the
  weak case.
- *Range is hard to control usefully* — reviewers report no convenient way to
  push exercises above and below the staff, which is exactly the reading skill
  most adult learners are missing.
- Subscription-gated, with reported crashes and download trouble in the app.

## Piano Tree

**What it does well**

- Real-time feedback on both pitch and rhythm, over MIDI or the device
  microphone, and it shows exactly what you played without interrupting you.
- A "keep going" philosophy: the music does not stop when you make a mistake,
  because stopping is the habit sight-reading has to unlearn.
- Real repertoire — thousands of pieces, graded from single melodic lines up to
  four-voice chorales and Bach-style writing.
- Practical practice tools: slow down without changing pitch, loop sections,
  transpose to any key, lock to one key.
- Piano-only focus, so nothing is compromised for other instruments.

**Where it falls down**

- *The library is finite.* Graded real repertoire is its strength, but a fixed
  set of pieces can be learned rather than read. Sight-reading is the one skill
  where familiarity with the material destroys the measurement.
- *It progresses by level, not by diagnosis.* It shows you where you went
  wrong in a piece; it does not tell you that your problem is specifically
  ledger lines above the treble staff, or dotted rhythms, and then write you
  material aimed at that.
- No way to specify an exercise: you pick from what exists.
- Subscription after a trial.

## The gap

Unlimited generation and real-time listening have never been in the same
product. That combination is not just additive — it unlocks a third thing
neither can do:

> Attribute every played note to a *skill*, then generate the next exercise
> around whichever skills are failing.

A fixed-library app can only choose a different piece. A generator that cannot
hear you can only apply the parameters you already knew to set. Doing both means
the app can find the weakness you did not know you had, and write material for
it that you have never seen.

## What Prima Vista does about it

| Problem observed | What was built |
| --- | --- |
| Generated piano harmony sounds wrong | A functional-harmony engine: weighted tonic / pre-dominant / dominant progressions with planned authentic and half cadences, chords voiced by minimising motion from the previous voicing, and real accompaniment textures (blocked, Alberti, broken, waltz, sustained, independent counterpoint) |
| Generated melodies wander | Chord tones on strong beats, passing and neighbour tones on weak ones, bounded leaps that resolve by step in the opposite direction, and a phrase arch that rises to the middle of the line and falls to the cadence |
| No feedback loop at all | A grader that matches every MIDI (or on-screen keyboard) note-on against the score, classifying correct / wrong pitch / rushed / dragged / missed / extra, with a timing tolerance that scales with tempo |
| A single average hides where you drifted | A per-note timing strip: every note's timing error plotted against its place in the piece, with barlines, an on-time band, and separate marks for wrong and dropped notes. The drift is almost never even — it is the bar after a leap, or the first bar of a new line |
| Nothing measures whether a slip derails you | Recovery: how many notes a wrong or dropped note costs you before the line steadies again. Arguably the truest measure of sight-reading, and invisible in a raw accuracy score |
| Feedback that does not say *what* to fix | Fifteen tracked skills — treble notes, bass notes, ledger lines, accidentals, steps, skips, leaps, six rhythm families, hands-together — each note tagged with the skills it exercises, and a per-note-name accuracy heatmap |
| Levels that ignore diagnosis | Weak skills bend the generator: ledger-line trouble widens the tessitura, dotted-rhythm trouble guarantees dotted cells, accidental trouble biases toward keys with more of them |
| Range control that does not work | Explicit per-hand range sliders in staff steps, so ledger lines can be dialled in deliberately |
| Nothing forces the eye ahead of the hands | A look-ahead curtain: an opaque card follows the playhead and hides the music as you reach it, adjustable from "no looking back" to "a full bar ahead". It has its own progression, separate from the skill map, because it measures reading fluency rather than note knowledge |
| A replay flatters the measurement | Only a first read of new music can advance a level; replays are detected across reloads and shared links, and count at half weight |
| Assignments need accounts | Every exercise is a seed. A six-character code (also in the URL) reproduces the exact same music for anyone, with no account on either end |
| Notation that looks hand-rolled | Engraving by Verovio, the engine behind scholarly and commercial editions, rendered with Bravura. Exercises also export as MusicXML, so any of them opens in MuseScore, Finale or Sibelius |
| Paywalls | Runs entirely in the browser; progress lives in `localStorage` and exports to JSON |

## What it deliberately does not do

These are real advantages the incumbents keep, and the comparison page in the
app says so:

- **No instruments other than piano.** Sight Reading Factory's band, orchestra
  and choral coverage — and its Live Practice ensemble casting — is a different
  product.
- **No real repertoire.** Piano Tree's graded library of actual pieces teaches
  things generated studies cannot.
- **No classroom management.** There are no rosters, no assessment records, no
  teacher dashboard — only exercise codes and printing.

## Sources

- [SRF review — one year later (Piano World forums)](https://forums.pianoworld.com/ubbthreads.php/topics/2547928/re-srf-review-one-year-later.html)
- [Any experience with Sight Reading Factory? (Piano World forums)](https://forum.pianoworld.com/ubbthreads.php/topics/2150525/Any_experience_with_Sight_Read.html)
- [Sight-Reading Factory review — any good for pianists?](https://www.pianosightreading.com.au/sight-reading-factory/)
- [Sight Reading Factory pricing](https://www.sightreadingfactory.com/pricing)
- [Flat for Education vs Sight Reading Factory](https://blog.flat.io/flat-for-education-vs-sight-reading-factory/)
- [Piano Tree](https://piano-tree.com/) and [its sight-reading page](https://piano-tree.com/piano-sight-reading-app)
- [Best sight-reading apps for piano (MasterPiano)](https://www.masterpiano.com/sight-reading/best-apps)
- [The best sight-reading apps for piano (SightReader)](https://sightreader.app/best-sight-reading-apps)
- [Sight-reading app recommendations (tonebase piano community)](https://piano-community.tonebase.co/t/q6yq0f7/sight-reading-app-recommendations)
- [Best apps for sight reading practice (PianoMode)](https://pianomode.com/explore/piano-accessories-setup/piano-apps-tools/best-apps-for-sight-reading-practice/)
