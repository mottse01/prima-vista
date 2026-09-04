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
    cue: 'I can keep going through position changes, minor keys, and compound beat.',
  },
  {
    level: 7,
    label: 'Confident',
    cue: 'I read sixteenth notes, ties, syncopation, and several keys.',
  },
  {
    level: 9,
    label: 'Advanced',
    cue: 'I am comfortable with triplets, independent lines, and chromatic harmony.',
  },
];

export default function OnboardingModal({ onChoose }) {
  const [selected, setSelected] = useState(1);
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const startingLevel = Math.max(1, selected - 1);
  const level = levelById(startingLevel);

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
          Pick the statement that sounds most like you. We begin one step easier when possible so the
          first reads confirm your fluency without overwhelming you. Every study is at least eight bars.
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
          <span>Short level check</span>
          <strong>{level.name}</strong>
          <span>{level.blurb}</span>
        </div>

        <div className="sr-onboarding-actions">
          <span>You can change level at any time. Three secure fresh reads move you forward.</span>
          <button type="button" className="sr-btn sr-btn--primary sr-btn--large" onClick={() => onChoose(startingLevel)}>
            Check level {startingLevel}
          </button>
        </div>
      </section>
    </div>
  );
}
