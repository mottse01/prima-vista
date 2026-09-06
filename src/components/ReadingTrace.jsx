import { useMemo } from 'react';

// A star chart of one reading.
//
// The timing strip answers "where did I drift". This answers a different
// question: what did the whole take look like? Time runs left to right and
// pitch runs bottom to top, so the drawing has the shape of the music — and
// because every take produces a different figure, it is the one thing here
// worth keeping a picture of.
//
// Each attack is a star. It is bright when it landed on time, dim when it was
// late, hollow when it never sounded at all.

const W = 720;
const H = 260;
const PAD_X = 18;
const PAD_Y = 22;

const HAND_HUE = { rh: 190, lh: 38 };

export default function ReadingTrace({ result, title }) {
  const stars = useMemo(() => {
    const timeline = result.timeline || [];
    if (!timeline.length) return null;
    const total = result.totalTicks || Math.max(...timeline.map((note) => note.onset)) || 1;
    const pitches = timeline.map((note) => note.midi).filter(Number.isFinite);
    if (!pitches.length) return null;
    const low = Math.min(...pitches);
    const high = Math.max(...pitches);
    const span = Math.max(6, high - low);

    return timeline.map((note) => {
      const x = PAD_X + (note.onset / total) * (W - PAD_X * 2);
      const y = H - PAD_Y - ((note.midi - low) / span) * (H - PAD_Y * 2);
      // A note that arrived on time burns brightest. One that was late still
      // sounded, so it is drawn dimmer rather than removed.
      const accuracy = note.delta == null
        ? 0
        : Math.max(0, 1 - Math.abs(note.delta) / Math.max(result.window, 0.001));
      return {
        ...note,
        x,
        y,
        accuracy,
        radius: note.verdict === 'correct' ? 2.1 + accuracy * 2.2 : 2,
      };
    });
  }, [result]);

  if (!stars) return null;

  const trails = ['rh', 'lh'].map((hand) => ({
    hand,
    points: stars.filter((star) => star.hand === hand && star.verdict !== 'missed'),
  })).filter((trail) => trail.points.length > 1);

  return (
    <figure className="sr-trace">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`A star chart of this reading of ${title}. Time runs left to right, pitch bottom to top.`}>
        <defs>
          <radialGradient id="sr-trace-sky" cx="50%" cy="0%" r="110%">
            <stop offset="0%" stopColor="rgba(95,201,184,.14)" />
            <stop offset="70%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} className="sr-trace-ground" />
        <rect x="0" y="0" width={W} height={H} fill="url(#sr-trace-sky)" />

        {trails.map((trail) => (
          <polyline
            key={trail.hand}
            className="sr-trace-trail"
            style={{ '--trace-hue': HAND_HUE[trail.hand] }}
            points={trail.points.map((star) => `${star.x.toFixed(1)},${star.y.toFixed(1)}`).join(' ')}
          />
        ))}

        {stars.map((star, index) => {
          const hue = HAND_HUE[star.hand] ?? 190;
          if (star.verdict === 'missed') {
            return (
              <circle
                key={index} cx={star.x} cy={star.y} r={star.radius}
                className="sr-trace-missed" style={{ '--trace-hue': hue }}
              />
            );
          }
          if (star.verdict === 'wrong') {
            return (
              <g key={index} className="sr-trace-wrong">
                <line x1={star.x - 3} y1={star.y - 3} x2={star.x + 3} y2={star.y + 3} />
                <line x1={star.x - 3} y1={star.y + 3} x2={star.x + 3} y2={star.y - 3} />
              </g>
            );
          }
          return (
            <g key={index}>
              {star.accuracy > 0.55 && (
                <circle
                  cx={star.x} cy={star.y} r={star.radius * 2.1}
                  className="sr-trace-halo" style={{ '--trace-hue': hue, opacity: (star.accuracy - 0.55) * 0.42 }}
                />
              )}
              <circle
                cx={star.x} cy={star.y} r={star.radius}
                className="sr-trace-star"
                style={{ '--trace-hue': hue, '--trace-light': 55 + star.accuracy * 35 }}
              />
            </g>
          );
        })}
      </svg>
      <figcaption>
        Your reading, as a star chart. Time runs left to right, pitch bottom to top.
        Treble is blue and bass is gold; a star burns brighter the closer it landed to the beat,
        and a hollow one never sounded.
      </figcaption>
    </figure>
  );
}
