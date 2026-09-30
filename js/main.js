// Single-player controller: owns the game state and wires the core logic to the view and HUD.
//
// Flow: title screen → Solo → setup dialog (seed, difficulty, controls, hints) → Play → board.
// The Menu button reopens the setup dialog (timer paused) with Resume / New game.
// Shared links (?seed=…&d=…) skip straight to the board.

import { DIFFICULTIES, DEFAULT_DIFFICULTY, GENERATION, UI } from './config.js';
import { generatePuzzle } from './core/generator.js';
import { applyMove, inverseMove } from './core/board.js';
import { evaluateBoard } from './core/yaku.js';
import { computeScore } from './core/scoring.js';
import { randomSeed } from './core/rng.js';
import { createBoardView } from './ui/render.js';
import { createHud } from './ui/hud.js';
import { createHome } from './ui/home.js';

const KEYS = {
  hints: 'jong-jumble.hints',
  controls: 'jong-jumble.controls',
  difficulty: 'jong-jumble.difficulty',
};

function loadSetting(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

const state = {
  seed: '',
  typed: false,        // true when the player chose the seed (New button then only resets)
  difficulty: loadSetting(KEYS.difficulty, DEFAULT_DIFFICULTY),
  puzzle: null,
  board: null,
  history: [],         // [{ board, move }] for undo
  moves: 0,
  startedAt: null,     // ms timestamp of the first move
  pausedAt: null,      // ms timestamp when the menu paused the timer
  solvedSeconds: null,
  evals: [],
  hints: loadSetting(KEYS.hints, UI.hintsDefault ? '1' : '0') === '1',
  controlMode: loadSetting(KEYS.controls, UI.controlModeDefault),
};
if (!DIFFICULTIES[state.difficulty]) state.difficulty = DEFAULT_DIFFICULTY;

const elapsed = () => {
  if (state.solvedSeconds !== null) return state.solvedSeconds;
  if (state.startedAt === null) return 0;
  return ((state.pausedAt ?? performance.now()) - state.startedAt) / 1000;
};

function pauseTimer() {
  if (state.startedAt !== null && !isSolved() && state.pausedAt === null) state.pausedAt = performance.now();
}

function resumeTimer() {
  if (state.pausedAt === null) return;
  state.startedAt += performance.now() - state.pausedAt;
  state.pausedAt = null;
}

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
  saveSetting(KEYS.difficulty, state.difficulty);
  state.puzzle = generatePuzzle(state.seed, state.difficulty);
  hud.setPuzzle({ ...state, roundWind: state.puzzle.board.roundWind });
  boardHost.hidden = false;
  syncUrl();
  restart();
}

function restart() {
  state.board = state.puzzle.board;
  state.history = [];
  state.moves = 0;
  state.startedAt = null;
  state.pausedAt = null;
  state.solvedSeconds = null;
  hud.hideWin();
  update({ animate: false });
}

function isSolved() {
  return state.solvedSeconds !== null;
}

/** Applies a move if legal. Returns true when the board changed. */
function doMove(move) {
  if (!state.puzzle || isSolved()) return false;
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
  resumeTimer();
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

function openMenu() {
  pauseTimer();
  hud.setSetupValues(state);
  hud.openSetup({ canResume: !!state.puzzle && !isSolved() });
}

// ---------------------------------------------------------------------------

const boardHost = document.getElementById('board-host');
boardHost.hidden = true;
const view = createBoardView(boardHost, { onMove: doMove });

const hud = createHud({
  onPlay: ({ seed, difficulty }) => newPuzzle({ seed, difficulty }),
  onResume: resumeTimer,
  onTitle: showHome,
  onMenu: openMenu,
  onUndo: undo,
  onRestart: restart,
  onNew: () => (state.typed ? restart() : newPuzzle()),
  onControlMode: (mode) => {
    state.controlMode = mode;
    saveSetting(KEYS.controls, mode);
    view.setControlMode(mode);
  },
  onHints: (on) => {
    state.hints = on;
    saveSetting(KEYS.hints, on ? '1' : '0');
    if (state.puzzle) view.setRowStatus(state.evals, { hints: on });
  },
});
view.setControlMode(state.controlMode);

// Keyboard: Ctrl+Z undo; WASD / arrow keys shift the row or column of the tile under the mouse.
const KEY_MOVES = {
  w: 'up', arrowup: 'up',
  s: 'down', arrowdown: 'down',
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
};

document.addEventListener('keydown', (e) => {
  if (gameEl.hidden || !state.puzzle || e.target.closest('input, select, textarea, dialog')) return;
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
  if (state.startedAt !== null && !isSolved() && state.pausedAt === null) renderStats();
}, 250);

// ---------------------------------------------------------------------------
// Screens: title (Solo / 1v1) and the game.

const gameEl = document.getElementById('game');
const toast = document.querySelector('.home-toast');

function showGame() {
  home.hide();
  gameEl.hidden = false;
  window.dispatchEvent(new Event('resize')); // board metrics depend on the now-visible layout
}

function showHome() {
  pauseTimer();
  gameEl.hidden = true;
  toast.hidden = true;
  home.show();
}

const home = createHome(document.getElementById('home'), {
  onSolo: () => {
    showGame();
    openMenu();
  },
  onVersus: () => {
    toast.textContent = '1v1 is coming soon!';
    toast.hidden = false;
  },
});

document.getElementById('home-link').addEventListener('click', (e) => {
  e.preventDefault();
  showHome();
});

const params = new URLSearchParams(location.search);
if (params.has('seed')) {
  showGame();
  newPuzzle({ seed: params.get('seed'), difficulty: params.get('d') ?? state.difficulty });
} else {
  showHome();
}
