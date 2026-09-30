// Riichi hand value: han per yaku, fu, and tsumo points.
// Every win in this game is a tsumo. Seat wind East = dealer. Red fives are the only dora.

export const YAKUMAN = new Set([
  'Daisangen', 'Daisuushii', 'Shousuushii', 'Tsuuiisou', 'Chinroutou', 'Ryuuiisou', 'Suuankou',
  'Kokushi Musou',
]);

// [closed han, open han]; null = not allowed open (those only appear in closed hands anyway).
const HAN = {
  'Riichi': [1, null],
  'Menzen Tsumo': [1, null],
  'Pinfu': [1, null],
  'Iipeikou': [1, null],
  'Ryanpeikou': [3, null],
  'Chiitoitsu': [2, null],
  'Tanyao': [1, 1],
  'Toitoi': [2, 2],
  'Sanankou': [2, 2],
  'Honitsu': [3, 2],
  'Chinitsu': [6, 5],
  'Sanshoku Doujun': [2, 1],
  'Ittsu': [2, 1],
  'Chanta': [2, 1],
  'Junchan': [3, 2],
  'Sanshoku Doukou': [2, 2],
  'Shousangen': [2, 2],
  'Honroutou': [2, 2],
};

export function hanOf(name, open) {
  if (YAKUMAN.has(name)) return 13;
  if (name.startsWith('Yakuhai')) return 1;
  const h = HAN[name];
  return h ? (open ? h[1] : h[0]) ?? 0 : 0;
}

const isTermOrHonorIdx = (i) => i >= 27 || i % 9 === 0 || i % 9 === 8;

/**
 * Fu for a standard (4 sets + pair) hand won by tsumo.
 * groups: [{ type: 'pair'|'pon'|'chi', start, open, wait? }]
 */
export function fuOf(groups, { seat, round, pinfu }) {
  if (pinfu) return 20;
  let fu = 20 + 2; // base + tsumo
  for (const g of groups) {
    if (g.type === 'pon') {
      const base = g.open ? 2 : 4;
      fu += isTermOrHonorIdx(g.start) ? base * 2 : base;
    } else if (g.type === 'pair') {
      if (g.start >= 31) fu += 2;
      if (g.start === seat) fu += 2;
      if (g.start === round) fu += 2;
    }
    if (g.wait === 'kanchan' || g.wait === 'penchan' || g.wait === 'tanki') fu += 2;
  }
  return Math.ceil(fu / 10) * 10;
}

const LIMITS = [
  [13, 8000, 'Kazoe Yakuman'],
  [11, 6000, 'Sanbaiman'],
  [8, 4000, 'Baiman'],
  [6, 3000, 'Haneman'],
  [5, 2000, 'Mangan'],
];

/** Total tsumo points. Returns { points, limit } where limit is e.g. 'Mangan' or ''. */
export function tsumoPoints({ han, fu, yakumanCount = 0, dealer }) {
  let basic;
  let limit = '';
  if (yakumanCount > 0) {
    basic = 8000 * yakumanCount;
    limit = yakumanCount > 1 ? `${yakumanCount}× Yakuman` : 'Yakuman';
  } else {
    const hit = LIMITS.find(([minHan]) => han >= minHan);
    if (hit) [, basic, limit] = hit;
    else {
      basic = fu * 2 ** (han + 2);
      if (basic >= 2000) { basic = 2000; limit = 'Mangan'; }
    }
  }
  const up = (x) => Math.ceil(x / 100) * 100;
  const points = dealer ? 3 * up(2 * basic) : up(2 * basic) + 2 * up(basic);
  return { points, limit };
}
