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

export default function OnboardingModal({ onChoose, onDismiss }) {
  const [selected, setSelected] = useState(1);
  const [step, setStep] = useState('level');
  const [inputMode, setInputMode] = useState('screen');
  const [comfortView, setComfortView] = useState(false);
  const headingRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const backdrop = dialog.parentElement;
    const siblings = [...backdrop.parentElement.children].filter((element) => element !== backdrop);
    const original = siblings.map((element) => ({ element, inert: element.inert }));
    siblings.forEach((element) => { element.inert = true; });
    const focusables = () => [...dialog.querySelectorAll('button, select, input, [href], [tabindex="0"]')]
      .filter((element) => !element.disabled && element.getClientRects().length
        && (element.type !== 'radio' || element.checked));
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onDismiss?.(); return; }
      if (event.key !== 'Tab') return;
      const elements = focusables();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    const keepFocus = (event) => {
      if (!dialog.contains(event.target)) headingRef.current?.focus();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', keepFocus);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', keepFocus);
      original.forEach(({ element, inert }) => { element.inert = inert; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onDismiss]);
  useEffect(() => { headingRef.current?.focus(); }, [step]);

  const startingLevel = Math.max(1, selected - 1);
  const level = levelById(startingLevel);

  return (
    <div className="sr-onboarding-backdrop">
      <section
        ref={dialogRef}
        className="sr-onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sr-onboarding-title"
        aria-describedby="sr-onboarding-description"
      >
        <span className="sr-eyebrow">Welcome · {step === 'level' ? '1 of 2' : '2 of 2'}</span>
        <button className="sr-onboarding-close" type="button" onClick={onDismiss} aria-label="Close welcome and explore practice">×</button>
        <h2 id="sr-onboarding-title" ref={headingRef} tabIndex="-1">
          {step === 'level' ? 'Choose a comfortable starting point.' : 'How will you play today?'}
        </h2>
        <p id="sr-onboarding-description">
          {step === 'level'
            ? 'Choose what feels familiar. We start one step easier, then use three fresh reads to suggest a comfortable level.'
            : 'Choose the input that matches your piano. You can change it later under Sound & keyboard.'}
        </p>

        {step === 'level' ? <>
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
            <span>Provisional start · Level {startingLevel}</span>
            <strong>{level.name}</strong>
            <span>{level.blurb}</span>
          </div>
        </> : <>
          <div className="sr-input-choices" role="radiogroup" aria-label="Piano input">
            {[
              ['midi', 'Digital piano', 'Connect with MIDI for the most precise note and timing feedback.'],
              ['microphone', 'Acoustic piano', 'Play without a score or level penalty. Optional single-note detection is experimental; chords are not assessed.'],
              ['screen', 'Screen or computer keys', 'Practice now with the on-screen keyboard or your computer keyboard.'],
            ].map(([id, label, detail]) => (
              <label key={id} className={`sr-input-choice${inputMode === id ? ' is-on' : ''}`}>
                <input type="radio" name="input-mode" checked={inputMode === id} onChange={() => setInputMode(id)} />
                <span aria-hidden="true">{id === 'midi' ? '⌨' : id === 'microphone' ? '●' : '▤'}</span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </label>
            ))}
          </div>
          <label className="sr-comfort-choice">
            <input type="checkbox" checked={comfortView} onChange={(event) => setComfortView(event.target.checked)} />
            <span><strong>Comfort view</strong><small>Larger text, roomier controls, and stronger contrast.</small></span>
          </label>
        </>}

        <div className="sr-onboarding-actions">
          <span>{step === 'level' ? 'Every guided study is at least eight bars.' : 'A five-minute daily practice is ready for you.'}</span>
          <div className="sr-row">
            {step === 'input' && <button type="button" className="sr-btn" onClick={() => setStep('level')}>Back</button>}
            <button
              type="button" className="sr-btn sr-btn--primary sr-btn--large"
              onClick={() => step === 'level'
                ? setStep('input')
                : onChoose(startingLevel, { inputMode, comfortView })}
            >{step === 'level' ? 'Next: choose your piano' : `Start level ${startingLevel} check`}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
