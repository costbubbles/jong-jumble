// Game configuration. Every tunable default lives here.
// This module is shared by the browser client, the server and the tests, so keep it plain data
// (plus the scoring formula) with no DOM or Node-specific code.

// ---------------------------------------------------------------------------
// Scoring (single player and multiplayer both use this)
// ---------------------------------------------------------------------------
// score = ((Σ(startShanten + 1) / moves) × (base + max(0, floor(timeCap − seconds)))) × multiplier
//         × (Π handPoints / max(1, ceil(seconds − handTimeOffset)))
//   shantenSum : sum over rows of (row shanten on the scrambled start board + 1)
//   moves      : moves made, undo included
//   seconds    : time from first move to solve
//   handPoints : each solved row's riichi tsumo value in points (e.g. [2000, 3900, 8000])
// An unsolved round always scores 0 (handled in js/core/scoring.js).
export const SCORING = {
  base: 10,
  timeCap: 100,
  multiplier: 1000,
  handTimeOffset: 30,
  formula({ shantenSum, moves, seconds, handPoints }) {
    const timeTerm = this.base + Math.max(0, Math.floor(this.timeCap - seconds));
    const handProduct = handPoints.reduce((product, p) => product * p, 1);
    const handTerm = handProduct / Math.max(1, Math.ceil(seconds - this.handTimeOffset));
    return (shantenSum / moves) * timeTerm * this.multiplier * handTerm;
  },
  // How the raw formula value is turned into the displayed integer.
  round: Math.round,
};

// ---------------------------------------------------------------------------
// Difficulty presets
// ---------------------------------------------------------------------------
// openSetWeights[k] = relative chance that a row is generated with k open sets (chains).
export const DIFFICULTIES = {
  easy:   { label: 'Easy',   rows: 2, scrambleMoves: 20, openSetWeights: [0.6, 0.4] },
  medium: { label: 'Medium', rows: 3, scrambleMoves: 40, openSetWeights: [0.45, 0.4, 0.15] },
  hard:   { label: 'Hard',   rows: 4, scrambleMoves: 70, openSetWeights: [0.35, 0.4, 0.25] },
};
export const DEFAULT_DIFFICULTY = 'easy';

// ---------------------------------------------------------------------------
// Puzzle generation
// ---------------------------------------------------------------------------
export const GENERATION = {
  cols: 13,                               // playfield width (+1 fixed winning-tile column)
  roundWinds: ['1z', '2z'],               // East / South round, picked per puzzle
  seatWinds: ['1z', '2z', '3z', '4z'],    // row i gets seatWinds[i % 4]
  chiitoiChance: 0.06,                    // closed rows only
  ponChance: 0.35,                        // chance each set is a triplet instead of a sequence
  redFiveChance: 0.35,                    // per suit, when the row contains a 5 of that suit
  // Themes used to steer open hands toward having a yaku (relative weights).
  openThemes: { yakuhai: 0.45, tanyao: 0.3, honitsu: 0.2, free: 0.05 },
  maxRowAttempts: 500,
  // After the scramble, keep adding moves (up to this many) while any row is still solved.
  maxExtraScrambleMoves: 200,
  randomSeedLength: 8,
};

// ---------------------------------------------------------------------------
// User interface
// ---------------------------------------------------------------------------
export const UI = {
  tileScale: 2,          // sprites are 32×32; drawn at 32 × tileScale px
  animationMs: 120,
  hintsDefault: true,    // row glow, shanten counter, "no yaku" marker
};

// ---------------------------------------------------------------------------
// Multiplayer (defaults for the host's match settings)
// ---------------------------------------------------------------------------
export const MULTIPLAYER = {
  port: 8080,
  rounds: 3,
  maxRounds: 9,
  roundTimeLimitSec: 180,
  countdownSec: 3,
  hints: true,
  // Tie in match totals: 'fewerSeconds' (less total solve time wins), or 'draw'.
  tiebreak: 'fewerSeconds',
  roomCodeLength: 5,
};
