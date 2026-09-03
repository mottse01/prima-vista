# Generator acceptance

Run `npm run acceptance` to generate 1,000 exercises at each of the ten
difficulty levels. The automated gate requires:

- zero hard-rule violations across all 10,000 exercises;
- byte-identical MusicXML across 100 regenerations of one recipe;
- no pair in a fixed-parameter set of 1,000 exercises sharing more than four
  identical bars; and
- every exercise to remain inside its style pack's lower and upper coherence
  thresholds.

The human-ness and playability targets require people and are therefore kept as
release gates rather than simulated by automated tests. Before promoting a
style pack from preview to audited:

1. Prepare ten generated exercises and ten level-matched public-domain excerpts
   with source labels hidden.
2. Randomise their order separately for at least five trained musicians.
3. Record generated-versus-human guesses and qualitative comments. The target
   is less than 65% correct identification.
4. Have a piano teacher review twenty exercises per level and reject the pack if
   any exercise is awkward or unidiomatic.
5. Calibrate the pack's coherence thresholds against the corpus distribution,
   rerun the automated gate, and record the corpus snapshot in provenance.

The difficulty crosswalk stored in `src/data/difficulty-levels.json` is a
constraint model, not a claim that Prima Vista levels equal exam grades. It is
anchored to the published ABRSM piano sight-reading parameters and the RCM piano
syllabus, then made stricter where required for deterministic hard validation.
