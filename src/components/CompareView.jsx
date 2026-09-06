const ALTERNATIVES = [
  ['Sight Reading Factory', 'Custom-generated exercises, performance assessment, and classroom workflows.',
    'https://www.sightreadingfactory.com/focus/autoAssessment'],
  ['Piano Marvel', 'An adaptive sight-reading test with a large graded excerpt bank and score history.',
    'https://pianomarvel.com/en/feature/sasr'],
  ['Piano Tree', 'Repertoire-led practice, a sight-reading test, and read-ahead tools.',
    'https://piano-tree.com/piano-sight-reading-app'],
  ['SightReader', 'Piano sight-reading practice with fresh material and performance feedback.',
    'https://sightreader.app/features'],
];

export default function CompareView() {
  return (
    <div className="sr-compare">
      <section className="sr-panel sr-positioning">
        <span className="sr-eyebrow">About Prima Vista</span>
        <h2>A little fresh music. A clearer next step.</h2>
        <p>Choose a comfortable level, scan the music, then keep a steady pulse.
          Prima Vista creates short piano studies and uses your first-read results
          to suggest a focus for the next one.</p>
        <div className="sr-loop" aria-label="Practice sequence">
          <span>Scan the music</span><b aria-hidden="true">→</b>
          <span>Keep the pulse</span><b aria-hidden="true">→</b>
          <span>Try a fresh study</span>
        </div>
      </section>
      <section className="sr-panel">
        <h3>Know what the feedback means</h3>
        <p>MIDI and on-screen input measure note attacks and their timing. They do not
          assess tone, pedaling, note release, or the musical quality of your performance.
          Microphone practice is experimental and unscored.</p>
        <p>Fresh reads, replays, and assisted practice are kept separate. Disappearing
          notes are an optional practice constraint, not an eye-tracking test.
          The ten levels are a practice guide, not exam grades or a certified assessment.</p>
        <p>Studies use phrase plans, functional harmony, and recurring motifs.
          Automated composition checks catch specific rule problems; they cannot replace
          a piano teacher's judgment.</p>
      </section>
      <section className="sr-panel">
        <h3>Other tools worth knowing</h3>
        <p>Different tools serve different needs. These descriptions summarize their
          published features, not an independent comparison of learning outcomes.</p>
        <div className="sr-framework-grid">
          {ALTERNATIVES.map(([name, detail, url]) => (
            <div key={name}>
              <h4><a href={url} target="_blank" rel="noreferrer">{name}</a></h4>
              <p>{detail}</p>
            </div>
          ))}
        </div>
        <p className="sr-hint">Official feature pages checked September 2026. Features may change.</p>
      </section>
      <section className="sr-panel">
        <h3>Your music, your pace</h3>
        <p>Use page or scrolling notation, enlarge the music, print a study, or export
          MusicXML. Practice history and settings stay in this browser; use the
          export option in Progress to keep a backup.</p>
        <p>Prima Vista does not currently provide a teacher gradebook, synchronized
          accounts, MusicXML import, or a calibrated repertoire assessment bank.</p>
      </section>
    </div>
  );
}
