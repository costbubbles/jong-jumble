// Score calculation. The formula and its constants live in js/config.js (SCORING).

import { SCORING } from '../config.js';

/**
 * @param {object} p
 * @param {number[]} p.startShanten  per-row shanten of the scrambled start board
 * @param {number[]} p.handPoints    per-row hand value in points (solved board)
 * @param {number} p.moves           moves made (undo included)
 * @param {number} p.seconds         seconds from first move to solve
 * @param {boolean} p.solved         unsolved rounds score 0
 */
export function computeScore({ startShanten, handPoints, moves, seconds, solved }) {
  if (!solved || moves <= 0) return 0;
  const shantenSum = startShanten.reduce((sum, s) => sum + s + 1, 0);
  return SCORING.round(SCORING.formula({ shantenSum, moves, seconds, handPoints }));
}
