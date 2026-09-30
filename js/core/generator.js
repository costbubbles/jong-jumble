// Puzzle generation: build a solved board from a seed, then scramble it with random legal moves.
// Every legal move has a legal inverse, so the scrambled board is always solvable.

import { DIFFICULTIES, GENERATION } from '../config.js';
import { createRng } from './rng.js';
import { fromIndex34, toIndex34, sortTiles, sortKey } from './tiles.js';
import { applyMove, inverseMove, legalMoves, moveKey } from './board.js';
import { evaluateBoard, evaluateOrdered } from './yaku.js';

const ALL = [...Array(34).keys()];

function themePool(theme, rng) {
  if (theme === 'tanyao') return ALL.filter((i) => i < 27 && i % 9 >= 1 && i % 9 <= 7);
  if (theme === 'honitsu') {
    const s = rng.int(3);
    return ALL.filter((i) => (i >= s * 9 && i < s * 9 + 9) || i >= 27);
  }
  return ALL;
}

const setTiles = (s) => (s.type === 'pon'
  ? [s.start, s.start, s.start]
  : [s.start, s.start + 1, s.start + 2]).map(fromIndex34);

/** Random 4 sets + pair; `openCount` of the sets become open melds. Null if it got stuck. */
function makeStandardHand(rng, { openCount, theme, seatWind, roundWind }) {
  const pool = themePool(theme, rng);
  const inPool = new Set(pool);
  const chiStarts = pool.filter((i) => i < 27 && i % 9 <= 6 && inPool.has(i + 1) && inPool.has(i + 2));
  const counts = new Array(34).fill(0);
  const sets = [];

  if (theme === 'yakuhai') {
    const valueTiles = [...new Set([31, 32, 33, toIndex34(seatWind), toIndex34(roundWind)])];
    const i = rng.pick(valueTiles);
    counts[i] += 3;
    sets.push({ type: 'pon', start: i });
  }

  while (sets.length < 4) {
    let placed = false;
    for (let tries = 0; tries < 30 && !placed; tries++) {
      if (chiStarts.length && !rng.chance(GENERATION.ponChance)) {
        const i = rng.pick(chiStarts);
        if (counts[i] < 4 && counts[i + 1] < 4 && counts[i + 2] < 4) {
          counts[i]++; counts[i + 1]++; counts[i + 2]++;
          sets.push({ type: 'chi', start: i });
          placed = true;
        }
      } else {
        const i = rng.pick(pool);
        if (counts[i] <= 1) {
          counts[i] += 3;
          sets.push({ type: 'pon', start: i });
          placed = true;
        }
      }
    }
    if (!placed) return null;
  }

  const pairOptions = pool.filter((i) => counts[i] <= 2);
  if (!pairOptions.length) return null;
  const pair = rng.pick(pairOptions);

  const openIdx = new Set(rng.shuffle([0, 1, 2, 3]).slice(0, openCount));
  const groups = [[fromIndex34(pair), fromIndex34(pair)]];
  const melds = [];
  sets.forEach((s, k) => (openIdx.has(k) ? melds : groups).push(setTiles(s)));
  return { groups, melds };
}

function makeChiitoiHand(rng) {
  const kinds = rng.shuffle(ALL).slice(0, 7);
  return { groups: kinds.map((i) => [fromIndex34(i), fromIndex34(i)]), melds: [] };
}

/** Per suit, maybe turn one 5 into a red five (at most one red per suit per row). */
function addRedFives(rng, hand) {
  for (const st of ['m', 'p', 's']) {
    const spots = [];
    for (const arr of [...hand.groups, ...hand.melds]) {
      arr.forEach((t, i) => { if (t === `5${st}`) spots.push([arr, i]); });
    }
    if (spots.length && rng.chance(GENERATION.redFiveChance)) {
      const [arr, i] = rng.pick(spots);
      arr[i] = `0${st}`;
    }
  }
}

/**
 * Solved row layout: closed groups in ascending order with one group missing a tile (the wait),
 * then the open melds as chains at the right end. The missing tile becomes the fixed winning tile.
 * Returns { cells (13), winTile }.
 */
function layoutRow(rng, r, hand) {
  const groups = hand.groups.map(sortTiles).sort((a, b) => sortKey(a[0]) - sortKey(b[0]));
  const wait = rng.pick(groups);
  const [winTile] = wait.splice(rng.int(wait.length), 1);
  const cells = [
    ...groups.flat().map((tile) => ({ tile, chain: null })),
    ...hand.melds.flatMap((tiles, k) => {
      const sideways = rng.int(tiles.length); // the "called" tile, drawn rotated
      return sortTiles(tiles).map((tile, i) => (i === sideways
        ? { tile, chain: `r${r}m${k}`, sideways: true }
        : { tile, chain: `r${r}m${k}` }));
    }),
  ];
  return { cells, winTile };
}

function generateRow(rng, r, { openCount, seatWind, roundWind }) {
  for (let attempt = 0; attempt < GENERATION.maxRowAttempts; attempt++) {
    const hand = openCount === 0 && rng.chance(GENERATION.chiitoiChance)
      ? makeChiitoiHand(rng)
      : makeStandardHand(rng, {
        openCount, seatWind, roundWind,
        theme: openCount === 0 ? 'free' : rng.weightedKey(GENERATION.openThemes),
      });
    if (!hand) continue;
    addRedFives(rng, hand);
    const row = layoutRow(rng, r, hand);
    if (evaluateOrdered(row.cells, row.winTile, { seatWind, roundWind }).hasYaku) return row;
  }
  throw new Error(`Could not generate row ${r} with ${openCount} open sets`);
}

export function generateSolvedBoard(rng, difficulty) {
  const diff = DIFFICULTIES[difficulty];
  const roundWind = rng.pick(GENERATION.roundWinds);
  const seatWinds = Array.from({ length: diff.rows }, (_, r) => GENERATION.seatWinds[r % GENERATION.seatWinds.length]);
  const rows = seatWinds.map((seatWind, r) =>
    generateRow(rng, r, { openCount: rng.weightedIndex(diff.openSetWeights), seatWind, roundWind }));
  return {
    cols: GENERATION.cols,
    cells: rows.map((row) => row.cells),
    winTiles: rows.map((row) => row.winTile),
    roundWind,
    seatWinds,
  };
}

export function scrambleBoard(rng, board, count, rules) {
  const moves = [];
  const step = () => {
    const last = moves[moves.length - 1];
    const undoKey = last && moveKey(inverseMove(last));
    const move = rng.pick(legalMoves(board).filter((m) => moveKey(m) !== undoKey));
    board = applyMove(board, move);
    moves.push(move);
  };
  for (let i = 0; i < count; i++) step();
  for (let extra = 0; extra < GENERATION.maxExtraScrambleMoves; extra++) {
    if (!evaluateBoard(board, rules).some((e) => e.solved)) break;
    step();
  }
  return { board, moves };
}

/**
 * Deterministic puzzle for (seed, difficulty, rules). rules = { requireOrder } (see yaku.js); the
 * scramble keeps going until no row is already solved under those rules.
 * Returns { seed, difficulty, solved, board, scramble, startShanten }.
 */
export function generatePuzzle(seed, difficulty, rules = { requireOrder: true }) {
  if (!DIFFICULTIES[difficulty]) throw new Error(`Unknown difficulty "${difficulty}"`);
  const rng = createRng(`${seed}|${difficulty}`);
  const solved = generateSolvedBoard(rng, difficulty);
  const { board, moves } = scrambleBoard(rng, solved, DIFFICULTIES[difficulty].scrambleMoves, rules);
  return {
    seed,
    difficulty,
    solved,
    board,
    scramble: moves,
    rules,
    startShanten: evaluateBoard(board, rules).map((e) => e.shanten),
  };
}
