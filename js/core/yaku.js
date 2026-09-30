// Yaku detection and per-row evaluation.
// Rules (see CLAUDE.md §4): closed rows are treated as riichi + menzen tsumo, so any complete
// closed row has a yaku. Rows with open melds (chains) need a real open-legal yaku. Win is tsumo.
// Pinfu is not detected (the winning tile / wait is cosmetic in this game).

import { counts34, toIndex34, normalize, sortTiles, TILE_NAMES } from './tiles.js';
import { decompose, isChiitoi, isKokushi, shanten } from './hand.js';
import { rowHand } from './board.js';

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

/**
 * Evaluate a hand: { closed: TileId[], melds: [{ tiles, type }], seatWind, roundWind }.
 * Returns { shanten, complete, hasYaku, solved, yaku }.
 */
export function evaluateHand({ closed, melds = [], seatWind = '1z', roundWind = '1z' }) {
  if (melds.some((m) => m.type !== 'pon' && m.type !== 'chi')) {
    return { shanten: 8, complete: false, hasYaku: false, solved: false, yaku: [] };
  }
  const counts = counts34(closed);
  const isClosed = melds.length === 0;
  const sh = shanten(counts, melds.length);

  const openGroups = melds.map((m) => ({
    type: m.type,
    start: toIndex34(sortTiles(m.tiles.map(normalize))[0]),
    open: true,
  }));

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
  const hasYaku = yaku.length > 0;
  return { shanten: complete ? -1 : sh, complete, hasYaku, solved: complete && hasYaku, yaku };
}

export function evaluateRow(board, r) {
  const { closed, melds } = rowHand(board, r);
  return evaluateHand({ closed, melds, seatWind: board.seatWinds[r], roundWind: board.roundWind });
}

export const evaluateBoard = (board) => board.cells.map((_, r) => evaluateRow(board, r));

export const isBoardSolved = (board) => evaluateBoard(board).every((e) => e.solved);
