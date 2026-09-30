// Hand shape: decomposition into sets + pair, chiitoitsu, kokushi, and shanten.
// Works on 34-length count arrays (see counts34 in tiles.js), so red fives are already folded in.

export const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

const isSuited = (i) => i < 27;
const canStartChi = (i) => isSuited(i) && i % 9 <= 6;
const sum = (counts) => counts.reduce((a, b) => a + b, 0);

/**
 * All ways to split `counts` into `setsNeeded` sets + 1 pair.
 * Returns [{ pair: index, sets: [{ type: 'pon' | 'chi', start: index }] }].
 */
export function decompose(counts, setsNeeded) {
  if (sum(counts) !== setsNeeded * 3 + 2) return [];
  const c = counts.slice();
  const out = [];
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const found = [];
    extractSets(c, setsNeeded, 0, [], found);
    for (const sets of found) out.push({ pair: p, sets });
    c[p] += 2;
  }
  return out;
}

function extractSets(c, need, from, acc, out) {
  let i = from;
  while (i < 34 && c[i] === 0) i++;
  if (i === 34) {
    if (acc.length === need) out.push(acc.slice());
    return;
  }
  if (acc.length >= need) return;
  if (c[i] >= 3) {
    c[i] -= 3;
    acc.push({ type: 'pon', start: i });
    extractSets(c, need, i, acc, out);
    acc.pop();
    c[i] += 3;
  }
  if (canStartChi(i) && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    acc.push({ type: 'chi', start: i });
    extractSets(c, need, i, acc, out);
    acc.pop();
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
}

export const isChiitoi = (counts) =>
  sum(counts) === 14 && counts.filter((n) => n === 2).length === 7;

export const isKokushi = (counts) =>
  sum(counts) === 14 && ORPHANS.every((i) => counts[i] >= 1)
  && ORPHANS.reduce((s, i) => s + counts[i], 0) === 14;

// ---------------------------------------------------------------------------
// Shanten. -1 = complete hand, 0 = tenpai, n = n tiles away from tenpai.
// ---------------------------------------------------------------------------

/** Regular (4 sets + pair) shanten; `openMelds` sets are already complete. */
export function regularShanten(counts, openMelds = 0) {
  const c = counts.slice();
  let best = 8;

  const search = (i, sets, partials, pair) => {
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) {
      const m = sets + openMelds;
      const t = Math.min(partials, 4 - m);
      best = Math.min(best, 8 - 2 * m - t - pair);
      return;
    }
    if (c[i] >= 3) {
      c[i] -= 3; search(i, sets + 1, partials, pair); c[i] += 3;
    }
    if (canStartChi(i) && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      search(i, sets + 1, partials, pair);
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!pair) search(i, sets, partials, 1);
      search(i, sets, partials + 1, pair);
      c[i] += 2;
    }
    if (isSuited(i) && i % 9 <= 7 && c[i + 1]) {
      c[i]--; c[i + 1]--; search(i, sets, partials + 1, pair); c[i]++; c[i + 1]++;
    }
    if (canStartChi(i) && c[i + 2]) {
      c[i]--; c[i + 2]--; search(i, sets, partials + 1, pair); c[i]++; c[i + 2]++;
    }
    c[i]--; search(i, sets, partials, pair); c[i]++;
  };

  search(0, 0, 0, 0);
  return best;
}

export function chiitoiShanten(counts) {
  const pairs = counts.filter((n) => n >= 2).length;
  const kinds = counts.filter((n) => n >= 1).length;
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function kokushiShanten(counts) {
  const kinds = ORPHANS.filter((i) => counts[i] >= 1).length;
  const hasPair = ORPHANS.some((i) => counts[i] >= 2);
  return 13 - kinds - (hasPair ? 1 : 0);
}

/** Best shanten over all hand shapes. Chiitoi/kokushi only apply to fully closed hands. */
export function shanten(counts, openMelds = 0) {
  let s = regularShanten(counts, openMelds);
  if (openMelds === 0) s = Math.min(s, chiitoiShanten(counts), kokushiShanten(counts));
  return s;
}
