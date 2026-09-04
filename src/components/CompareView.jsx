// Positioning page. Competitor details are deliberately conservative and
// based on each product's public feature pages rather than old assumptions.

const ROWS = [
  {
    feature: 'Practice material',
    srf: 'Unlimited generated exercises for piano and 60+ instruments/voice types',
    tree: 'A large library of graded repertoire and focus packs',
    us: 'Unlimited piano studies generated from functional harmony',
  },
  {
    feature: 'Performance feedback',
    srf: 'Auto Assessment reports accuracy and timing',
    tree: 'Real-time feedback while the music keeps moving',
    us: 'Per-note pitch, pulse, continuity, timing bias and recovery',
  },
  {
    feature: 'Piano input',
    srf: 'MIDI for piano Auto Assessment; recording workflows for assignments',
    tree: 'MIDI or device microphone',
    us: 'MIDI, on-screen piano or computer keyboard',
  },
  {
    feature: 'Read-ahead training',
    srf: 'Optional disappearing measures',
    tree: 'Read-ahead mode hides the current bar',
    us: 'Adjustable vanishing notes from just played to a full bar ahead',
  },
  {
    feature: 'What changes after a weak read?',
    srf: 'The learner or teacher adjusts the next exercise',
    tree: 'Structured path and focused practice packs',
    us: 'The next generated study isolates one measured weak skill automatically',
    us_win: true,
  },
  {
    feature: 'Fresh-read integrity',
    srf: 'Unlimited generation keeps material fresh',
    tree: 'Library and imported-piece practice support repetition',
    us: 'Replays, previews and guide-assisted takes are labelled and cannot advance the path',
    us_win: true,
  },
  {
    feature: 'Custom exercise control',
    srf: 'Deep controls across rhythms, range, leaps, keys and notation',
    tree: 'Tempo, transposition, looping and focus settings on pieces',
    us: 'Per-hand range, texture, harmony, rhythm, notation and reproducible seeds',
  },
  {
    feature: 'Share or assign',
    srf: 'Class rosters, assignments, assessment and live practice',
    tree: 'Teacher workflows and a synced account',
    us: 'Exact exercise links and print; no roster or gradebook',
    us_loss: true,
  },
  {
    feature: 'Existing music',
    srf: 'Generated exercises rather than repertoire',
    tree: 'Thousands of pieces plus MusicXML import on paid plans',
    us: 'Generated studies only; MusicXML export, not import',
    us_loss: true,
  },
  {
    feature: 'Privacy and account model',
    srf: 'Account and cloud-based practice/teacher records',
    tree: 'Account and synced progress',
    us: 'No account; settings and progress stay in this browser',
    us_win: true,
  },
  {
    feature: 'Price',
    srf: 'Yearly subscription',
    tree: 'Free tier plus monthly or annual plans',
    us: 'No subscription',
    us_win: true,
  },
];

const FRAMEWORK = [
  ['1', 'Form first', 'Choose a style-specific period, sentence, verse–chorus, refrain, dance, or blues grammar before writing notes.'],
  ['2', 'Harmonic function', 'Give every phrase a tonic, departure, dominant, or closing role and realise it with a common progression.'],
  ['3', 'Motif & development', 'State a short idea, then repeat, vary, sequence, fragment, contrast, or return it according to the form.'],
  ['4', 'Melodic craft', 'Anchor phrase openings, shape one climax, favour singable motion, and resolve leaps and tendency tones.'],
  ['5', 'Traditional notation', 'Group rhythm by the metre, beam subdivisions conventionally, and let a professional engraver handle spacing and collisions.'],
  ['6', 'Composition review', 'Generate 16 candidates, inspect the realised harmony and notes, reject rule failures, and serve the strongest score.'],
];

export default function CompareView() {
  return (
    <div className="sr-compare">
      <section className="sr-panel sr-positioning">
        <span className="sr-eyebrow">Why Prima Vista</span>
        <h2>The differentiator is the loop, not a longer feature list.</h2>
        <p>
          Sight Reading Factory is a mature generator with assessment and classroom tools. Piano
          Tree combines a large repertoire library with MIDI or microphone feedback and read-ahead
          practice. Prima Vista takes a narrower route: it measures a genuinely fresh piano read,
          names the skill that broke down, and generates the next musical study around that evidence.
        </p>
        <div className="sr-loop" aria-label="Prima Vista practice loop">
          <span>Read fresh music</span><b aria-hidden="true">→</b>
          <span>Measure the breakdown</span><b aria-hidden="true">→</b>
          <span>Generate the next study</span>
        </div>
      </section>

      <section className="sr-panel">
        <span className="sr-eyebrow">The composition framework</span>
        <h3>Generated does not have to mean random.</h3>
        <p>
          Prima Vista works in the same order a careful miniaturist would: large-scale form first,
          then harmonic direction, motivic development, melodic detail, engraving, and a final critique.
          The reference profiles describe musical traits; they do not copy melodies from repertoire.
        </p>
        <ol className="sr-framework-grid">
          {FRAMEWORK.map(([number, title, detail]) => (
            <li key={number}>
              <span>{number}</span>
              <div><strong>{title}</strong><p>{detail}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="sr-panel">
        <h3>An honest side-by-side</h3>
        <div className="sr-tablewrap">
          <table className="sr-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Sight Reading Factory</th>
                <th scope="col">Piano Tree</th>
                <th scope="col">Prima Vista</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.feature}>
                  <th scope="row">{row.feature}</th>
                  <td>{row.srf}</td>
                  <td>{row.tree}</td>
                  <td className={row.us_win ? 'is-win' : row.us_loss ? 'is-loss' : ''}>{row.us}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sr-hint">
          Product details checked against the official{' '}
          <a href="https://www.sightreadingfactory.com/" target="_blank" rel="noreferrer">Sight Reading Factory</a>{' '}
          and <a href="https://piano-tree.com/" target="_blank" rel="noreferrer">Piano Tree</a> pages.
        </p>
      </section>
    </div>
  );
}
