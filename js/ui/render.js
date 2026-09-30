// Board view: tiles, arrows, row status. Knows nothing about game state beyond what it is given.
//
//   const view = createBoardView(host, { onMove });
//   view.setBoard(board, { move, animate });   // move = the move just applied (for wrap animation)
//   view.setRowStatus(evals, { hints });
//   view.setLocked(true|false);

import { TILE_IMAGES, TILE_NAMES } from '../core/tiles.js';
import { columnMoveSet } from '../core/board.js';
import { UI } from '../config.js';

const ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 L21 11.5 H16 V21.5 H8 V11.5 H3 Z"/></svg>';
const ARROW_SIZE = 40;
const INFO_WIDTH = 118;
const GAP = 8;       // space between tiles (also the width of the open-set frame)
const ROW_GAP = 12;  // extra vertical space between rows

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

export function createBoardView(host, { onMove }) {
  const root = el('div', 'board', host);
  el('div', 'corner', root);
  const top = el('div', 'arrows arrows-top', root);
  el('div', 'corner', root);
  el('div', 'corner', root);
  const left = el('div', 'arrows arrows-left', root);
  const tiles = el('div', 'tiles', root);
  const right = el('div', 'arrows arrows-right', root);
  const info = el('div', 'row-info', root);
  el('div', 'corner', root);
  const bottom = el('div', 'arrows arrows-bottom', root);

  const tileEls = new Map();   // cell object -> element (cells are immutable, so identity tracks a tile)
  let board = null;
  let builtRows = -1;
  let stripes = [];
  let statusEls = [];
  let colArrows = [];
  let metrics = null;
  let hoverMove = null;
  const highlights = [];

  // ------------------------------------------------------------------ layout

  function computeMetrics() {
    const maxTile = 32 * UI.tileScale;
    const avail = Math.max(320, host.clientWidth || window.innerWidth) - 2 * ARROW_SIZE - INFO_WIDTH - 24;
    const tile = Math.max(24, Math.min(maxTile, Math.floor(avail / board.cols) - GAP));
    const stepX = tile + GAP;
    return { tile, stepX, stepY: stepX + ROW_GAP };
  }

  function applyMetrics() {
    metrics = computeMetrics();
    const s = root.style;
    s.setProperty('--tile', `${metrics.tile}px`);
    s.setProperty('--step-x', `${metrics.stepX}px`);
    s.setProperty('--step-y', `${metrics.stepY}px`);
    s.setProperty('--arrow-size', `${ARROW_SIZE}px`);
    s.setProperty('--info-width', `${INFO_WIDTH}px`);
    tiles.style.width = `${board.cols * metrics.stepX}px`;
    tiles.style.height = `${board.cells.length * metrics.stepY}px`;
    stripes.forEach((st, r) => { st.style.top = `${r * metrics.stepY}px`; });
  }

  function arrowButton(parent, dir, move, label) {
    const b = el('button', `arrow dir-${dir}`, parent);
    b.type = 'button';
    b.innerHTML = ARROW_SVG;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => { if (!b.classList.contains('blocked')) onMove(move); });
    b.addEventListener('mouseenter', () => { hoverMove = move; drawHighlight(); });
    b.addEventListener('mouseleave', () => { hoverMove = null; drawHighlight(); });
    return b;
  }

  function build(rows) {
    for (const c of [top, bottom, left, right, info]) c.replaceChildren();
    stripes.forEach((s) => s.remove());
    colArrows = [];
    for (let col = 0; col < board.cols; col++) {
      colArrows.push(
        arrowButton(top, 'up', { type: 'col', col, dir: 'up' }, `Column ${col + 1} up`),
        arrowButton(bottom, 'down', { type: 'col', col, dir: 'down' }, `Column ${col + 1} down`),
      );
    }
    for (let row = 0; row < rows; row++) {
      arrowButton(left, 'left', { type: 'row', row, dir: 'left' }, `Row ${row + 1} left`);
      arrowButton(right, 'right', { type: 'row', row, dir: 'right' }, `Row ${row + 1} right`);
    }
    stripes = Array.from({ length: rows }, () => {
      const s = el('div', 'stripe');
      tiles.prepend(s);
      return s;
    });
    statusEls = Array.from({ length: rows }, () => el('div', 'row-status', info));
    builtRows = rows;
  }

  // ------------------------------------------------------------------ tiles

  function createTileEl(cell) {
    const t = el('div', 'tile', tiles);
    const img = el('img', '', t);
    img.src = TILE_IMAGES[cell.tile];
    img.alt = cell.tile;
    img.draggable = false;
    img.addEventListener('error', () => {
      const f = el('div', 'fallback');
      f.textContent = cell.tile;
      img.replaceWith(f);
    });
    return t;
  }

  function placeTiles() {
    const live = new Set();
    board.cells.forEach((row, r) => row.forEach((cell, c) => {
      let t = tileEls.get(cell);
      if (!t) { t = createTileEl(cell); tileEls.set(cell, t); }
      live.add(cell);
      t.style.left = `${c * metrics.stepX}px`;
      t.style.top = `${r * metrics.stepY + ROW_GAP / 2}px`;
      const chained = !!cell.chain;
      t.classList.toggle('chain', chained);
      t.classList.toggle('chain-first', chained && row[c - 1]?.chain !== cell.chain);
      t.classList.toggle('chain-last', chained && row[c + 1]?.chain !== cell.chain);
    }));
    for (const [cell, t] of tileEls) {
      if (!live.has(cell)) { t.remove(); tileEls.delete(cell); }
    }
  }

  /**
   * FLIP animation. Tiles that wrapped around an edge would otherwise fly across the board, so
   * they slide in from beyond the edge instead (the tile area clips them).
   */
  function animateFrom(before, move) {
    const deltas = [];
    for (const [cell, t] of tileEls) {
      const b = before.get(cell);
      if (!b) continue;
      const a = t.getBoundingClientRect();
      const dx = b.left - a.left;
      const dy = b.top - a.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) deltas.push({ t, dx, dy });
    }
    if (move) {
      const horizontal = move.type === 'row';
      const sign = move.dir === 'left' || move.dir === 'up' ? 1 : -1;
      const key = horizontal ? 'dx' : 'dy';
      const wrapped = deltas.filter((d) => Math.sign(d[key]) === -sign);
      const amount = horizontal ? wrapped.length * metrics.stepX : metrics.stepY;
      for (const d of wrapped) d[key] = sign * amount;
    }
    for (const { t, dx, dy } of deltas) {
      t.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: UI.animationMs, easing: 'ease-out' },
      );
    }
  }

  // ------------------------------------------------------------------ highlights / arrows

  function drawHighlight() {
    highlights.forEach((h) => h.remove());
    highlights.length = 0;
    if (!hoverMove || !board || root.classList.contains('locked')) return;
    const add = (x, y, w, h, blocked) => {
      const d = el('div', `highlight${blocked ? ' blocked' : ''}`, tiles);
      Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      highlights.push(d);
    };
    const W = board.cols * metrics.stepX;
    const H = board.cells.length * metrics.stepY;
    if (hoverMove.type === 'row') {
      add(0, hoverMove.row * metrics.stepY, W, metrics.stepY, false);
    } else {
      const cols = columnMoveSet(board, hoverMove.col);
      if (!cols) add(hoverMove.col * metrics.stepX, 0, metrics.stepX, H, true);
      else for (const c of cols) add(c * metrics.stepX, 0, metrics.stepX, H, false);
    }
  }

  function updateArrows() {
    for (const b of colArrows) b.classList.remove('blocked');
    for (let col = 0; col < board.cols; col++) {
      const blocked = columnMoveSet(board, col) === null;
      colArrows[col * 2].classList.toggle('blocked', blocked);
      colArrows[col * 2 + 1].classList.toggle('blocked', blocked);
      colArrows[col * 2].title = colArrows[col * 2 + 1].title =
        blocked ? 'Blocked: an open set only partly overlaps these columns' : '';
    }
  }

  // ------------------------------------------------------------------ public API

  function setBoard(next, { move = null, animate = false } = {}) {
    const before = new Map();
    if (animate && board) {
      for (const [cell, t] of tileEls) before.set(cell, t.getBoundingClientRect());
    }
    for (const t of tileEls.values()) t.getAnimations().forEach((a) => a.cancel());

    board = next;
    if (board.cells.length !== builtRows) build(board.cells.length);
    applyMetrics();
    placeTiles();
    updateArrows();
    drawHighlight();
    if (animate) animateFrom(before, move);
  }

  function setRowStatus(evals, { hints }) {
    evals.forEach((e, r) => {
      const seat = board.seatWinds[r];
      const st = statusEls[r];
      st.replaceChildren();
      const seatEl = el('div', 'seat', st);
      const img = el('img', '', seatEl);
      img.src = TILE_IMAGES[seat];
      img.alt = '';
      seatEl.append(`${TILE_NAMES[seat]} seat`);

      const state = el('div', 'state', st);
      let cls = '';
      if (e.status === 'solved') {
        cls = 'solved';
        state.textContent = '✓ Win';
        state.title = e.yaku.join('\n');
      } else if (hints) {
        if (e.status === 'noyaku') { cls = 'noyaku'; state.textContent = 'No yaku'; }
        else if (e.status === 'reorder') { cls = 'noyaku'; state.textContent = 'Tiles OK, reorder'; }
        else state.textContent = e.shanten === 0 ? 'Tenpai' : `${e.shanten}-shanten`;
      }
      if (cls) state.classList.add(cls);
      stripes[r].className = `stripe${hints || cls === 'solved' ? ` ${cls}` : ''}`;
    });
    // Red outline on each row's drawn tile (last loose tile).
    for (const t of tileEls.values()) t.classList.remove('drawn');
    evals.forEach((e, r) => {
      const cell = board.cells[r][e.drawnCol];
      if (cell) tileEls.get(cell)?.classList.add('drawn');
    });
  }

  function setLocked(locked) {
    root.classList.toggle('locked', locked);
    drawHighlight();
  }

  window.addEventListener('resize', () => {
    if (!board) return;
    applyMetrics();
    placeTiles();
    drawHighlight();
  });

  return { setBoard, setRowStatus, setLocked };
}
