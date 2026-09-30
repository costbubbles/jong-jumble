// Yaku detection and per-row evaluation.
// Rules (see CLAUDE.md §4): closed rows are treated as riichi + menzen tsumo, so any complete
// closed row has a yaku. Rows with open melds (chains) need a real open-legal yaku. Win is tsumo.
// A row only wins when its tiles are in a valid left-to-right order (evaluateOrdered).
// Pinfu is not detected.

import { counts34, toIndex34, normalize, sortTiles, TILE_NAMES } from './tiles.js';
import { decompose, isChiitoi, isKokushi, shanten } from './hand.js';
import { rowHand, meldType } from './board.js';

const HAKU = 31, HATSU = 32, CHUN = 33;
const GREEN = new Set([19, 20, 21, 23, 25, HATSU]); // 2s 3s 4s 6s 8s hatsu

const isHonorIdx = (i) => i >= 27;
const isWindIdx = (i) => i >= 27 && i <= 30;
const isDragonIdx = (i) => i >= 31;
const isTermIdx = (i) => i < 27 && (i % 9 === 0 || i % 9 === 8);
const isTermOrHonorIdx = (i) => isHonorIdx(i) || isTermIdx(i);
const isSimpleIdx = (i) => !isTermOrHonorIdx(i);

function groupTiles(g) {
  if (g.type === 'pair') return [g.start, g.start];
  if (g.type === 'pon') return [g.start, g.start, g.start];
  return [g.start, g.start + 1, g.start + 2];
}

/** Flush / half-flush / honor-only yaku shared by standard and chiitoi hands. */
function colorYaku(allIdx) {
  const suits = new Set(allIdx.filter((i) => i < 27).map((i) => Math.floor(i / 9)));
  const hasHonor = allIdx.some(isHonorIdx);
  if (suits.size === 1 && !hasHonor) return ['Chinitsu'];
  if (suits.size === 1 && hasHonor) return ['Honitsu'];
  return [];
}

function standardYaku(groups, { closed, seatWind, roundWind }) {
  const sets = groups.filter((g) => g.type !== 'pair');
  const pair = groups.find((g) => g.type === 'pair');
  const pons = sets.filter((g) => g.type === 'pon');
  const chis = sets.filter((g) => g.type === 'chi');
  const allIdx = groups.flatMap(groupTiles);
  const dragonPons = pons.filter((g) => isDragonIdx(g.start)).length;
  const windPons = pons.filter((g) => isWindIdx(g.start)).length;
  const concealedPons = pons.filter((g) => !g.open).length;

  // Yakuman
  const yakuman = [];
  if (dragonPons === 3) yakuman.push('Daisangen');
  if (windPons === 4) yakuman.push('Daisuushii');
  else if (windPons === 3 && isWindIdx(pair.start)) yakuman.push('Shousuushii');
  if (allIdx.every(isHonorIdx)) yakuman.push('Tsuuiisou');
  if (allIdx.every(isTermIdx)) yakuman.push('Chinroutou');
  if (allIdx.every((i) => GREEN.has(i))) yakuman.push('Ryuuiisou');
  if (concealedPons === 4) yakuman.push('Suuankou');
  if (yakuman.length) return yakuman;

  const y = [];
  const seat = toIndex34(seatWind);
  const round = toIndex34(roundWind);
  for (const g of pons) {
    if (g.start === HAKU) y.push('Yakuhai: Haku');
    if (g.start === HATSU) y.push('Yakuhai: Hatsu');
    if (g.start === CHUN) y.push('Yakuhai: Chun');
    if (g.start === seat) y.push(`Yakuhai: Seat Wind (${TILE_NAMES[seatWind]})`);
    if (g.start === round) y.push(`Yakuhai: Round Wind (${TILE_NAMES[roundWind]})`);
  }
  if (allIdx.every(isSimpleIdx)) y.push('Tanyao');
  if (pons.length === 4) y.push('Toitoi');
  if (concealedPons === 3) y.push('Sanankou');
  y.push(...colorYaku(allIdx));

  const chiStarts = chis.map((g) => g.start);
  const hasChi = (i) => chiStarts.includes(i);
  if ([0, 1, 2, 3, 4, 5, 6].some((n) => hasChi(n) && hasChi(n + 9) && hasChi(n + 18))) y.push('Sanshoku Doujun');
  if ([0, 9, 18].some((s) => hasChi(s) && hasChi(s + 3) && hasChi(s + 6))) y.push('Ittsu');

  const ponStarts = pons.map((g) => g.start);
  if ([...Array(9).keys()].some((n) => [n, n + 9, n + 18].every((i) => ponStarts.includes(i)))) {
    y.push('Sanshoku Doukou');
  }

  if (allIdx.every(isTermOrHonorIdx)) y.push('Honroutou');
  else if (chis.length > 0 && groups.every((g) => groupTiles(g).some(isTermOrHonorIdx))) {
    y.push(allIdx.some(isHonorIdx) ? 'Chanta' : 'Junchan');
  }
  if (dragonPons === 2 && isDragonIdx(pair.start)) y.push('Shousangen');

  if (closed) {
    const counts = {};
    for (const s of chiStarts) counts[s] = (counts[s] ?? 0) + 1;
    const peikou = Object.values(counts).reduce((a, n) => a + Math.floor(n / 2), 0);
    if (peikou === 2) y.push('Ryanpeikou');
    else if (peikou === 1) y.push('Iipeikou');
  }
  return y;
}

function chiitoiYaku(counts) {
  const idx = counts.flatMap((n, i) => (n ? [i, i] : []));
  if (idx.every(isHonorIdx)) return ['Tsuuiisou'];
  const y = ['Chiitoitsu'];
  if (idx.every(isSimpleIdx)) y.push('Tanyao');
  if (idx.every(isTermOrHonorIdx)) y.push('Honroutou');
  y.push(...colorYaku(idx));
  return y;
}

const openGroupsOf = (melds) => melds.map((m) => ({
  type: m.type,
  start: toIndex34(sortTiles(m.tiles.map(normalize))[0]),
  open: true,
}));

/** Best yaku list among the candidate decompositions (closed hands get riichi + tsumo). */
function summarize(candidates, isClosed) {
  const complete = candidates.length > 0;
  let yaku = candidates.reduce((best, y) => (y.length > best.length ? y : best), []);
  if (complete && isClosed) yaku = ['Riichi', 'Menzen Tsumo', ...yaku];
  return { complete, hasYaku: yaku.length > 0, yaku };
}

/**
 * Evaluate a hand as a multiset (tile order ignored):
 * { closed: TileId[], melds: [{ tiles, type }], seatWind, roundWind }.
 * Returns { shanten, complete, hasYaku, yaku }.
 */
export function evaluateHand({ closed, melds = [], seatWind = '1z', roundWind = '1z' }) {
  if (melds.some((m) => m.type !== 'pon' && m.type !== 'chi')) {
    return { shanten: 8, complete: false, hasYaku: false, yaku: [] };
  }
  const counts = counts34(closed);
  const isClosed = melds.length === 0;
  const openGroups = openGroupsOf(melds);

  const candidates = [];
  for (const d of decompose(counts, 4 - melds.length)) {
    const groups = [
      { type: 'pair', start: d.pair },
      ...d.sets.map((s) => ({ ...s, open: false })),
      ...openGroups,
    ];
    candidates.push(standardYaku(groups, { closed: isClosed, seatWind, roundWind }));
  }
  if (isClosed && isChiitoi(counts)) candidates.push(chiitoiYaku(counts));
  if (isClosed && isKokushi(counts)) candidates.push(['Kokushi Musou']);

  const result = summarize(candidates, isClosed);
  return { shanten: result.complete ? -1 : shanten(counts, melds.length), ...result };
}

// ---------------------------------------------------------------------------
// Ordered evaluation (the actual win condition, CLAUDE.md §4.4)
// ---------------------------------------------------------------------------

/**
 * All left-to-right parses of the loose runs into groups, with exactly one incomplete group
 * (the wait) completed by the drawn tile `w`. Returns arrays of { type, start }.
 */
function parseRuns(runs, w) {
  const out = [];
  const acc = [];
  const sameSuit = (...xs) => xs.every((x) => x < 27 && Math.floor(x / 9) === Math.floor(xs[0] / 9));

  const step = (ri, pos, waitUsed) => {
    if (ri === runs.length) {
      if (waitUsed) out.push(acc.slice());
      return;
    }
    const run = runs[ri];
    if (pos === run.length) return step(ri + 1, 0, waitUsed);
    const [a, b, c] = [run[pos], run[pos + 1], run[pos + 2]];
    const take = (group, len, usesWait) => {
      acc.push(group);
      step(ri, pos + len, waitUsed || usesWait);
      acc.pop();
    };

    if (c !== undefined && a === b && b === c) take({ type: 'pon', start: a }, 3, false);
    if (c !== undefined && sameSuit(a, b, c) && b === a + 1 && c === a + 2) take({ type: 'chi', start: a }, 3, false);
    if (b !== undefined && a === b) take({ type: 'pair', start: a }, 2, false);
    if (waitUsed) return;
    // Wait groups, completed by the drawn tile w.
    if (a === w) take({ type: 'pair', start: a }, 1, true);                       // tanki
    if (b !== undefined && a === b && a === w) take({ type: 'pon', start: a }, 2, true); // shanpon
    if (b !== undefined && sameSuit(a, b, w)) {
      if (b === a + 1 && w === a - 1) take({ type: 'chi', start: w }, 2, true);   // ryanmen/penchan, low side
      if (b === a + 1 && w === b + 1) take({ type: 'chi', start: a }, 2, true);   // ryanmen/penchan, high side
      if (b === a + 2 && w === a + 1) take({ type: 'chi', start: a }, 2, true);   // kanchan
    }
  };
  step(0, 0, false);
  return out;
}

/**
 * Ordered win check for one row. The last loose tile is the drawn tile; the rest of the loose
 * tiles, read left to right (chains split runs), must form ordered groups with one wait.
 * Returns { complete, hasYaku, yaku, drawnCol }.
 */
export function evaluateOrdered(cells, { seatWind = '1z', roundWind = '1z' } = {}) {
  let drawnCol = -1;
  cells.forEach((cell, c) => { if (!cell.chain) drawnCol = c; });
  const none = { complete: false, hasYaku: false, yaku: [], drawnCol };
  if (drawnCol < 0) return none;

  const runs = [];
  let run = [];
  const meldTiles = new Map();
  cells.forEach((cell, c) => {
    if (cell.chain) {
      if (run.length) runs.push(run);
      run = [];
      if (!meldTiles.has(cell.chain)) meldTiles.set(cell.chain, []);
      meldTiles.get(cell.chain).push(cell.tile);
    } else if (c !== drawnCol) {
      run.push(toIndex34(cell.tile));
    }
  });
  if (run.length) runs.push(run);

  const melds = [...meldTiles.values()].map((tiles) => ({ tiles, type: meldType(tiles) }));
  if (melds.some((m) => m.type === 'invalid')) return none;
  const isClosed = melds.length === 0;
  const openGroups = openGroupsOf(melds);
  const ctx = { closed: isClosed, seatWind, roundWind };

  const candidates = [];
  for (const groups of parseRuns(runs, toIndex34(cells[drawnCol].tile))) {
    const pairs = groups.filter((g) => g.type === 'pair');
    if (pairs.length === 1 && groups.length - 1 + melds.length === 4) {
      candidates.push(standardYaku([...groups.map((g) => ({ ...g, open: false })), ...openGroups], ctx));
    } else if (isClosed && pairs.length === 7 && new Set(pairs.map((g) => g.start)).size === 7) {
      candidates.push(chiitoiYaku(counts34(cells.map((x) => x.tile))));
    }
  }
  if (isClosed && isKokushi(counts34(cells.map((x) => x.tile)))) candidates.push(['Kokushi Musou']);

  return { ...summarize(candidates, isClosed), drawnCol };
}

/**
 * Full row evaluation.
 * status: 'solved'  ordered win with a yaku
 *         'noyaku'  the tiles form a winning shape but no yaku is possible
 *         'reorder' the tiles could win with a yaku, but are not in a valid order
 *         'shanten' not a winning set of tiles yet (see `shanten`)
 */
export function evaluateRow(board, r) {
  const ctx = { seatWind: board.seatWinds[r], roundWind: board.roundWind };
  const { closed, melds } = rowHand(board, r);
  const loose = evaluateHand({ closed, melds, ...ctx });
  const ordered = evaluateOrdered(board.cells[r], ctx);

  let status = 'shanten';
  if (ordered.complete && ordered.hasYaku) status = 'solved';
  else if (ordered.complete || (loose.complete && !loose.hasYaku)) status = 'noyaku';
  else if (loose.complete) status = 'reorder';

  return {
    status,
    solved: status === 'solved',
    shanten: loose.shanten,
    yaku: status === 'solved' ? ordered.yaku : [],
    drawnCol: ordered.drawnCol,
  };
}

export const evaluateBoard = (board) => board.cells.map((_, r) => evaluateRow(board, r));

export const isBoardSolved = (board) => evaluateBoard(board).every((e) => e.solved);
