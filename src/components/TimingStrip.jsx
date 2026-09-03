// Per-note timing strip.
//
// The result panel reports a single mean timing bias, which averages away the
// thing worth seeing: *where* you drifted. Usually it is not spread evenly —
// it is the bar after a leap, or the first bar of a new line. This plots every
// note's timing error against its position in the piece.

// Drawn in a wide, shallow box: the strip is a timeline, and its height is
// only there to separate rushing from dragging. The container caps the width so
// it cannot scale up into a wall of huge dots.
const W = 400;
const H = 88;
const LEFT = 40;
const RIGHT = 392;
const TOP = 10;
const ZERO = 36;
const BOTTOM = 62;
const LANE = 75; // where wrong and missed notes are marked

export default function TimingStrip({ result }) {
  const { timeline, window: matchWindow, goodTiming, totalTicks, barTicks } = result;
  const timed = timeline.filter((t) => t.delta !== null);
  if (!timed.length) {
    return (
      <p className="sr-hint sr-timingstrip">
        No notes landed close enough to time. Try again at a slower tempo.
      </p>
    );
  }

  const x = (onset) => LEFT + (totalTicks ? (onset / totalTicks) : 0) * (RIGHT - LEFT);
  const y = (delta) => {
    const clamped = Math.max(-matchWindow, Math.min(matchWindow, delta));
    return ZERO + (clamped / matchWindow) * (BOTTOM - ZERO);
  };

  const bars = [];
  if (barTicks > 0) {
    for (let t = barTicks; t < totalTicks; t += barTicks) bars.push(t);
  }

  const bandTop = y(-goodTiming);
  const bandBottom = y(goodTiming);
  const ms = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 1000)}`;

  return (
    <div className="sr-timingstrip">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Timing of every note played">
        {/* On-time band, so "close enough" is visible rather than implied. */}
        <rect className="sr-ts-band" x={LEFT} y={bandTop} width={RIGHT - LEFT} height={bandBottom - bandTop} />
        {bars.map((t) => (
          <line key={t} className="sr-ts-bar" x1={x(t)} y1={TOP} x2={x(t)} y2={LANE + 6} />
        ))}
        <line className="sr-ts-zero" x1={LEFT} y1={ZERO} x2={RIGHT} y2={ZERO} />

        <text className="sr-ts-axis" x={LEFT - 4} y={TOP + 6} textAnchor="end">{ms(-matchWindow)}</text>
        <text className="sr-ts-axis" x={LEFT - 4} y={ZERO + 3} textAnchor="end">0</text>
        <text className="sr-ts-axis" x={LEFT - 4} y={BOTTOM + 2} textAnchor="end">{ms(matchWindow)}</text>
        <text className="sr-ts-side" x={2} y={TOP + 6}>rush</text>
        <text className="sr-ts-side" x={2} y={BOTTOM + 2}>drag</text>

        {timed.map((t, i) => (
          t.hand === 'lh' ? (
            <circle
              key={i} className={`sr-ts-dot is-${t.verdict} is-lh`}
              cx={x(t.onset)} cy={y(t.delta)} r={2.4}
            />
          ) : (
            <circle
              key={i} className={`sr-ts-dot is-${t.verdict}`}
              cx={x(t.onset)} cy={y(t.delta)} r={2.4}
            />
          )
        ))}

        {timeline.filter((t) => t.verdict === 'wrong' || t.verdict === 'missed').map((t, i) => (
          <line
            key={`m${i}`} className={`sr-ts-miss is-${t.verdict}`}
            x1={x(t.onset)} y1={LANE - 6} x2={x(t.onset)} y2={LANE + 6}
          />
        ))}
      </svg>
      <div className="sr-ts-legend">
        <span><i className="sr-ts-key is-correct" /> on time</span>
        <span><i className="sr-ts-key is-timing" /> rushed or dragged</span>
        <span><i className="sr-ts-key is-lh" /> left hand</span>
        <span><i className="sr-ts-key is-wrong sr-ts-key--line" /> wrong note</span>
        <span><i className="sr-ts-key is-missed sr-ts-key--line" /> missed</span>
      </div>
    </div>
  );
}
