// What counts as evidence about sight-reading.
//
// One rule, shared by placement, promotion, the mission objectives and the
// progress charts: a first read is the only take that measures reading at
// sight. A replay knows the music, an assisted take had help, and an Eclipse
// take measures look-ahead rather than note knowledge.

import { SCORING_VERSION } from './grader.js';

/** Shared first-read rule for placement, promotion and comparable evidence. */
export function eligibleFirstRead({
  summary, fresh = true, takeIndex = 1, assisted = false, curtain = 'off',
}) {
  return summary?.valid !== false && summary?.assessmentEligible !== false
    && fresh && takeIndex === 1 && !assisted && (!curtain || curtain === 'off');
}

/** Recorded takes at one level that are comparable with each other. */
export function comparableReads(profile, level = profile?.level) {
  return (profile?.history || []).filter((take) => take.level === level
    && take.scoringVersion === SCORING_VERSION && !take.repeat && !take.assisted && !take.curtain);
}
