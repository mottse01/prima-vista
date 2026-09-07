# Prima Vista: sight-reading inside a world of exploration

## Current design

Every required interaction now supports reading music. The earlier circuit-matching and three-tone combination puzzles have been removed. The space station is an inviting setting for learning, and the airlock is a visible consequence of completing a reading sequence.

Each location follows three steps:

1. **Prepare with Lyra.** An original navigator character introduces a brief strategy matched to the learner’s current musical level: finding the pulse, staff landmarks, rests, pattern recognition, subdivision, tempo choice, ties, looking ahead, independent lines or recovery. The learner acknowledges a concrete intention. This is preparation, not a claim of measured mastery.
2. **Read rhythm on one note.** Two bars of rhythm separate timing from pitch. The player reads conventional rhythm notation and taps the attacks with touch, Space or a connected MIDI key. A four-beat count-in and steady metronome provide a shared pulse. Longer values and rests require waiting. Assessment matches each input to at most one expected onset and penalizes extra taps. Pitch and key-hold duration are explicitly not assessed. Lowering the tempo, repeating and requesting a different rhythm are available.
3. **Read a fresh piano piece.** The existing generator supplies music at the learner’s musical level. A valid, fresh, unassisted take scoring at least 70 opens the next location. Replays, reference previews, guide keys and look-ahead drills remain useful practice but cannot complete this first-reading gate. An acoustic player can self-confirm an independent first take, explicitly without a measured score or musical-level credit.

Completing the stages lights the learning indicators and opens the airlock. The HUD distinguishes the current location from the learner’s reading level. Visiting an area does not pretend to prove mastery of a musical level. The existing, stricter musical-level advancement rules remain intact.

## Pedagogical grounding

The Royal Conservatory distinguishes rhythm reading and sight playing; its published musicianship material allows speaking, clapping or tapping sight rhythms. This supports isolating rhythm before combining the demands of a full piano score. It does not validate this implementation’s exact tolerances or thresholds. [RCM sight reading](https://www.rcmusic.com/learning/digital-learning/rcm-online-ear-training-rcm-online-sight-reading/sight-reading), [2024 musicianship addendum](https://teacherportal.rcmusic.com/getattachment/ca8bb6d9-8334-4eef-b876-c8e1f17afaea/rcm-musicianship-addendum-2024.pdf)

ABRSM teaching guidance recommends looking for difficult material in preparation, using a metronome to keep moving and working on looking ahead. The cited article is about harp; these are transferable preparation principles, not evidence of a validated piano-game curriculum. Lyra’s piano-specific wording and activity sequence are design adaptations. [ABRSM teaching guidance](https://teacherhub.abrsm.org/mod/page/view.php?id=1831)

The ten short strategies are indexed by musical level, so an early-stage player is not given advanced instruction solely because they explored farther through space. Rhythm complexity also follows musical level. Rhythm practice does not alter the general piano skill model because it measures only a narrow timing task.

## Visual direction

The piano is the central instrument. Lyra’s portrait and guidance station sit on one side; a single-key rhythm desk sits on the other. The mechanical switchboard and unrelated receiver code are gone. Lighter architectural materials, restrained lighting, a quieter navigation strip and generous notation space keep the environment elegant without competing with the score.

Lyra’s original portrait adds about 40 KB. Existing rooms and the 71 KB space backdrop are reused. The rooms pause decorative activity while reading or practicing rhythm. On small screens the guidance panel scrolls within a bounded area, and rhythm notation scrolls horizontally rather than shrinking below a useful size.

## Persistence and evidence

Saved data remains local to this browser. Migration retains already visited locations but resets the current location’s old puzzle flags: solved electrical switches must not become reading evidence. Historic flags named power and signal now correspond to preparation and rhythm internally; no electrical logic remains.

The rhythm completion target (85) and exploration reading target (70) are product hypotheses that need calibration with students and teachers. Musical-level mastery remains a separate measure. Self-confirmed acoustic exploration never receives a measured score.

## Validation still needed

Automated checks cover duration arithmetic, rhythm matching, extra-note penalties, silence and rushed-input rejection, stage prerequisites, fresh-versus-assisted reading, the final location boundary and migration. Real-device timing, audio, visual layout and moderated learner playtesting remain necessary. The ten locations still reuse three architecture families; unique scenery can deepen exploration without adding non-musical puzzles.
