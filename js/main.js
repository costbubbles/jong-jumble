// Single-player controller: owns the game state and wires the core logic to the view and HUD.

import { DIFFICULTIES, DEFAULT_DIFFICULTY, GENERATION, UI } from './config.js';
import { generatePuzzle } from './core/generator.js';
import { applyMove, inverseMove } from './core/board.js';
import { evaluateBoard } from './core/yaku.js';
import { computeScore } from './core/scoring.js';
import { randomSeed } from './core/rng.js';
import { createBoardView } from './ui/render.js';
import { createHud } from './ui/hud.js';

const HINTS_KEY = 'mahjong-rows.hints';
const CONTROLS_KEY = 'mahjong-rows.controls';

const state = {
  seed: '',
  typed: false,        // true when the player chose the seed (New button then only resets)
  difficulty: DEFAULT_DIFFICULTY,
  puzzle: null,
  board: null,
  history: [],         // [{ board, move }] for undo
  moves: 0,
  startedAt: null,     // ms timestamp of the first move
  solvedSeconds: null,
  evals: [],
  hints: loadHints(),
  controlMode: loadSetting(CONTROLS_KEY, UI.controlModeDefault),
};

function loadSetting(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function loadHints() {
  try {
    const v = localStorage.getItem(HINTS_KEY);
    return v === null ? UI.hintsDefault : v === '1';
  } catch {
    return UI.hintsDefault;
  }
}

function saveHints(on) {
  try { localStorage.setItem(HINTS_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

const elapsed = () => {
  if (state.solvedSeconds !== null) return state.solvedSeconds;
  return state.startedAt === null ? 0 : (performance.now() - state.startedAt) / 1000;
};

const shareLink = () => {
  const url = new URL(location.href);
  url.search = new URLSearchParams({ seed: state.seed, d: state.difficulty }).toString();
  return url.toString();
};

function syncUrl() {
  const params = new URLSearchParams({ d: state.difficulty });
  if (state.typed) params.set('seed', state.seed);
  history.replaceState(null, '', `?${params}`);
}

// ---------------------------------------------------------------------------

function newPuzzle({ seed = '', difficulty = state.difficulty } = {}) {
  state.typed = seed !== '';
  state.seed = state.typed ? seed : randomSeed(GENERATION.randomSeedLength);
  state.difficulty = DIFFICULTIES[difficulty] ? difficulty : DEFAULT_DIFFICULTY;
  state.puzzle = generatePuzzle(state.seed, state.difficulty);
  hud.setPuzzle({ ...state, roundWind: state.puzzle.board.roundWind });
  syncUrl();
  restart();
}

function restart() {
  state.board = state.puzzle.board;
  state.history = [];
  state.moves = 0;
  state.startedAt = null;
  state.solvedSeconds = null;
  hud.hideWin();
  update({ animate: false });
}

function isSolved() {
  return state.solvedSeconds !== null;
}

/** Applies a move if legal. Returns true when the board changed. */
function doMove(move) {
  if (isSolved()) return false;
  const next = applyMove(state.board, move);
  if (!next) return false;
  state.history.push({ board: state.board, move });
  state.board = next;
  countMove();
  update({ move, animate: true });
  return true;
}

function undo() {
  if (isSolved() || !state.history.length) return;
  const { board, move } = state.history.pop();
  state.board = board;
  countMove(); // undo counts as a move
  update({ move: inverseMove(move), animate: true });
}

function countMove() {
  state.moves++;
  if (state.startedAt === null) state.startedAt = performance.now();
}

function update({ move = null, animate }) {
  state.evals = evaluateBoard(state.board);
  view.setBoard(state.board, { move, animate });
  view.setRowStatus(state.evals, { hints: state.hints });

  if (state.moves > 0 && state.evals.every((e) => e.solved)) {
    state.solvedSeconds = (performance.now() - state.startedAt) / 1000;
    view.setLocked(true);
    const score = computeScore({
      startShanten: state.puzzle.startShanten,
      handPoints: state.evals.map((e) => e.points),
      moves: state.moves,
      seconds: state.solvedSeconds,
      solved: true,
    });
    setTimeout(() => hud.showWin({
      score,
      moves: state.moves,
      seconds: state.solvedSeconds,
      seed: state.seed,
      link: shareLink(),
      rows: state.evals,
    }), UI.animationMs + 150);
  } else {
    view.setLocked(false);
  }
  renderStats();
}

function renderStats() {
  hud.setStats({
    moves: state.moves,
    seconds: elapsed(),
    canUndo: state.history.length > 0,
    solved: isSolved(),
  });
}

// ---------------------------------------------------------------------------

const view = createBoardView(document.getElementById('board-host'), { onMove: doMove });

const hud = createHud({
  onPlay: (seed, difficulty) => newPuzzle({ seed, difficulty }),
  onDifficulty: (difficulty) => newPuzzle({ seed: state.typed ? state.seed : '', difficulty }),
  onUndo: undo,
  onRestart: restart,
  onNew: () => (state.typed ? restart() : newPuzzle()),
  onControlMode: (mode) => {
    state.controlMode = mode;
    saveSetting(CONTROLS_KEY, mode);
    view.setControlMode(mode);
  },
  onHints: (on) => {
    state.hints = on;
    saveHints(on);
    view.setRowStatus(state.evals, { hints: on });
  },
});
hud.setHints(state.hints);
hud.setControlMode(state.controlMode);
view.setControlMode(state.controlMode);

// Keyboard: Ctrl+Z undo; WASD / arrow keys shift the row or column of the tile under the mouse.
const KEY_MOVES = {
  w: 'up', arrowup: 'up',
  s: 'down', arrowdown: 'down',
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
};

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog')) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const dir = KEY_MOVES[key];
  const hover = view.getHover();
  if (!dir || !hover || state.controlMode !== 'shift') return;
  e.preventDefault();
  doMove(dir === 'up' || dir === 'down'
    ? { type: 'col', col: hover.col, dir }
    : { type: 'row', row: hover.row, dir });
});

setInterval(() => {
  if (state.startedAt !== null && !isSolved()) renderStats();
}, 250);

const params = new URLSearchParams(location.search);
newPuzzle({ seed: params.get('seed') ?? '', difficulty: params.get('d') ?? DEFAULT_DIFFICULTY });
