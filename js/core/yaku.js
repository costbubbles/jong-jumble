// Yaku detection and per-row evaluation.
// Rules (see CLAUDE.md §4): closed rows are treated as riichi + menzen tsumo, so any complete
// closed row has a yaku. Rows with open melds (chains) need a real open-legal yaku. Win is tsumo.
// A row only wins when its tiles are in a valid left-to-right order (evaluateOrdered).

import { counts34, toIndex34, normalize, sortTiles, isRed, TILE_NAMES } from './tiles.js';
import { decompose, isChiitoi, isKokushi, shanten } from './hand.js';
import { rowHand, meldType } from './board.js';
import { hanOf, fuOf, tsumoPoints, YAKUMAN } from './points.js';

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

// ---------------------------------------------------------------------------
// Multiset evaluation (tile order ignored), used for hints
// ---------------------------------------------------------------------------

/**
 * { closed: TileId[], melds: [{ tiles, type }], seatWind, roundWind }
 * -> { shanten, complete, hasYaku, yaku }
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

  const complete = candidates.length > 0;
  let yaku = candidates.reduce((best, y) => (y.length > best.length ? y : best), []);
  if (complete && isClosed) yaku = ['Riichi', 'Menzen Tsumo', ...yaku];
  return { shanten: complete ? -1 : shanten(counts, melds.length), complete, hasYaku: yaku.length > 0, yaku };
}

// ---------------------------------------------------------------------------
// Ordered evaluation (the actual win condition, CLAUDE.md §4.4)
// ---------------------------------------------------------------------------

/** Loose tiles split into runs by chains: [[{ idx, col }]]. */
function looseRuns(cells) {
  const runs = [];
  let run = [];
  cells.forEach((cell, col) => {
    if (cell.chain) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ idx: toIndex34(cell.tile), col });
    }
  });
  if (run.length) runs.push(run);
  return runs;
}

/**
 * All left-to-right parses of the runs into groups with exactly one incomplete group (the wait)
 * completed by the drawn tile `w`. Groups: { type, start, col, len, wait? }.
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
    const [a, b, c] = [run[pos]?.idx, run[pos + 1]?.idx, run[pos + 2]?.idx];
    const col = run[pos].col;
    const take = (type, start, len, wait) => {
      acc.push(wait ? { type, start, col, len, wait } : { type, start, col, len });
      step(ri, pos + len, waitUsed || !!wait);
      acc.pop();
    };

    if (c !== undefined && a === b && b === c) take('pon', a, 3);
    if (c !== undefined && sameSuit(a, b, c) && b === a + 1 && c === a + 2) take('chi', a, 3);
    if (b !== undefined && a === b) take('pair', a, 2);
    if (waitUsed) return;
    if (a === w) take('pair', a, 1, 'tanki');
    if (b !== undefined && a === b && a === w) take('pon', a, 2, 'shanpon');
    if (b !== undefined && sameSuit(a, b, w)) {
      if (b === a + 1 && w === a - 1) take('chi', w, 2, a % 9 === 7 ? 'penchan' : 'ryanmen');
      if (b === a + 1 && w === b + 1) take('chi', a, 2, a % 9 === 0 ? 'penchan' : 'ryanmen');
      if (b === a + 2 && w === a + 1) take('chi', a, 2, 'kanchan');
    }
  };
  step(0, 0, false);
  return out;
}

/**
 * Best-scoring valid groups in a row that isn't won yet (for the colored boxes): per run, the
 * non-overlapping contiguous sets/pairs covering the most tiles (sets preferred on ties).
 */
export function findGroups(cells) {
  const groups = [];
  for (const run of looseRuns(cells)) {
    const n = run.length;
    const best = new Array(n + 1).fill(0);
    const choice = new Array(n + 1).fill(null);
    for (let i = n - 1; i >= 0; i--) {
      const [a, b, c] = [run[i]?.idx, run[i + 1]?.idx, run[i + 2]?.idx];
      best[i] = best[i + 1];
      const consider = (type, len, weight) => {
        if (weight + best[i + len] > best[i]) { best[i] = weight + best[i + len]; choice[i] = { type, len }; }
      };
      if (b !== undefined && a === b) consider('pair', 2, 2);
      if (c !== undefined && a === b && b === c) consider('pon', 3, 3.01);
      if (c !== undefined && a < 27 && Math.floor(a / 9) === Math.floor(c / 9) && b === a + 1 && c === a + 2) {
        consider('chi', 3, 3.01);
      }
    }
    for (let i = 0; i < n;) {
      if (choice[i]) {
        groups.push({ type: choice[i].type, col: run[i].col, len: choice[i].len });
        i += choice[i].len;
      } else i++;
    }
  }
  return groups;
}

/**
 * Playfield columns holding tiles that the winning tile `w` would complete into a group:
 * a single copy of w (→ pair), an adjacent pair of w (→ triplet), or two adjacent ascending tiles
 * that w turns into a sequence (ryanmen / penchan / kanchan).
 */
export function findWaitCols(cells, winTile) {
  const w = toIndex34(winTile);
  const cols = new Set();
  for (const run of looseRuns(cells)) {
    run.forEach(({ idx, col }, i) => {
      if (idx === w) cols.add(col);
      const next = run[i + 1];
      if (!next || w >= 27 || idx >= 27) return;
      const [a, b] = [idx, next.idx];
      const sameSuit = Math.floor(a / 9) === Math.floor(b / 9) && Math.floor(a / 9) === Math.floor(w / 9);
      if (sameSuit && ((b === a + 1 && (w === a - 1 || w === b + 1)) || (b === a + 2 && w === a + 1))) {
        cols.add(col);
        cols.add(next.col);
      }
    });
  }
  return [...cols].sort((x, y) => x - y);
}

const NO_WIN = { complete: false, hasYaku: false, yaku: [], yakuHan: [], han: 0, fu: 0, points: 0, limit: '', groups: [] };

/**
 * Ordered win check for one row: the playfield `cells`, read left to right (chains split runs),
 * must form ordered groups with exactly one wait, which the fixed `winTile` completes.
 * Returns the best-scoring win: { complete, hasYaku, yaku, yakuHan, han, fu, points, limit, groups }.
 */
export function evaluateOrdered(cells, winTile, { seatWind = '1z', roundWind = '1z' } = {}) {
  const meldTiles = new Map();
  for (const cell of cells) {
    if (!cell.chain) continue;
    if (!meldTiles.has(cell.chain)) meldTiles.set(cell.chain, []);
    meldTiles.get(cell.chain).push(cell.tile);
  }
  const melds = [...meldTiles.values()].map((tiles) => ({ tiles, type: meldType(tiles) }));
  if (melds.some((m) => m.type === 'invalid')) return NO_WIN;

  const isClosed = melds.length === 0;
  const openGroups = openGroupsOf(melds);
  const seat = toIndex34(seatWind);
  const round = toIndex34(roundWind);
  const allTiles = [...cells.map((x) => x.tile), winTile];
  const allCounts = counts34(allTiles);
  const akaDora = allTiles.filter(isRed).length;
  const dealer = seatWind === '1z';

  // Each candidate: { names, groups, fu }
  const candidates = [];
  for (const groups of parseRuns(looseRuns(cells), toIndex34(winTile))) {
    const pairs = groups.filter((g) => g.type === 'pair');
    if (pairs.length === 1 && groups.length - 1 + melds.length === 4) {
      const all = [...groups.map((g) => ({ ...g, open: false })), ...openGroups];
      const names = standardYaku(all, { closed: isClosed, seatWind, roundWind });
      const pair = pairs[0].start;
      const pinfu = isClosed && all.every((g) => g.type !== 'pon')
        && pair < 31 && pair !== seat && pair !== round
        && groups.some((g) => g.wait === 'ryanmen');
      if (pinfu && !names.some((n) => YAKUMAN.has(n))) names.unshift('Pinfu');
      candidates.push({ names, groups, fu: fuOf(all, { seat, round, pinfu }) });
    } else if (isClosed && pairs.length === 7 && new Set(pairs.map((g) => g.start)).size === 7) {
      candidates.push({ names: chiitoiYaku(allCounts), groups, fu: 25 });
    }
  }
  if (isClosed && isKokushi(allCounts)) candidates.push({ names: ['Kokushi Musou'], groups: [], fu: 0 });
  if (!candidates.length) return NO_WIN;

  let best = null;
  for (const cand of candidates) {
    const yakumanNames = cand.names.filter((n) => YAKUMAN.has(n));
    let yakuHan;
    if (yakumanNames.length) {
      yakuHan = yakumanNames.map((name) => ({ name, han: 13 }));
    } else {
      const names = isClosed ? ['Riichi', 'Menzen Tsumo', ...cand.names] : cand.names;
      yakuHan = names.map((name) => ({ name, han: hanOf(name, !isClosed) }));
    }
    const hasYaku = yakuHan.length > 0;
    if (hasYaku && akaDora && !yakumanNames.length) yakuHan.push({ name: 'Aka Dora', han: akaDora });
    const han = yakuHan.reduce((s, y) => s + y.han, 0);
    const { points, limit } = hasYaku
      ? tsumoPoints({ han, fu: cand.fu, yakumanCount: yakumanNames.length, dealer })
      : { points: 0, limit: '' };
    const result = {
      complete: true,
      hasYaku,
      yaku: yakuHan.filter((y) => y.name !== 'Aka Dora').map((y) => y.name),
      yakuHan,
      han,
      fu: cand.fu,
      points,
      limit,
      groups: cand.groups,
    };
    if (!best || result.points > best.points || (result.points === best.points && result.han > best.han)) {
      best = result;
    }
  }
  return best;
}

/**
 * Full row evaluation.
 * status: 'solved'  ordered win with a yaku
 *         'noyaku'  the tiles form a winning shape but no yaku is possible
 *         'reorder' the tiles could win with a yaku, but are not in a valid order
 *         'shanten' not a winning set of tiles yet (see `shanten`)
 * groups: valid tile groups to box ({ type, col, len, wait? }). For a won row these are the
 *         winning groups; otherwise the best contiguous sets/pairs found.
 */
export function evaluateRow(board, r) {
  const ctx = { seatWind: board.seatWinds[r], roundWind: board.roundWind };
  const { closed, melds } = rowHand(board, r);
  const loose = evaluateHand({ closed, melds, ...ctx });
  const ordered = evaluateOrdered(board.cells[r], board.winTiles[r], ctx);

  let status = 'shanten';
  if (ordered.complete && ordered.hasYaku) status = 'solved';
  else if (ordered.complete || (loose.complete && !loose.hasYaku)) status = 'noyaku';
  else if (loose.complete) status = 'reorder';
  const solved = status === 'solved';

  return {
    status,
    solved,
    shanten: loose.shanten,
    yaku: solved ? ordered.yaku : [],
    yakuHan: solved ? ordered.yakuHan : [],
    han: solved ? ordered.han : 0,
    fu: solved ? ordered.fu : 0,
    points: solved ? ordered.points : 0,
    limit: solved ? ordered.limit : '',
    groups: ordered.complete ? ordered.groups : findGroups(board.cells[r]),
    // Tiles the winning tile would complete: just the wait group once the row wins.
    waitCols: ordered.complete
      ? ordered.groups.filter((g) => g.wait).flatMap((g) => Array.from({ length: g.len }, (_, i) => g.col + i))
      : findWaitCols(board.cells[r], board.winTiles[r]),
  };
}

export const evaluateBoard = (board) => board.cells.map((_, r) => evaluateRow(board, r));

export const isBoardSolved = (board) => evaluateBoard(board).every((e) => e.solved);
