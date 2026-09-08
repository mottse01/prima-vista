# The Reply

The story the expedition tells, and why it is shaped the way it is.

> **Status: design, not yet built.** The code today has a thinner framing — a
> "sight-reading expedition" with a guide called Lyra and ten stations. Every
> mechanic this document leans on already exists; none of the *naming* or the
> narration does. The table under [Fiction to mechanics](#fiction-to-mechanics)
> says exactly which is which, so nothing here should be read as a description
> of current behaviour. Where this contradicts
> [`environmental-adventure.md`](./environmental-adventure.md) or
> [`expedition-design.md`](./expedition-design.md), those describe what is
> built and this describes where it is going.

## The distinction the whole thing rests on

Music is the language. Notation is the script.

You can speak a language you cannot read, and read a script whose language you
do not know. Sight-reading is neither: it is the act of reading a script aloud,
fluently, in real time, having never seen the page before.

That is also how reading research describes literacy — decoding, then fluency,
then comprehension, with fluency as the bridge, because automatic decoding is
what leaves working memory free for meaning ([LaBerge & Samuels,
1974](https://doi.org/10.1016/0010-0285(74)90015-2)). Sight-reading climbs the
same ladder.

So the story is not "music is a universal language." That is a poster, not a
plot, and it gives a player nothing to do. The story is **decipherment**, which
makes reading itself the verb rather than the toll you pay to open a door.

## The premise

In 1977 two spacecraft left carrying a phonograph record — Bach, gamelan, Blind
Willie Johnson, Chuck Berry — with playback instructions etched on the lid. It
was a letter written in a notation we hoped someone could learn. This
application's tenth waypoint is already the Heliopause, and its station is
already called the Voyager Relay.

Something answered. Not with speech. With notation.

At each of the ten waypoints along the line the Voyagers took, there is a
reply, and it is not a recording. It is an inscription. Marks. **There is no
playback button in the universe for it.** The only way anyone finds out what
they said is for a person who can read to sit down and read it.

And it is our own music coming back. They learned it from the record, and they
are writing in our idiom — clumsily at first, then fluently, then past us. That
is why the studies are baroque and blues and ragtime: the style packs are the
record's track list. Bach, Mozart, Beethoven, Stravinsky, blues, a Georgian
chorus, folk traditions from four continents. Ragtime and minimalism were not
on the disc; those are things they worked out from what was.

So the shape of it is this. **You are learning to read what they are learning to
write.** Two learners approaching one language from opposite ends, meeting in
the notation. Lyra sits between you.

## Three rules

Everything below is subordinate to these. A change that breaks one of them is
wrong however good it looks.

1. **The fiction never gates the instrument.** Practice mode stays plain: same
   generator, same grader, same profile, no story, every level open. This is
   what the mode fork in [`src/core/modes.js`](../src/core/modes.js) is for.
   Expedition is the fiction; practice is the instrument.
2. **The fiction never fakes the measurement.** Lyra may say "you stopped
   there" because the grader measured a hesitation. She may never say a reading
   went well when it did not. Every line she has must derive from real data.
3. **The reward is never a number.** The reward is finding out what it said.

## Fiction to mechanics

The point of the story is that it explains machinery that already exists. Each
row is a rule the application already enforces, which currently reads as the app
withholding something, and which the fiction turns into a fact about the world.

| Mechanic | Where it lives | What the fiction makes it |
| --- | --- | --- |
| A replay is banked separately and can never advance a level | [`reads.js`](../src/core/reads.js), `applyResult` in [`adaptive.js`](../src/core/adaptive.js) | An inscription sounds for the first time exactly once, and you were the one who sounded it |
| Eclipse: notes vanish before your hands reach them | [`curtain.js`](../src/core/curtain.js) | Reading the inscription consumes it. One pass. *That* is why you look ahead |
| The one-note rhythm study before each reading | `rhythmScore` in [`adventure.js`](../src/core/adventure.js), [`RhythmLesson.jsx`](../src/components/RhythmLesson.jsx) | Rhythm is the part of the script you can read before you can read pitch |
| Four skill constellations | [`constellation.js`](../src/core/constellation.js) | The four competences of this literacy: the characters, the distances, the time, and holding two lines at once |
| Endless generated studies | [`generator.js`](../src/core/generator.js) | There are more inscriptions than you will ever read |
| One shared piece per day | [`transit.js`](../src/core/transit.js) | One arrives each day, and every reader on Earth gets the same one |
| Ten levels, ten waypoints | [`journey.js`](../src/core/journey.js), [`difficulty-levels.json`](../src/data/difficulty-levels.json) | The order in which *they* learned to write, which is the order a person learns to read |
| Per-destination objectives | [`missions.js`](../src/core/missions.js) | What each place asks of a reader before the next signal can be resolved |

The Eclipse row is the most important one in the table. Eye–hand span is the
actual mechanism of sight-reading ([Sloboda,
1974](https://doi.org/10.1177/030573567422001); [Furneaux & Land,
1999](https://doi.org/10.1098/rspb.1999.0876)), and "the writing does not
survive being read" is that mechanism restated as a physical property of an
object. Fiction and pedagogy asking for the identical behaviour is the test of
whether a story is load-bearing or decorative.

## The ten beats

Each waypoint is a stage in their learning, which is the same order as yours.
Each is a real conceptual advance in notation, not a difficulty tier with a coat
of paint. Places and level skills are the ones already in
[`adventure.js`](../src/core/adventure.js) and
[`difficulty-levels.json`](../src/data/difficulty-levels.json).

| | Place | What they worked out | The level's skill |
| --- | --- | --- | --- |
| 1 | **Luna** · the listening room | A mark can mean a pitch and a length | One hand, steps, quarters |
| 2 | **Mars** · a garden in the dust | There is a second hand under the first | Bass staff, hands together |
| 3 | **Ceres** · the silent archive | Notation can specify nothing happening | Rests, re-entry |
| 4 | **Jupiter** · inside the storm | Our scale is not the only set of pitches, and a line can jump | Accidentals, leaps, minor |
| 5 | **Saturn** · the ring keeper | Time can be cut in three | Compound metre, dotted values |
| 6 | **Uranus** · the winter greenhouse | Their hand has got fast | Sixteenths, ledger lines |
| 7 | **Neptune** · below the blue | You can play *against* the beat | Syncopation, ties |
| 8 | **Pluto** · the last lantern | Two grids of time at once | Triplets |
| 9 | **Kuiper Belt** · messages in the ice | Two voices can say different things and both be true | Independent lines |
| 10 | **Heliopause** · where the song goes | Something that is theirs | Everything, flexible |

Three of these carry more weight than the rest.

**Three** is the discovery of the rest — that a notation can specify silence is
a genuinely sophisticated idea, and it is the reason the general rest was worth
building into the accompaniment (see
[`reading-pedagogy.md`](./reading-pedagogy.md#silence)).

**Seven** is the hinge of the whole story. Syncopation requires understanding a
beat well enough to contradict it, which is the moment a student stops copying
and starts playing. It is where they stop imitating us.

**Nine** is counterpoint described honestly, and it is the last thing they learn
from us before the last thing they teach us.

## Lyra

She reads and cannot play.

She has been analysing these for years. She knows what the marks mean and she
cannot make them speak, so she needs a particular person: one who can sit down
and sound an inscription at sight. That earns her presence, and it is why her
material is reading strategy rather than piano technique — which is already
what `READING_LESSONS` in [`adventure.js`](../src/core/adventure.js) contains.

She should say far less than she does now. She is listening while you read,
hearing it for the first time as well, and afterwards she says **one sentence
about what actually happened**. The specifics already exist: hesitation and
pulse spread from [`fluency.js`](../src/core/fluency.js), hand balance and
recovery episodes from [`grader.js`](../src/core/grader.js).

Presence over exposition. The companion in *Moss* never says a word.

## What a misreading is

There is no fail state. A misreading is a **mistranscription**, and the grader
already distinguishes the kinds that matter:

| What the grader saw | What Lyra can say |
| --- | --- |
| Wrong pitch, but a chord tone | You read a real word — just not the written one |
| A missing attack, then recovery | You stopped to work out a character |
| Pulse spread wide, or one long gap | You lost the metre of the line |
| Steady, unbroken, some wrong notes | You read it straight through. Some of it was wrong. That is the right order to fix things in |

This is also true pedagogy rather than flavour: an error that fits the key is a
better error than a random one, because it means the reader is using the
harmony to predict ([Sloboda, 1976](https://doi.org/10.1080/14640747608400541)).
Telling somebody that is more useful than showing them a number.

## The ending

The last inscription at the Heliopause is in our script, in a form we would
recognise, and imitating nothing. You read it. You are the first person to hear
it.

Then it must refuse to end. The transmissions do not stop — what stops is the
guided part, and the final beat hands the reader the practice room: *there are
more of these than either of us will read.* That is emotionally right, and it is
also literally true of the generator, so the ending never has to lie about how
much is left.

## What not to build

No experience bars, currency, cosmetic shops, leaderboards, daily quests,
hearts, lives or combo multipliers. None of the games this design takes its
manners from — *Moss*, *Monument Valley*, *Red Matter* — contains a single one
of them, and expected, task-contingent tangible rewards are the category with
the most evidence against it for tasks a person already finds interesting
([Deci, Koestner & Ryan, 1999](https://doi.org/10.1037/0033-2909.125.6.627)).

The streak stays as a record and never as a debt: it is already called *nights
observed* in the sky view, which is the right framing, and a broken one should
never be shown. Consistency of reading practice genuinely is the best predictor
of reading ability ([Lehmann & Ericsson,
1996](https://doi.org/10.1177/102986499600100101)), so recording it is right;
making it a thing you can lose is what turns it into a chore.

The line to hold: **a number may describe what happened, and may never pay you
for it.** A score out of 100 after a reading is measurement, not a prize, and
should stay.

## Names

A single readable inscription is a **passage**. The body of them is **the
Reply**. Expedition mode's title is *Prima Vista: The Reply* — and *prima
vista* already means "at first sight", which is precisely the claim the story
makes about every reading in it.

## Honesty about all of this

This is a fiction chosen because it happens to demand the same behaviour good
pedagogy demands. That is the only defence it has. It is not evidence that a
story improves learning, and no claim in this document has been tested against
readers. What can be said is narrower and worth keeping separate: the mechanics
the story explains were each adopted for reasons written down in
[`reading-pedagogy.md`](./reading-pedagogy.md), and none of them changes because
of anything here.
