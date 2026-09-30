import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoard, applyMove, inverseMove, legalMoves, boardsEqual, columnMoveSet, rowHand, canMove, expandSelection,
} from '../js/core/board.js';
import { createRng } from '../js/core/rng.js';

const tilesOf = (board, r) => board.cells[r].map((c) => c.tile).join(' ');

test('row shift moves loose tiles by one', () => {
  const b = createBoard({ rows: ['123456789m12345p'] });
  const left = applyMove(b, { type: 'row', row: 0, dir: 'left' });
  assert.equal(tilesOf(left, 0), '2m 3m 4m 5m 6m 7m 8m 9m 1p 2p 3p 4p 1m');
  assert.equal(left.winTiles[0], '5p'); // the winning tile never moves
  const right = applyMove(b, { type: 'row', row: 0, dir: 'right' });
  assert.equal(tilesOf(right, 0), '4p 1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 2p 3p');
});

test('row shift wraps a chain as one unit', () => {
  const b = createBoard({ rows: ['[222z] 123456789m11p'] });
  const left = applyMove(b, { type: 'row', row: 0, dir: 'left' });
  assert.equal(tilesOf(left, 0), '1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 2z 2z 2z');
  assert.deepEqual(left.cells[0].slice(10).map((c) => c.chain), ['r0c0', 'r0c0', 'r0c0']);
  const back = applyMove(left, { type: 'row', row: 0, dir: 'right' });
  assert.ok(boardsEqual(b, back));
});

test('column with no chain moves alone', () => {
  const b = createBoard({ rows: ['123456789m12345p', '99999m99999p9999s'] });
  assert.deepEqual(columnMoveSet(b, 0), [0]);
  const up = applyMove(b, { type: 'col', col: 0, dir: 'up' });
  assert.equal(up.cells[0][0].tile, '9m');
  assert.equal(up.cells[1][0].tile, '1m');
  assert.equal(up.cells[0][1].tile, '2m');
});

test('aligned chains move all their columns and change rows', () => {
  const b = createBoard({ rows: ['123456789m1p [222z] 1p', '123456789p1s [555z] 1s'] });
  assert.deepEqual(columnMoveSet(b, 12), [10, 11, 12]);
  const down = applyMove(b, { type: 'col', col: 12, dir: 'down' });
  assert.equal(tilesOf(down, 0), '1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 5z 5z 5z');
  assert.equal(tilesOf(down, 1), '1p 2p 3p 4p 5p 6p 7p 8p 9p 1s 2z 2z 2z');
  assert.deepEqual(down.winTiles, ['1p', '1s']);
  const hand = rowHand(down, 1);
  assert.equal(hand.melds.length, 1);
  assert.equal(hand.melds[0].type, 'pon');
});

test('misaligned chains block vertical moves', () => {
  // Row 0 chain at cols 3-5, row 1 chain at cols 4-6.
  const b = createBoard({ rows: ['123m [222z] 456789m11p', '1234m [333z] 56789m11p'] });
  for (const col of [3, 4, 5, 6]) {
    assert.equal(canMove(b, { type: 'col', col, dir: 'up' }), false, `col ${col} should be blocked`);
  }
  assert.equal(canMove(b, { type: 'col', col: 0, dir: 'up' }), true);
  assert.equal(canMove(b, { type: 'col', col: 7, dir: 'down' }), true);
  // Row moves are always legal.
  assert.equal(canMove(b, { type: 'row', row: 0, dir: 'left' }), true);
});

test('illegal / malformed moves return null', () => {
  const b = createBoard({ rows: ['123456789m12345p'] });
  assert.equal(applyMove(b, { type: 'row', row: 5, dir: 'left' }), null);
  assert.equal(applyMove(b, { type: 'col', col: 13, dir: 'up' }), null);
  assert.equal(applyMove(b, { type: 'row', row: 0, dir: 'up' }), null);
});

test('every legal move is undone by its inverse (random walk)', () => {
  const rng = createRng('inverse-test');
  let b = createBoard({
    rows: ['123m [222z] 456789m11p', '[777z] 123456789s11p', '1234m [333z] 56789m11p', '123456789m1p [111z] 1p'],
  });
  for (let i = 0; i < 2000; i++) {
    const move = rng.pick(legalMoves(b));
    const next = applyMove(b, move);
    const back = applyMove(next, inverseMove(move));
    assert.ok(back, `inverse of ${JSON.stringify(move)} was illegal`);
    assert.ok(boardsEqual(b, back), `inverse of ${JSON.stringify(move)} did not restore the board`);
    b = next;
  }
});

// ---------------------------------------------------------------------------
// Drag & drop mode
// ---------------------------------------------------------------------------

const drop = (row, start, len, toRow, col) => ({ type: 'drop', from: { row, start, len }, to: { row: toRow, col } });

test('drop within a row reorders and closes the gap', () => {
  const b = createBoard({ rows: ['123456789m1234p 5p'] });
  // move "2m 3m" (cols 1-2) so it starts at col 5
  const next = applyMove(b, drop(0, 1, 2, 0, 5));
  assert.equal(tilesOf(next, 0), '1m 4m 5m 6m 7m 2m 3m 8m 9m 1p 2p 3p 4p');
  assert.ok(boardsEqual(applyMove(next, inverseMove(drop(0, 1, 2, 0, 5))), b));
  assert.equal(applyMove(b, drop(0, 1, 2, 0, 1)), null); // no-op
});

test('drop into another row swaps with the tiles there', () => {
  const b = createBoard({ rows: ['123456789m1234p 5p', '123456789s1234p 5s'] });
  const next = applyMove(b, drop(0, 0, 3, 1, 10));
  assert.equal(tilesOf(next, 0), '2p 3p 4p 4m 5m 6m 7m 8m 9m 1p 2p 3p 4p');
  assert.equal(tilesOf(next, 1), '1s 2s 3s 4s 5s 6s 7s 8s 9s 1p 1m 2m 3m');
  assert.deepEqual(next.winTiles, ['5p', '5s']);
  assert.ok(boardsEqual(applyMove(next, inverseMove(drop(0, 0, 3, 1, 10))), b));
});

test('drops that would split a chain are refused', () => {
  const b = createBoard({ rows: ['12m [222z] 3456789m1p 5p', '123456789s1234p 5s'] });
  assert.equal(applyMove(b, drop(0, 2, 2, 1, 0)), null);      // part of the chain
  assert.equal(applyMove(b, drop(1, 0, 1, 0, 3)), null);      // swapping into the middle of it
  assert.equal(applyMove(b, drop(0, 0, 1, 0, 3)), null);      // reinserting inside it
  const whole = applyMove(b, drop(0, 2, 3, 1, 0));            // the whole chain moves rows
  assert.ok(whole);
  assert.equal(rowHand(whole, 1).melds[0].type, 'pon');
  assert.deepEqual(expandSelection(b, { row: 0, start: 3, len: 1 }), { row: 0, start: 2, len: 3 });
  assert.deepEqual(expandSelection(b, { row: 0, start: 1, len: 2 }), { row: 0, start: 1, len: 4 });
});
