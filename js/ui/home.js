// Home screen: title, Solo / 1v1 buttons, and an animated wall of random tiles in perspective.
//
//   const home = createHome(rootEl, { onSolo, onVersus });
//   home.show(); home.hide();
//
// Layout is authored on a 1920×1080 stage (matching the design mockup) and scaled to the window.

import { ALL_TILES_34, TILE_IMAGES } from '../core/tiles.js';
import { HOME } from '../config.js';

const STAGE_W = 1920;
const STAGE_H = 1080;
const TILE = 128;                       // wall tile size in wall-plane px (sprites are 32 px → 4×)
const WALL_COLS = 20;                   // columns 0..19 (column 0 is the wall's visible left edge)
const WALL_ROW_MIN = -3;                // rows -3..10 cover the screen for aspect ratios ~1.1 to ~2.5
const WALL_ROWS = 14;

// Perspective of the wall: a projective transform fitted to the tile seams of the design mockup
// (88 seam intersections, mean error 0.55 px). Maps wall-plane px (col × TILE, row × TILE) to stage px.
const WALL_MATRIX = 'matrix3d(0.472984297, -0.244950538, 0, -0.000218056629, '
  + '0.447576088, 1.42660408, 0, 0.000369902578, 0, 0, 1, 0, 611.902608, 179.066689, 0, 1)';

const RED_FIVES = ['0m', '0p', '0s'];
const randomTile = () => (Math.random() < 0.04
  ? RED_FIVES[Math.floor(Math.random() * 3)]
  : ALL_TILES_34[Math.floor(Math.random() * ALL_TILES_34.length)]);

export function createHome(root, { onSolo, onVersus }) {
  const stage = root.querySelector('.home-stage');
  const wall = root.querySelector('.home-wall');
  wall.style.transform = `${WALL_MATRIX} translateY(${WALL_ROW_MIN * TILE}px)`;
  wall.style.width = `${WALL_COLS * TILE}px`;
  wall.style.height = `${WALL_ROWS * TILE}px`;

  // grid[r][c] = tile element; r is 0-based (0 = wall row WALL_ROW_MIN)
  const grid = Array.from({ length: WALL_ROWS }, (_, r) => Array.from({ length: WALL_COLS }, (_, c) => {
    const img = document.createElement('img');
    img.className = 'wall-tile';
    img.src = TILE_IMAGES[randomTile()];
    img.alt = '';
    img.draggable = false;
    place(img, c, r);
    wall.appendChild(img);
    return img;
  }));

  function place(img, c, r) {
    img.style.transform = `translate(${c * TILE}px, ${r * TILE}px)`;
  }

  function slide(img, from, to) {
    place(img, to[0], to[1]);
    img.animate(
      [{ transform: `translate(${from[0] * TILE}px, ${from[1] * TILE}px)` },
        { transform: `translate(${to[0] * TILE}px, ${to[1] * TILE}px)` }],
      { duration: HOME.shiftMs, easing: 'ease-in-out' },
    );
  }

  /** Rotate one wall row (dir ±1) or column, like a move in the game. Wrapped tiles slide in from outside. */
  function shiftRow(r, dir) {
    const row = grid[r];
    const old = row.slice();
    old.forEach((img, c) => {
      const nc = (c + dir + WALL_COLS) % WALL_COLS;
      const wrapped = nc !== c + dir;
      slide(img, [wrapped ? nc - dir : c, r], [nc, r]);
      row[nc] = img;
    });
  }

  function shiftCol(c, dir) {
    const old = grid.map((row) => row[c]);
    old.forEach((img, r) => {
      const nr = (r + dir + WALL_ROWS) % WALL_ROWS;
      const wrapped = nr !== r + dir;
      slide(img, [c, wrapped ? nr - dir : r], [c, nr]);
      grid[nr][c] = img;
    });
  }

  // Only shift rows/columns that are on screen, so every shift is visible.
  const VISIBLE_ROWS = [-1, 7];   // wall rows (inclusive)
  const VISIBLE_COLS = [0, 14];
  const pick = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));

  let timer = null;
  function tick() {
    const dir = Math.random() < 0.5 ? -1 : 1;
    if (Math.random() < 0.5) shiftRow(pick(VISIBLE_ROWS) - WALL_ROW_MIN, dir);
    else shiftCol(pick(VISIBLE_COLS), dir);
    timer = setTimeout(tick, HOME.shiftEveryMs * (0.6 + Math.random() * 0.8));
  }
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ stage scaling

  function fit() {
    const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    const offY = (window.innerHeight - STAGE_H * s) / 2;
    stage.style.transform = `translate(0px, ${offY}px) scale(${s})`;
  }
  window.addEventListener('resize', () => { if (!root.hidden) fit(); });

  root.querySelector('.btn-solo').addEventListener('click', onSolo);
  root.querySelector('.btn-1v1').addEventListener('click', onVersus);

  return {
    show() {
      root.hidden = false;
      fit();
      if (!timer && !reducedMotion) timer = setTimeout(tick, HOME.shiftEveryMs / 2);
    },
    hide() {
      root.hidden = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}
