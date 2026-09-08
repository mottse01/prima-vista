# Prima Vista: the sight-reading expedition

> This is the September 2026 design review. The narrative direction that came
> out of it is in [`the-reply.md`](./the-reply.md).

Research and design review · 6 September 2026

## Recommendation

Make the act of reading music the act that advances an expedition. The player chooses a destination, prepares a real score, plays one short flight, and sees how that performance changes the journey. Quiet exploration surrounds a clean music stand. The experience should feel inviting to a child and dignified to an adult returning to piano.

This is a research-informed design, not a claim that this version has been shown to improve learning or retention. The numerical gates below are product hypotheses inherited from the existing assessment, not experimentally validated piano standards.

## What the existing product already does well

The review covered the application, onboarding, practice transport and results, level definitions, mission gates, adaptive assessment, local persistence, generator architecture, map, and regression tests.

- The generator is unusually substantial: seeded, reproducible exercises; harmonic plans; musical motifs and transformations; constrained rhythms and hand positions; ten style packs; repertoire and fragment modes; and hard validation before display.
- Verovio produces conventional engraved notation. MIDI, screen and computer-keyboard inputs feed the existing grader. Acoustic practice is explicitly unscored, with experimental monophonic detection.
- Ten pedagogical levels already correspond to a journey from Luna to the Heliopause. Placement can open a suitable starting region for an experienced player.
- Fresh reads, assisted attempts, repeats and look-ahead drills already have separate evidence rules. Keeping these distinctions matters more than adding a new points system.
- Detailed coaching, timing traces, hand-specific repair, learner reflection, daily transits, skill constellations and browser-local history already exist.

The missing layer is an easily understood game loop. The previous entry point stacked mission information, a daily challenge, practice configuration and the score. The visual solar system lived in a secondary view. Completing a reading did not make the resulting change to the journey sufficiently prominent.

Several progression details also worked against the experience. Luna required an average timing bias within 45 ms; special fluency or texture tasks could block later travel; map copy said every destination was available even though it enforced locks; and some discovery checks used rehearsed history despite describing first-read evidence. An average timing bias is also not a measure of timing consistency: alternating early and late notes can cancel. That diagnostic deserves a future measurement review and is now optional rather than an entry-level travel barrier.

## What the evidence supports

### Games need good instruction inside them

Wouters and colleagues' meta-analysis found benefits for learning and retention, but did not find a statistically significant overall motivation advantage over conventional instruction. Multiple sessions and supplementary instruction were among the favorable moderators. A space theme alone is therefore not sufficient. Keep explicit preparation, short practice, feedback and reflection inside the game loop. [Wouters et al., 2013](https://doi.org/10.1037/a0031311)

### Give players agency and evidence of competence

The self-determination account of game engagement emphasizes competence, autonomy and relatedness. For Prima Vista, the useful translation is a choice of meaningful reading activities, comprehensible progress and supportive feedback. It does not require a competitive leaderboard. Cooperative teacher or family interactions could eventually support relatedness, but are outside this implementation. [Przybylski, Rigby & Ryan, 2010](https://selfdeterminationtheory.org/SDT/documents/2010_PrzybylskiRigbyRyan_ROGP.pdf)

### Return to skills over time

The IES practice guide recommends spacing learning and using active retrieval to support learning. Its evidence concerns broader learning contexts, not this sight-reading generator specifically. Apply the principle by returning to a reading skill in newly generated music across sessions. Repeating the same score remains useful rehearsal but should not masquerade as a new sight-reading measurement. [IES practice guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1)

### Borrow mechanisms, not just visual rewards

DragonBox Algebra introduces its operations through a sequence of puzzles, offers immediate feedback, and gradually replaces pictures with algebraic symbols. The useful design lesson is that the learning action itself drives the game. This is a description of the product, not independent proof of its learning effectiveness. Prima Vista should keep conventional notation as its learning object; replacing notes with planets risks teaching a substitute representation. [DragonBox product description](https://dragonbox.com/products/algebra-5)

Duolingo's published half-life regression work models when vocabulary needs practice and reports an engagement improvement in its operational study. Its setting is language learning, so the reported effect size cannot be assumed for piano. The relevant next experiment is a skill-return mission: revisit a weak or neglected skill with a new score, without rewarding repeated memorized performances as sight-reading. [Settles & Meeder, 2016](https://research.duolingo.com/papers/settles.acl16.pdf)

## The game loop

1. **Explore.** Open on an expedition screen with one prominent mission launch. Show current destination, three first-read progress segments, the skill being learned, and the route ahead. Locked destinations can be previewed without pretending they are playable.
2. **Prepare.** Find hand position, key and metre. Keep the existing optional preparation tools and input setup. Beginners get a comfortable placement flow; returning players can enter further out.
3. **Fly.** Playing the real score is the mission. A restrained flight-progress strip shows position in the piece. The score stays on a light surface, and navigation disappears during performance. No moving enemies, damage flashes or extra task competes for visual attention.
4. **Debrief.** Show the actual change: a strong first read recorded, a discovery completed, or a new destination opened. Keep the existing specific musical coaching and replay/repair options below it.
5. **Choose.** Continue with fresh music, practice a difficult passage, inspect the journey or finish for now. A two- or five-minute session is a convenient commitment, not a compulsory daily quota.

The route is a visible reward. Discovery achievements supply optional depth. Neither requires coins, a shop, energy limits, loss of earned access or an age-specific cartoon persona.

## Level and chapter design

Keep all ten existing musical parameter envelopes unchanged. Repackage them as these chapters:

| Level | Destination / chapter | Main musical focus | Optional discovery direction |
| --- | --- | --- | --- |
| 1 | Luna / First light | Fixed-position, one-hand notes and pulse | Timing and continuity |
| 2 | Mars / A second voice | Grand-staff orientation | Bass reading and hands together |
| 3 | Ceres / Between the stars | Rests and reading continuity | Look-ahead practice |
| 4 | Jupiter / A wider horizon | Skips and changing key contexts | Reading in more than one key |
| 5 | Saturn / Rings of rhythm | Dotted values and compound metre | A 6/8 study |
| 6 | Uranus / In motion | Sixteenths and hand coordination | Balanced hand accuracy |
| 7 | Neptune / Against the current | Syncopation and ties | A tie crossing the barline |
| 8 | Pluto / Distant echoes | Triplets and moving bass textures | Walking or stride bass |
| 9 | Kuiper Belt / Independent orbits | Independent voices | A daily first-read transit |
| 10 | Heliopause / Beyond the familiar | Advanced reading and anticipation | Longer look-ahead and skill constellations |

Three eligible readings scoring at least 88 open the next destination. They need not be consecutive. The existing stricter demonstration mechanism still needs consecutive strong readings and focus-skill evidence before automatically recommending advancement. Opened destinations remain open. All three objective checks are retained as completionist discoveries, but only the first-read goal blocks travel. Placement is access, not proof of mastery.

The 88 threshold and three-read count should be calibrated with teachers and learners. Do not lower assessment integrity simply to increase completion rates. Investigate whether a smaller within-level warm-up is needed before introducing another level; the existing generator can later supply that without replacing its musical model.

## Visual and device direction

Use deep blue-black space, restrained cyan and mint instruments, generous readable labels and a single compressed original space illustration. The launch area supplies atmosphere, while the destination controls are functional, lightweight geometry. The existing optional 3D atlas remains separate from the main route so playing does not require a 3D renderer.

On phones the destination strip scrolls horizontally and mission panels stack. Buttons have generous touch areas; keyboard users can reach destination previews and launch actions. Reduced-motion preferences suppress arrival animations. During a reading, conventional notation remains dominant. The existing notation size, page/scroll views and comfort setting remain available.

The new backdrop is approximately 71 KB, with no new dependency or network font. The existing notation WebAssembly payload remains much larger; this redesign does not remove that cost. Device performance and complete browser/audio compatibility still require real-device validation.

## Implemented in this revision

- Expedition start screen, ten selectable destination previews, chapter descriptions and direct mission launch.
- Daily discovery, open practice and flight-log entrances.
- Flight-progress display and result-linked expedition debrief, including onward travel when a route opens.
- Optional discoveries separated from travel requirements; reading discoveries now exclude rehearsal/assistance history.
- Updated route explanations, reassuring recovery language and an optional onboarding entrance.
- Existing generation, engraving, grading, custom exercise tools, sharing, local progress and input paths retained.

## Next validation and research

Run moderated sessions with beginners, returning adults and experienced readers, spanning phone, tablet, desktop, MIDI and acoustic use. A small first round can expose usability failures but cannot establish learning efficacy. Ask learners to launch, play, understand the result and choose a next step without coaching from the observer.

Measure time to a first completed reading, preparation abandonment, whether the unlock rule is understood, optional-challenge uptake and voluntary return. Pair engagement measures with performance on unseen music after a delay, continuity and hand-specific accuracy. More minutes alone can mean confusion or grinding.

Compare this expedition against the previous practice layout with the same generator, score distribution and input mode. Set sample size and analysis rules before treating differences as evidence. In particular, validate the entry-level score threshold and distinguish motor-input limitations on a phone from reading ability. No research source here establishes universal enjoyment across ages or universal device compatibility.

Future candidates after observing players: focused discovery launch recipes, spaced skill-return scheduling, a small set of earned visual ship customizations, and a teacher-guided shared expedition. These are proposals, not features included in this revision.
