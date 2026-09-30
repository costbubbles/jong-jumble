// Board view: tiles, arrows, row status. Knows nothing about game state beyond what it is given.
//
//   const view = createBoardView(host, { onMove });
//   view.setBoard(board, { move, animate });   // move = the move just applied (for wrap animation)
//   view.setRowStatus(evals, { hints });
//   view.setLocked(true|false);
//   view.setControlMode('shift' | 'drop');
//   view.getHover();                            // { row, col } under the mouse, or null
//
// onMove(move) must return true if the move was applied (the view then receives setBoard).
//
// Pointer controls:
//   shift mode: drag a tile sideways to shift its row, up/down to shift its column; one shift per
//               tile dragged, applied live.
//   drop mode:  click tiles to select an adjacent run in one row (chains are always selected whole),
//               then drag the selection onto another row (swap) or elsewhere in its row (reorder).

import { TILE_IMAGES, TILE_NAMES } from '../core/tiles.js';
import { applyMove, columnMoveSet, expandSelection } from '../core/board.js';
import { UI } from '../config.js';

const ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 L21 11.5 H16 V21.5 H8 V11.5 H3 Z"/></svg>';
const ARROW_SIZE = 40;
const INFO_WIDTH = 118;
const GAP = 0;       // space between tiles
const ROW_GAP = 10;  // extra vertical space between rows (rows are separate hands)

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
  const winHead = el('div', 'win-head', root);
  winHead.textContent = 'Win';
  el('div', 'corner', root);
  el('div', 'corner', root);
  const left = el('div', 'arrows arrows-left', root);
  const tiles = el('div', 'tiles', root);
  const winCol = el('div', 'win-col', root);   // fixed winning tiles, outside the playfield
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
  let hoverCell = null;
  const highlights = [];
  let boxes = [];
  let lastStatus = null;   // [evals, opts] from the last setRowStatus, redrawn on resize
  const hoverEl = el('div', 'hover-cell');
  hoverEl.hidden = true;
  const dropEl = el('div', 'drop-target');
  dropEl.hidden = true;
  let controlMode = 'shift';
  let selection = null;    // drop mode: { row, start, len }
  let drag = null;         // active pointer gesture

  const isLocked = () => root.classList.contains('locked');

  /** Playfield cell under a viewport point, or null (clamp = snap to the nearest cell instead). */
  function cellAt(clientX, clientY, clamp = false) {
    const rect = tiles.getBoundingClientRect();
    let col = Math.floor((clientX - rect.left) / metrics.stepX);
    let row = Math.floor((clientY - rect.top) / metrics.stepY);
    if (clamp) {
      col = Math.min(board.cols - 1, Math.max(0, col));
      row = Math.min(board.cells.length - 1, Math.max(0, row));
    }
    const inside = row >= 0 && row < board.cells.length && col >= 0 && col < board.cols;
    return inside ? { row, col } : null;
  }

  tiles.addEventListener('mousemove', (e) => {
    if (!board) return;
    hoverCell = cellAt(e.clientX, e.clientY);
    drawHoverCell();
  });
  tiles.addEventListener('mouseleave', () => { hoverCell = null; drawHoverCell(); });

  // ------------------------------------------------------------------ pointer: drag to shift / drag & drop

  const DRAG_THRESHOLD = 6;

  tiles.addEventListener('pointerdown', (e) => {
    if (!board || isLocked() || e.button !== 0) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    tiles.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, cell, axis: null, moved: false };
  });

  tiles.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (controlMode === 'shift') dragShift(e);
    else dragDrop(e);
  });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (controlMode === 'drop') {
      if (!d.moved) clickSelect(d.cell);
      else finishDrop(d);
    }
  };
  tiles.addEventListener('pointerup', endDrag);
  tiles.addEventListener('pointercancel', () => {
    if (drag?.moved && controlMode === 'drop') { drag.move = null; finishDrop(drag); }
    drag = null;
  });

  /** Shift mode: every full tile dragged along the locked axis applies one shift. */
  function dragShift(e) {
    let dx = e.clientX - drag.x0;
    let dy = e.clientY - drag.y0;
    if (!drag.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD) return;
      drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    }
    const { row, col } = drag.cell;
    if (drag.axis === 'x') {
      while (Math.abs(dx) >= metrics.stepX) {
        const dir = dx > 0 ? 'right' : 'left';
        onMove({ type: 'row', row, dir });
        drag.x0 += dx > 0 ? metrics.stepX : -metrics.stepX;
        dx = e.clientX - drag.x0;
      }
    } else {
      while (Math.abs(dy) >= metrics.stepY) {
        const dir = dy > 0 ? 'down' : 'up';
        onMove({ type: 'col', col, dir }); // a blocked column just doesn't move
        drag.y0 += dy > 0 ? metrics.stepY : -metrics.stepY;
        dy = e.clientY - drag.y0;
      }
    }
  }

  /** Drop mode: drag the selection; show where it would land and whether that is allowed. */
  function dragDrop(e) {
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD) return;
      const { row, col } = drag.cell;
      const inSel = selection && selection.row === row
        && col >= selection.start && col < selection.start + selection.len;
      if (!inSel) selection = expandSelection(board, { row, start: col, len: 1 });
      if (!selection) return;
      drag.moved = true;
      drag.from = selection;
      drag.grab = col - selection.start;
      drag.els = board.cells[row].slice(selection.start, selection.start + selection.len)
        .map((cell) => tileEls.get(cell));
      drawSelection();
      drag.els.forEach((t) => t.classList.add('dragging'));
    }
    drag.els.forEach((t) => { t.style.transform = `translate(${dx}px, ${dy}px)`; });

    const target = cellAt(e.clientX, e.clientY, true);
    const len = drag.from.len;
    const col = Math.min(board.cols - len, Math.max(0, target.col - drag.grab));
    const move = { type: 'drop', from: drag.from, to: { row: target.row, col } };
    const same = target.row === drag.from.row && col === drag.from.start;
    drag.move = !same && applyMove(board, move) ? move : null;

    if (!dropEl.parentNode) tiles.appendChild(dropEl);
    dropEl.hidden = same;
    dropEl.classList.toggle('invalid', !drag.move);
    Object.assign(dropEl.style, {
      left: `${col * metrics.stepX}px`,
      top: `${target.row * metrics.stepY + ROW_GAP / 2}px`,
      width: `${len * metrics.stepX}px`,
      height: `${metrics.stepX}px`,
    });
  }

  function finishDrop(d) {
    dropEl.hidden = true;
    const applied = d.move ? onMove(d.move) : false;
    if (applied) return; // setBoard re-rendered; tiles slide from where they were dropped
    // Refused: slide the tiles back into place.
    for (const t of d.els ?? []) {
      const from = t.style.transform;
      t.style.transform = '';
      t.classList.remove('dragging');
      if (from) {
        t.animate([{ transform: from }, { transform: 'translate(0, 0)' }],
          { duration: UI.animationMs * 1.5, easing: 'ease-out' });
      }
    }
  }

  /** Drop mode click: build an adjacent selection in one row; clicking an end unit removes it. */
  function clickSelect({ row, col }) {
    const unit = expandSelection(board, { row, start: col, len: 1 });
    if (!unit) return;
    const uEnd = unit.start + unit.len - 1;
    if (!selection || selection.row !== row) {
      selection = unit;
    } else {
      const a = selection.start;
      const b = a + selection.len - 1;
      if (unit.start >= a && uEnd <= b) {
        // Clicked inside: drop that unit if it is at an end, otherwise clear.
        if (unit.start === a && uEnd === b) selection = null;
        else if (unit.start === a) selection = { row, start: uEnd + 1, len: b - uEnd };
        else if (uEnd === b) selection = { row, start: a, len: unit.start - a };
        else selection = null;
      } else if (unit.start === b + 1 || uEnd === a - 1) {
        const start = Math.min(a, unit.start);
        selection = { row, start, len: Math.max(b, uEnd) - start + 1 };
      } else {
        selection = unit; // not adjacent: start a new selection
      }
    }
    drawSelection();
  }

  function drawSelection() {
    for (const t of tileEls.values()) t.classList.remove('selected');
    if (!selection) return;
    board.cells[selection.row].slice(selection.start, selection.start + selection.len)
      .forEach((cell) => tileEls.get(cell)?.classList.add('selected'));
  }

  function setControlMode(mode) {
    controlMode = mode === 'drop' ? 'drop' : 'shift';
    root.classList.toggle('mode-drop', controlMode === 'drop');
    selection = null;
    if (board) drawSelection();
  }

  function drawHoverCell() {
    hoverEl.hidden = !hoverCell || root.classList.contains('locked');
    if (hoverEl.hidden) return;
    if (!hoverEl.parentNode) tiles.appendChild(hoverEl);
    hoverEl.style.left = `${hoverCell.col * metrics.stepX}px`;
    hoverEl.style.top = `${hoverCell.row * metrics.stepY + ROW_GAP / 2}px`;
  }

  // ------------------------------------------------------------------ layout

  function computeMetrics() {
    const maxTile = 32 * UI.tileScale;
    const avail = Math.max(320, host.clientWidth || window.innerWidth) - 2 * ARROW_SIZE - INFO_WIDTH - 48;
    const tile = Math.max(24, Math.min(maxTile, Math.floor(avail / (board.cols + 1)) - GAP));
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
    tiles.style.height = winCol.style.height = `${board.cells.length * metrics.stepY}px`;
    winCol.style.width = `${metrics.stepX}px`;
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

  function createTileEl(cell, parent = tiles) {
    const t = el('div', 'tile', parent);
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
      t.classList.toggle('locked', !!cell.chain);
      t.classList.toggle('sideways', !!cell.sideways);
      t.classList.remove('dragging');
      t.style.transform = '';
    }));
    for (const [cell, t] of tileEls) {
      if (!live.has(cell)) { t.remove(); tileEls.delete(cell); }
    }
    placeWinTiles();
  }

  /** The fixed winning tile of each row, red-outlined, in its own column. */
  function placeWinTiles() {
    const key = board.winTiles.join(',');
    if (winCol.dataset.key !== key) {
      winCol.replaceChildren();
      board.winTiles.forEach((tile) => {
        const t = createTileEl({ tile }, winCol);
        t.classList.add('win-tile');
        t.title = 'Winning tile: completes the one unfinished group in this row';
        winCol.appendChild(t);
      });
      winCol.dataset.key = key;
    }
    [...winCol.children].forEach((t, r) => {
      t.style.left = '0px';
      t.style.top = `${r * metrics.stepY + ROW_GAP / 2}px`;
    });
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
    if (move && move.type !== 'drop') {
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
    selection = null;
    if (board.cells.length !== builtRows) build(board.cells.length);
    applyMetrics();
    placeTiles();
    updateArrows();
    drawHighlight();
    drawHoverCell();
    drawSelection();
    if (animate) animateFrom(before, move);
  }

  /** Colored boxes around valid closed groups: pair yellow, triplet green, sequence blue. */
  function drawBoxes(evals, hints) {
    boxes.forEach((b) => b.remove());
    boxes = [];
    if (!hints) return;
    // Red boxes: tiles the row's winning tile would complete, drawn slightly inset so they
    // stay visible inside a group box.
    evals.forEach((e, r) => e.waits.forEach((g) => {
      const b = el('div', 'box box-win', tiles);
      Object.assign(b.style, {
        left: `${g.col * metrics.stepX + 4}px`,
        top: `${r * metrics.stepY + ROW_GAP / 2 + 4}px`,
        width: `${g.len * metrics.stepX - 8}px`,
        height: `${metrics.stepX - 8}px`,
        animationDelay: `${UI.animationMs}ms`,
      });
      boxes.push(b);
    }));
    evals.forEach((e, r) => e.groups.forEach((g) => {
      const b = el('div', `box box-${g.type}${g.wait ? ' box-wait' : ''}`, tiles);
      Object.assign(b.style, {
        left: `${g.col * metrics.stepX}px`,
        top: `${r * metrics.stepY + ROW_GAP / 2}px`,
        width: `${g.len * metrics.stepX}px`,
        height: `${metrics.stepX}px`,
        animationDelay: `${UI.animationMs}ms`,
      });
      boxes.push(b);
    }));
  }

  function setRowStatus(evals, { hints }) {
    lastStatus = [evals, { hints }];
    drawBoxes(evals, hints);
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
        state.textContent = `✓ ${e.points.toLocaleString()}`;
        state.title = [
          ...e.yakuHan.map((y) => `${y.name}: ${y.han} han`),
          `${e.han} han ${e.fu} fu${e.limit ? ` (${e.limit})` : ''}`,
        ].join('\n');
      } else if (hints) {
        if (e.status === 'noyaku') { cls = 'noyaku'; state.textContent = 'No yaku'; }
        else if (e.status === 'reorder') { cls = 'noyaku'; state.textContent = 'Tiles OK, reorder'; }
        else state.textContent = e.shanten === 0 ? 'Tenpai' : `${e.shanten}-shanten`;
      }
      if (cls) state.classList.add(cls);
      stripes[r].className = `stripe${hints || cls === 'solved' ? ` ${cls}` : ''}`;
    });
    [...winCol.children].forEach((t, r) => t.classList.toggle('solved', evals[r].status === 'solved'));

  }

  function setLocked(locked) {
    root.classList.toggle('locked', locked);
    drawHighlight();
    drawHoverCell();
  }

  window.addEventListener('resize', () => {
    if (!board) return;
    applyMetrics();
    placeTiles();
    drawHighlight();
    drawHoverCell();
    if (lastStatus) setRowStatus(...lastStatus);
  });

  return {
    setBoard,
    setRowStatus,
    setLocked,
    setControlMode,
    getHover: () => (root.classList.contains('locked') ? null : hoverCell),
  };
}
