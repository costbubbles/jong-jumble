import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePuzzle } from '../js/core/generator.js';
import { applyMove, boardsEqual, inverseMove } from '../js/core/board.js';
import { evaluateBoard, isBoardSolved } from '../js/core/yaku.js';
import { counts34 } from '../js/core/tiles.js';
import { DIFFICULTIES } from '../js/config.js';
import { computeScore } from '../js/core/scoring.js';

test('same seed + difficulty gives the same puzzle', () => {
  const a = generatePuzzle('hello', 'medium');
  const b = generatePuzzle('hello', 'medium');
  assert.ok(boardsEqual(a.board, b.board));
  assert.deepEqual(a.scramble, b.scramble);
  assert.ok(!boardsEqual(a.board, generatePuzzle('hello2', 'medium').board));
});

for (const difficulty of Object.keys(DIFFICULTIES)) {
  test(`${difficulty}: 40 seeds generate valid, solvable puzzles`, () => {
    for (let i = 0; i < 40; i++) {
      const p = generatePuzzle(`seed-${i}`, difficulty);
      assert.equal(p.board.cells.length, DIFFICULTIES[difficulty].rows);
      assert.ok(isBoardSolved(p.solved), 'solved board must be solved');

      // Per-row tile limits on the solved board.
      for (const row of p.solved.cells) {
        const counts = counts34(row.map((c) => c.tile));
        assert.ok(counts.every((n) => n <= 4), 'more than 4 copies in a row');
        for (const st of 'mps') {
          assert.ok(row.filter((c) => c.tile === `0${st}`).length <= 1, 'two red fives of one suit');
        }
      }

      // Scrambled start has no solved row.
      assert.ok(evaluateBoard(p.board).every((e) => !e.solved), 'scrambled board has a solved row');

      // Replaying the inverse scramble returns to the solved board.
      let b = p.board;
      for (const m of [...p.scramble].reverse()) b = applyMove(b, inverseMove(m));
      assert.ok(boardsEqual(b, p.solved));
    }
  });
}

test('scoring formula', () => {
  // shantenSum = (2+1)+(1+1) = 5; 5/10 * (10 + 40) * 1000 = 25000
  assert.equal(computeScore({ startShanten: [2, 1], moves: 10, seconds: 60, solved: true }), 25000);
  // time term clamps at base 10 after timeCap seconds
  assert.equal(computeScore({ startShanten: [2, 1], moves: 10, seconds: 500, solved: true }), 5000);
  assert.equal(computeScore({ startShanten: [2, 1], moves: 10, seconds: 5, solved: false }), 0);
});
