// Board model and moves. Boards are plain JSON-serializable objects and are never mutated;
// applyMove returns a new board (or null when the move is illegal).
//
// Board {
//   cols: 13,                  // the playfield; moves only ever touch these cells
//   cells: Cell[rows][cols],   // Cell = { tile: TileId, chain: string|null, sideways?: true }
//   winTiles: TileId[rows],    // each row's winning tile, fixed to the right of the playfield
//   roundWind: TileId,
//   seatWinds: TileId[rows],   // seat wind belongs to the row position, not to the tiles
// }
// A chain is an open set: 3 horizontally adjacent cells in one row sharing a chain id.

import { parseTiles, normalize, sortTiles, suit, num, isHonor } from './tiles.js';

export const COLS = 13;
export const CHAIN_LEN = 3;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Parse a row like "406s 345p 99p 56m [222z] 4m". Bracketed groups become chains.
 * Chain ids are `${idPrefix}${n}`. Returns all 14 cells (the last one is the winning tile).
 */
export function rowFromNotation(str, idPrefix = 'c') {
  const cells = [];
  let n = 0;
  for (const tok of str.match(/\[[^\]]*\]|[^\s[]+/g) ?? []) {
    if (tok.startsWith('[')) {
      const tiles = parseTiles(tok.slice(1, -1));
      if (tiles.length !== CHAIN_LEN) throw new Error(`Chain must have ${CHAIN_LEN} tiles: ${tok}`);
      const id = `${idPrefix}${n++}`;
      for (const tile of tiles) cells.push({ tile, chain: id });
    } else {
      for (const tile of parseTiles(tok)) cells.push({ tile, chain: null });
    }
  }
  return cells;
}

/** Rows are 14-tile notation strings; the last tile of each is that row's fixed winning tile. */
export function createBoard({ rows, roundWind = '1z', seatWinds }) {
  const full = rows.map((row, r) => rowFromNotation(row, `r${r}c`));
  for (const row of full) {
    if (row.length !== COLS + 1) throw new Error(`Row must have ${COLS + 1} tiles, got ${row.length}`);
    if (row[COLS].chain) throw new Error('The winning tile (last) cannot be part of a chain');
  }
  return {
    cols: COLS,
    cells: full.map((row) => row.slice(0, COLS)),
    winTiles: full.map((row) => row[COLS].tile),
    roundWind,
    seatWinds: seatWinds ?? full.map((_, r) => ['1z', '2z', '3z', '4z'][r % 4]),
  };
}

export const rowCount = (board) => board.cells.length;

export function boardsEqual(a, b) {
  if (a.cells.length !== b.cells.length) return false;
  return a.winTiles.every((t, r) => t === b.winTiles[r]) && a.cells.every((row, r) =>
    row.every((cell, c) => cell.tile === b.cells[r][c].tile && cell.chain === b.cells[r][c].chain));
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

/** Start column of the chain covering (r, c), or null if that cell is loose. */
export function chainStartAt(board, r, c) {
  const row = board.cells[r];
  const id = row[c].chain;
  if (!id) return null;
  let s = c;
  while (s > 0 && row[s - 1].chain === id) s--;
  return s;
}

/** 'pon' | 'chi' | 'invalid' for three tiles. */
export function meldType(tiles) {
  const t = sortTiles(tiles.map(normalize));
  if (t[0] === t[1] && t[1] === t[2]) return 'pon';
  if (!isHonor(t[0]) && suit(t[0]) === suit(t[1]) && suit(t[1]) === suit(t[2])
      && num(t[1]) === num(t[0]) + 1 && num(t[2]) === num(t[1]) + 1) return 'chi';
  return 'invalid';
}

/** Split a row into closed tiles (winning tile included) and open melds (chains). */
export function rowHand(board, r) {
  const closed = [board.winTiles[r]];
  const byChain = new Map();
  for (const { tile, chain } of board.cells[r]) {
    if (!chain) closed.push(tile);
    else {
      if (!byChain.has(chain)) byChain.set(chain, []);
      byChain.get(chain).push(tile);
    }
  }
  const melds = [...byChain].map(([chain, tiles]) => ({ chain, tiles, type: meldType(tiles) }));
  return { closed, melds };
}

// ---------------------------------------------------------------------------
// Moves
//   { type: 'row', row, dir: 'left' | 'right' }
//   { type: 'col', col, dir: 'up' | 'down' }
// ---------------------------------------------------------------------------

/** A row as a list of units: loose tiles are 1-cell units, chains are 3-cell units. */
function rowUnits(row) {
  const units = [];
  for (let c = 0; c < row.length;) {
    const id = row[c].chain;
    let e = c + 1;
    if (id) while (e < row.length && row[e].chain === id) e++;
    units.push(row.slice(c, e));
    c = e;
  }
  return units;
}

function shiftRow(row, dir) {
  const units = rowUnits(row);
  if (dir === 'left') units.push(units.shift());
  else units.unshift(units.pop());
  return units.flat();
}

/**
 * Columns that move together when column `col` is shifted, or null if the move is blocked.
 * A column no chain touches moves alone. A column under a chain moves with the chain's
 * columns, and every chain touching those columns (in any row) must span exactly the same ones.
 */
export function columnMoveSet(board, col) {
  let start = null;
  for (let r = 0; r < board.cells.length; r++) {
    const s = chainStartAt(board, r, col);
    if (s === null) continue;
    if (start === null) start = s;
    else if (s !== start) return null;
  }
  if (start === null) return [col];
  const set = [start, start + 1, start + 2];
  for (let r = 0; r < board.cells.length; r++) {
    for (const c of set) {
      const s = chainStartAt(board, r, c);
      if (s !== null && s !== start) return null;
    }
  }
  return set;
}

function isMoveInRange(board, move) {
  if (move.type === 'row') {
    return Number.isInteger(move.row) && move.row >= 0 && move.row < board.cells.length
      && (move.dir === 'left' || move.dir === 'right');
  }
  if (move.type === 'col') {
    return Number.isInteger(move.col) && move.col >= 0 && move.col < board.cols
      && (move.dir === 'up' || move.dir === 'down');
  }
  return false;
}

/** New board after `move`, or null if the move is illegal. */
export function applyMove(board, move) {
  if (!move || !isMoveInRange(board, move)) return null;
  const cells = board.cells.map((row) => row.slice());

  if (move.type === 'row') {
    cells[move.row] = shiftRow(board.cells[move.row], move.dir);
  } else {
    const cols = columnMoveSet(board, move.col);
    if (!cols) return null;
    const R = cells.length;
    const from = move.dir === 'up' ? (r) => (r + 1) % R : (r) => (r - 1 + R) % R;
    for (let r = 0; r < R; r++) {
      for (const c of cols) cells[r][c] = board.cells[from(r)][c];
    }
  }
  return { ...board, cells };
}

export const canMove = (board, move) => applyMove(board, move) !== null;

const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };
export const inverseMove = (move) => ({ ...move, dir: OPPOSITE[move.dir] });

export const moveKey = (m) => (m.type === 'row' ? `r${m.row}${m.dir[0]}` : `c${m.col}${m.dir[0]}`);

/** Every move for this board size, legal or not. */
export function allMoves(board) {
  const moves = [];
  for (let row = 0; row < board.cells.length; row++) {
    moves.push({ type: 'row', row, dir: 'left' }, { type: 'row', row, dir: 'right' });
  }
  for (let col = 0; col < board.cols; col++) {
    moves.push({ type: 'col', col, dir: 'up' }, { type: 'col', col, dir: 'down' });
  }
  return moves;
}

export const legalMoves = (board) => allMoves(board).filter((m) => canMove(board, m));
