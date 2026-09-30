// Game configuration. Every tunable default lives here.
// This module is shared by the browser client, the server and the tests, so keep it plain data
// (plus the scoring formula) with no DOM or Node-specific code.

// ---------------------------------------------------------------------------
// Scoring (single player and multiplayer both use this)
// ---------------------------------------------------------------------------
// score = Σ handPoints / max(1, seconds − graceSeconds)
//
// Variables available to formula() (use any of them if you change it):
//   handPoints : each solved row's riichi tsumo value in points (e.g. [2000, 3900, 8000])
//   seconds    : time from first move to solve
//   moves      : moves made, undo included
//   shantenSum : sum over rows of (row shanten on the scrambled start board + 1)
// An unsolved round always scores 0 (handled in js/core/scoring.js).
export const SCORING = {
  graceSeconds: 30,   // solving within this many seconds gets the full hand total
  formula({ handPoints, seconds }) {
    const handSum = handPoints.reduce((sum, p) => sum + p, 0);
    return handSum / Math.max(1, seconds - this.graceSeconds);
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
  tileScale: 3,          // largest board tile = 32 × tileScale px (the board shrinks to fit the window)
  animationMs: 120,
  hintsDefault: true,    // row glow, shanten counter, "no yaku" marker, group boxes
  // 'shift' = arrows / drag to rotate rows and columns; 'drop' = select tiles and drag & drop them
  controlModeDefault: 'shift',
  // true = a row only wins with its tiles in left-to-right order; false = any order of a winning hand
  requireOrderDefault: true,
};

// ---------------------------------------------------------------------------
// Home screen
// ---------------------------------------------------------------------------
export const HOME = {
  shiftEveryMs: 1100,   // average time between wall shifts (randomized ±40%)
  shiftMs: 450,         // slide duration of one wall shift
};

// ---------------------------------------------------------------------------
// Multiplayer (defaults for the host's match settings)
// ---------------------------------------------------------------------------
export const MULTIPLAYER = {
  port: 8080,
  // Host's match settings: defaults and the choices offered in the lobby.
  rounds: 3,
  roundOptions: [1, 3, 5, 7, 9],
  roundTimeLimitSec: 180,
  timeLimitOptions: [60, 120, 180, 300, 600],
  hints: true,
  controlMode: 'shift',
  requireOrder: true,
  countdownSec: 3,        // "3, 2, 1" before each round
  roundBreakSec: 4,       // pause between rounds
  // Tie in match totals: 'fewerSeconds' (less total solve time wins), or 'draw'.
  tiebreak: 'fewerSeconds',
  roomCodeLength: 5,
  maxNameLength: 16,
  maxRooms: 500,
};
