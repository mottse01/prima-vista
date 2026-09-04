import { useEffect, useRef, useState } from 'react';
import { levelById } from '../core/levels.js';

const STARTING_POINTS = [
  {
    level: 1,
    label: 'New to reading',
    cue: 'I am still learning staff notes and steady quarter-note pulse.',
  },
  {
    level: 3,
    label: 'Early reader',
    cue: 'I can read both staves, eighth notes, and easy pieces in a few familiar keys.',
  },
  {
    level: 5,
    label: 'Developing',
    cue: 'I can keep going through position changes, broken chords, and simple sixteenth patterns.',
  },
  {
    level: 7,
    label: 'Confident',
    cue: 'I read compound metre, triplets, several keys, and fuller two-hand textures.',
  },
  {
    level: 9,
    label: 'Advanced',
    cue: 'I am comfortable with irregular metre, independent lines, and chromatic harmony.',
  },
];

export default function OnboardingModal({ onChoose }) {
  const [selected, setSelected] = useState(3);
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const level = levelById(selected);

  return (
    <div className="sr-onboarding-backdrop">
      <section
        className="sr-onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sr-onboarding-title"
        aria-describedby="sr-onboarding-description"
      >
        <span className="sr-eyebrow">Your starting point</span>
        <h2 id="sr-onboarding-title" ref={headingRef} tabIndex="-1">Choose a first reading level.</h2>
        <p id="sr-onboarding-description">
          Pick the statement that sounds most like you. Your first study will be at least eight bars,
          and you can move to any level from The path at any time.
        </p>

        <div className="sr-onboarding-options" role="radiogroup" aria-label="Starting difficulty">
          {STARTING_POINTS.map((option) => {
            const active = selected === option.level;
            return (
              <label key={option.level} className={`sr-onboarding-option${active ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="starting-level"
                  value={option.level}
                  checked={active}
                  onChange={() => setSelected(option.level)}
                />
                <span className="sr-onboarding-level">Level {option.level}</span>
                <strong>{option.label}</strong>
                <span>{option.cue}</span>
              </label>
            );
          })}
        </div>

        <div className="sr-onboarding-summary" aria-live="polite">
          <span>First study</span>
          <strong>{level.name}</strong>
          <span>{level.blurb}</span>
        </div>

        <div className="sr-onboarding-actions">
          <span>Not sure? “Early reader” is a balanced diagnostic start.</span>
          <button type="button" className="sr-btn sr-btn--primary sr-btn--large" onClick={() => onChoose(selected)}>
            Start at level {selected}
          </button>
        </div>
      </section>
    </div>
  );
}
