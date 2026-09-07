# Prima Vista: environmental musical adventure

## Revised direction

The previous iteration organized activities into an expedition dashboard. The new direction puts the player inside a location, with instruments, clues and an exit that respond to their actions. Red Matter is a reference for presence and environmental interaction, not a request to reproduce its setting, story or art.

Red Matter's official description emphasizes tools inside the world, manipulable objects, and puzzles belonging to their surroundings. Red Matter 2 describes exploration, machinery and environmental/logic puzzles. The applicable principle is that a solved puzzle changes a place. [Red Matter](https://redmattergame.com/), [Red Matter 2](https://redmatter2.com/)

## Implemented interaction loop

Enter the Selene Observatory. Walk with W A S D, turn with the arrow keys or drag the view, and click a physical control or press E when aiming at it. Touch and keyboard station controls provide equivalent navigation without requiring pointer lock or a headset.

1. **Power routing.** Observe the target lights above three switches. Switches share circuits: the first flips lamps 1 and 2, the second flips 2 and 3, and the third flips 3. Match the target. The room lights brighten.
2. **Signal receiver.** Read a three-note treble-clef inscription and play it on the physical receiver keys. Notes make piano sounds. The receiver resets on an incorrect sequence; hints reveal note names. A correct sequence activates the receiver and piano console.
3. **Piano relay.** Use the instrument to open the existing engraved score and piano input. A valid performance scoring 70 restores the transmission. Rehearsals and aids are allowed for this story puzzle. Acoustic players can explicitly confirm their unscored performance after a take, which changes only story progress.
4. **Airlock.** All three systems must be restored. The door panels physically slide apart, and interacting with the airlock moves to the next location.

The ten locations use three environment families: observatories, botanical habitats and archives. Each has its own place name, transmission, palette, target circuit and receiver inscription. The final relay ends the story. Scene and story progress persist in the browser independently of reading ratings.

## What stays separate

Musical difficulty follows the existing learner profile, not the story location number. A beginner can explore the entire narrative at a manageable reading difficulty. The original generation and grading algorithms remain intact. Fresh-read promotion, replay detection and practice-only evidence retain their existing rules. The story's 70-point threshold is a design starting point, not a validated mastery standard.

Practice configuration, music generation tools, reading progress and the earlier musical map remain available from the pause menu. The main experience has no website header or tabs. The embedded piano view keeps the conventional score, input controls and coaching because those are necessary to the musical task.

## Technical and product limits

This is a browser-based first-person adventure implementation, not a VR game or a Red Matter-scale art production. Its spaces use lightweight 3D geometry, a shared compressed backdrop, one shadow-casting light, and no physics engine or model downloads. A reduced-motion setting suppresses decorative movement. A non-WebGL navigation fallback retains every puzzle.

The ten rooms reuse three architectural families and the same three puzzle mechanics; bespoke puzzles and production art for every location remain a further design phase. The piano console currently opens a focused instrument overlay rather than rendering interactive engraving directly on a 3D monitor. Those are the two largest remaining opportunities to deepen immersion.

Real browser, device, audio and student playtesting is still needed. Automated tests cover circuit solvability for every room, receiver resets, puzzle prerequisites, exit gating, the final location boundary and story assessment acceptance. They do not establish visual quality, educational effectiveness or universal device compatibility.
