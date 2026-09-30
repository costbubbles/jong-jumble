// Seeded randomness. All gameplay randomness must go through createRng so that the same
// seed produces the same puzzle on every machine (required for multiplayer).

function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function sfc32(a, b, c, d) {
  return function next() {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function createRng(seed) {
  const next = sfc32(...cyrb128(String(seed)));
  for (let i = 0; i < 15; i++) next();

  const rng = {
    next,
    /** Integer in [0, n). */
    int: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
    pick: (arr) => arr[rng.int(arr.length)],
    shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    /** Index chosen with probability proportional to weights[i]. */
    weightedIndex(weights) {
      const total = weights.reduce((s, w) => s + w, 0);
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    /** Key of an object of weights, e.g. { a: 0.7, b: 0.3 }. */
    weightedKey(obj) {
      const keys = Object.keys(obj);
      return keys[rng.weightedIndex(keys.map((k) => obj[k]))];
    },
  };
  return rng;
}

const SEED_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A fresh, non-deterministic seed string for "random" puzzles. */
export function randomSeed(length = 8) {
  const bytes = new Uint32Array(length);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 2 ** 32);
  return Array.from(bytes, (b) => SEED_ALPHABET[b % SEED_ALPHABET.length]).join('');
}

/** Per-round seed for multiplayer matches. */
export const deriveSeed = (matchSeed, round) => `${matchSeed}#${round}`;
