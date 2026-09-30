// Tile IDs use standard notation: 1m-9m, 1p-9p, 1s-9s, red fives 0m/0p/0s, honors 1z-7z
// (1z East, 2z South, 3z West, 4z North, 5z Haku, 6z Hatsu, 7z Chun).

export const SUITS = ['m', 'p', 's', 'z'];
export const WINDS = ['1z', '2z', '3z', '4z'];
export const DRAGONS = ['5z', '6z', '7z'];

export const TILE_NAMES = {
  '1z': 'East', '2z': 'South', '3z': 'West', '4z': 'North',
  '5z': 'Haku', '6z': 'Hatsu', '7z': 'Chun',
};

const SUIT_OFFSET = { m: 0, p: 9, s: 18, z: 27 };

export const suit = (t) => t[1];
export const isRed = (t) => t[0] === '0';
export const num = (t) => (isRed(t) ? 5 : Number(t[0]));
export const normalize = (t) => (isRed(t) ? `5${t[1]}` : t);
export const isHonor = (t) => t[1] === 'z';
export const isTerminal = (t) => !isHonor(t) && (num(t) === 1 || num(t) === 9);
export const isTerminalOrHonor = (t) => isHonor(t) || isTerminal(t);
export const isSimple = (t) => !isHonor(t) && num(t) >= 2 && num(t) <= 8;

export function isValidTile(t) {
  if (typeof t !== 'string' || t.length !== 2) return false;
  const n = Number(t[0]);
  if (!(t[1] in SUIT_OFFSET) || !Number.isInteger(n)) return false;
  return t[1] === 'z' ? n >= 1 && n <= 7 : n >= 0 && n <= 9;
}

/** 0..33: m 0-8, p 9-17, s 18-26, z 27-33. Red fives map to their 5. */
export const toIndex34 = (t) => SUIT_OFFSET[t[1]] + num(t) - 1;
export const fromIndex34 = (i) => `${(i % 9) + 1}${SUITS[Math.floor(i / 9)]}`;
export const ALL_TILES_34 = Array.from({ length: 34 }, (_, i) => fromIndex34(i));

export const sortKey = (t) => toIndex34(t) * 2 + (isRed(t) ? 1 : 0);
export const sortTiles = (tiles) => [...tiles].sort((a, b) => sortKey(a) - sortKey(b));

export function counts34(tiles) {
  const c = new Array(34).fill(0);
  for (const t of tiles) c[toIndex34(t)]++;
  return c;
}

/** "123m406p77z" -> ['1m','2m','3m','4p','0p','6p','7z','7z']. Whitespace is ignored. */
export function parseTiles(str) {
  const s = str.replace(/\s+/g, '');
  const tiles = [];
  let consumed = 0;
  for (const [whole, digits, st] of s.matchAll(/(\d+)([mpsz])/g)) {
    consumed += whole.length;
    for (const d of digits) {
      const t = d + st;
      if (!isValidTile(t)) throw new Error(`Invalid tile "${t}" in "${str}"`);
      tiles.push(t);
    }
  }
  if (consumed !== s.length) throw new Error(`Could not parse tiles "${str}"`);
  return tiles;
}

/** Inverse of parseTiles (groups consecutive tiles of the same suit). */
export function tilesToString(tiles) {
  let out = '';
  for (let i = 0; i < tiles.length; i++) {
    out += tiles[i][0];
    if (i === tiles.length - 1 || tiles[i + 1][1] !== tiles[i][1]) out += tiles[i][1];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sprite mapping. This is the ONLY place that knows the art filenames.
// The sprite files use m = man, s = pin (circles), b = sou (bamboo).
// ---------------------------------------------------------------------------
const SPRITE_DIR = 'sprites/';
const SPRITE_SUIT = { m: 'm', p: 's', s: 'b' };
const HONOR_SPRITES = {
  '1z': 'east', '2z': 'south', '3z': 'west', '4z': 'north',
  '5z': 'white', '6z': 'Green', '7z': 'Red',
};

export const TILE_IMAGES = (() => {
  const map = {};
  for (const st of ['m', 'p', 's']) {
    for (let n = 1; n <= 9; n++) map[`${n}${st}`] = `${SPRITE_DIR}${n}${SPRITE_SUIT[st]}.png`;
    map[`0${st}`] = `${SPRITE_DIR}5r${SPRITE_SUIT[st]}.png`;
  }
  for (const [t, name] of Object.entries(HONOR_SPRITES)) map[t] = `${SPRITE_DIR}${name}.png`;
  return map;
})();
