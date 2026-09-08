# The reading path

What the app claims to teach, how it decides what to put in front of a reader
next, and which of those decisions rest on published evidence rather than on
product judgement. Where a claim is a judgement, this says so.

## What sight-reading research actually points at

Four findings recur across the literature and are the ones this design leans
on. None of them is a claim that *this* app improves reading; they are the
reasons its parts are shaped the way they are.

**Reading ahead is the mechanism.** Eye-movement work on pianists finds that
competent readers fixate well in front of what their hands are playing, and
that the size of that eye–hand span separates stronger readers from weaker
ones. It is the one variable that most directly describes the skill rather than
describing its outcome. ([Sloboda,
1974](https://doi.org/10.1177/030573567422001); [Furneaux & Land,
1999](https://doi.org/10.1098/rspb.1999.0876))

**The pulse surviving the page matters more than the notes being right.**
Accomplished readers keep going. Studies of accompanists and of expert readers
consistently find continuity and temporal control, not note accuracy, doing the
work of distinguishing ability — and accumulated hours of *reading* predict
reading better than accumulated hours of practice in general. ([Lehmann &
Ericsson, 1996](https://doi.org/10.1177/102986499600100101))

**Readers read patterns, not notes.** Errors made while sight-reading are
assimilated toward the key and toward what the music implies, which is evidence
that reading is driven by learned schemata rather than by decoding symbols one
at a time. Music with real harmony and real phrase structure exercises that;
random notes cannot. ([Sloboda,
1976](https://doi.org/10.1080/14640747608400541))

**Spaced return beats massed repetition.** Revisiting material after a gap
retains it better than working it in a block. The evidence base is general
learning rather than piano specifically, so it justifies the shape of the
schedule and not a promise about the size of the effect. ([IES practice
guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1))

## What the app does about each

| Finding | Where it lives |
| --- | --- |
| Reading ahead | Eclipse (`curtain.js`) — notes vanish a fixed distance before the hands reach them, so the only way through is to have already read it |
| Pulse survives the page | `fluency.js` — steadiness and hesitation, kept per reading; `continuity` in the grader; the "keep going" objectives |
| Patterns, not notes | `harmony.js`, `generator.js` — real progressions, cadences, motifs and phrase form; `musicality.js` rejects what does not hold together |
| Spaced return | `staleness()` in `adaptive.js` — a strand nothing has asked about in forty readings weighs twice as much when the next study is chosen |
| Novel material | `seenExercises` and `reads.js` — a second look at the same music is practice, and is banked separately where it can never advance a level |

## Reading tempo

Every level declares a tempo band. A reader starts at that level's published
number and moves inside the band: up when three consecutive clean first reads
score at or above 92 *and* keep the pulse, down when they average below 72 or
come apart. The step is four beats per minute.

Sight-reading is time-constrained, so tempo is a real difficulty dial and not a
cosmetic one — the same eight bars at 60 and at 108 are different tasks.
Aiming just short of clean is deliberate: reading that is always correct is not
asking anything of the reader.

The specific numbers are product judgement. The band edges come from the
existing ladder, and 92/72 are the thresholds the promotion and demotion gates
already used. They have not been validated against piano teaching standards,
and the right experiment is to compare fixed against calibrated tempo at the
same level with the same generator.

## Steadiness

A reading's timing used to be summarised as the mean signed error. That is a
bias, not a steadiness: attacks alternating 60 ms early and 60 ms late average
to zero and look flawless. What is kept now, per reading, is

- **spread** — how tightly the attacks cluster around their own mean, as a
  fraction of a beat, so it compares across tempi; and
- **hesitation** — the longest gap between attacks divided by the reader's own
  median gap, so a reading taken slowly throughout is slow rather than hesitant,
  and one gap much longer than the rest is a stop.

An eighth of a beat and one and a half times your own pace are the thresholds
for "steady" and "unbroken". Both are judgements about audibility, not measured
norms.

The headline score is unchanged — 0.5 notes, 0.3 timing, 0.2 continuity. The
new numbers are diagnostics beside it rather than inside it, because changing
the weighting would silently rewrite the meaning of every score already stored
and of the 88 threshold calibrated against them.

## What a level can present

A level is an envelope, not a syllabus of topics. `syllabus.js` answers
whether a given level can put a given strand on the page at all, derived from
the level's own definition rather than from a hand-maintained table.

This matters because the app asks a level for specific things — the adaptive
engine picks one diagnostic strand per study, and a reader can tap any star on
the reading map to drill it. Asking for something a level cannot write used to
fail in three different ways, all silent:

- **no study at all** — a ledger-line drill at level 2 pushed the tessitura
  past a budget of zero ledger lines and failed validation on every seed;
- **a study that ignored the request** — a leap drill at level 1, whose melody
  cannot move more than a third, and which additionally *dropped the level's
  own focus* to make room for the request that did nothing; and
- **a study that was easier than usual** — the leap drill raised the melodic
  reach to a flat seven, which at levels 8–10 pulled it *down* from eight, nine
  and eleven.

Drills now go where the material lives: asking for triplets at level 3 reads a
level-8 study and says why.

## Silence

`rhythm.silence` — "no new notes in full rests" — has always been a strand in
the grader, a star in Gemini, and, through Gemini, part of the final
destination's completion. It was measured only where the whole texture rests,
and the accompaniment played through every rest the melody took: twelve such
moments in a thousand generated studies. The strand could not be lit, so Gemini
could not be charted, so level 10 could not be cleared.

The accompaniment now falls silent with the melody, guaranteed when silence is
the thing being practised and occasional otherwise. A general rest is a real
reading task — the pulse has to survive with nothing sounding, and both hands
have to arrive back together — and it only ever lands mid-study, never in the
opening or closing bar, and never leaves the bass holding a value its texture
would not otherwise play.

## What has not been validated

Everything above is a design informed by evidence, not a demonstration of
learning. In particular: the level ladder's ordering, the promotion thresholds,
the tempo band edges, the steadiness thresholds, and the forty-reading staleness
horizon are all product judgements. The honest next steps are the ones in
[`expedition-design.md`](./expedition-design.md) — a comparison against the
previous behaviour with sample size and analysis rules set in advance.
