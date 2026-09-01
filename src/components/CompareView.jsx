// Positioning page. It states plainly what the two established products do
// well, where they fall down for pianists, and which of those gaps this app
// actually closes — including the ones it does not.

const ROWS = [
  {
    feature: 'Where the music comes from',
    srf: 'Generated on demand, unlimited',
    tree: 'A fixed library of real pieces',
    us: 'Generated on demand from real functional harmony',
    us_win: true,
  },
  {
    feature: 'Can you memorise your way through it?',
    srf: 'No — always new',
    tree: 'Eventually yes; the library is finite',
    us: 'No — every exercise is new, with exact reproducible links',
    us_win: true,
  },
  {
    feature: 'Does the piano writing sound like music?',
    srf: 'The common complaint: odd progressions, thin left hand',
    tree: 'Yes — it is real repertoire',
    us: 'Planned cadences, voice-led left hand, real accompaniment patterns',
  },
  {
    feature: 'Does it hear what you played?',
    srf: 'No. It shows notes and stops there',
    tree: 'Yes — MIDI and microphone',
    us: 'Yes — MIDI, or the on-screen and computer keyboard',
    us_win: true,
  },
  {
    feature: 'Does it make you read ahead of your hands?',
    srf: 'No — the page just sits there',
    tree: 'Keeps the music moving, but every note stays visible',
    us: 'A curtain hides the music as you reach it, up to a full bar ahead',
    us_win: true,
  },
  {
    feature: 'Does a replay count as sight-reading?',
    srf: 'No scoring at all, so the question does not arise',
    tree: 'Repeat practice on a piece is the point',
    us: 'No — replays and assisted takes are flagged and cannot advance your level',
  },
  {
    feature: 'Does it tell you which skill is failing?',
    srf: 'No',
    tree: 'Shows where you went wrong in the piece',
    us: 'Every note is attributed to a skill; the weakest ones are named',
    us_win: true,
  },
  {
    feature: 'Does the next exercise target your weakness?',
    srf: 'Only if you set the parameters yourself',
    tree: 'Progresses by level, not by diagnosis',
    us: 'Weak skills bend the generator automatically',
    us_win: true,
  },
  {
    feature: 'Control over range and ledger lines',
    srf: 'Reviewers report this is hard to set usefully',
    tree: 'Fixed by whatever the piece does',
    us: 'Explicit per-hand range sliders, in staff steps',
    us_win: true,
  },
  {
    feature: 'Sharing an exercise with a class',
    srf: 'Yes, via teacher/student accounts',
    tree: 'Assign pieces from the library',
    us: 'An exact link carrying the seed and setup. No accounts on either end',
  },
  {
    feature: 'Notation quality',
    srf: 'Publication-grade; engraving is its core competence',
    tree: 'Clean rendering of real published editions',
    us: 'Engraved by Verovio with Bravura — the engine behind scholarly editions',
  },
  {
    feature: 'Getting the music out',
    srf: 'Print and PDF',
    tree: 'Not the focus',
    us: 'Print, or export MusicXML into MuseScore, Finale or Sibelius',
    us_win: true,
  },
  {
    feature: 'Printing',
    srf: 'Yes — a core feature',
    tree: 'Not the focus',
    us: 'Yes — print the score straight from the page',
  },
  {
    feature: 'Instruments beyond piano',
    srf: 'Many, plus voice and full ensembles',
    tree: 'Piano only',
    us: 'Piano only — this is where it is deliberately narrow',
    us_win: false,
    us_loss: true,
  },
  {
    feature: 'Real repertoire by real composers',
    srf: 'No',
    tree: 'Yes — thousands of pieces',
    us: 'No. Generated study material only',
    us_loss: true,
  },
  {
    feature: 'Classroom tooling (rosters, assessment records)',
    srf: 'Yes, including live ensemble casting',
    tree: 'Teacher features available',
    us: 'Not yet. Share links and printing only',
    us_loss: true,
  },
  {
    feature: 'Cost',
    srf: 'Subscription',
    tree: 'Subscription after a trial',
    us: 'No subscription; practice data stays in your browser',
    us_win: true,
  },
];

export default function CompareView() {
  return (
    <div className="sr-compare">
      <section className="sr-panel">
        <h3>The gap this is built for</h3>
        <p>
          The two best-known options solve opposite halves of the same problem. <b>Sight Reading
          Factory</b> generates unlimited material but never hears you play, and pianists
          consistently report that its generated piano writing sounds computer-made — odd chord
          progressions and a thin left hand. <b>Piano Tree</b> hears every note through MIDI and
          gives real feedback, but it draws on a finite library, so the material eventually becomes
          familiar and the progression is by level rather than by diagnosis.
        </p>
        <p>
          Unlimited generation and real-time listening have never been in the same product. Putting
          them together makes a third thing possible: an exercise generator that <i>knows what you
          just got wrong</i> and writes the next exercise around it.
        </p>
      </section>

      <section className="sr-panel">
        <h3>Side by side</h3>
        <div className="sr-tablewrap">
          <table className="sr-table">
            <thead>
              <tr>
                <th scope="col">&nbsp;</th>
                <th scope="col">Sight Reading Factory</th>
                <th scope="col">Piano Tree</th>
                <th scope="col">Prima Vista</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.feature}>
                  <th scope="row">{r.feature}</th>
                  <td>{r.srf}</td>
                  <td>{r.tree}</td>
                  <td className={r.us_win ? 'is-win' : r.us_loss ? 'is-loss' : ''}>{r.us}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sr-hint">
          The last three rows are the honest ones. If you need band and choir parts, an assessment
          record for thirty students, or graded Bach, the established products still win.
        </p>
      </section>
    </div>
  );
}
