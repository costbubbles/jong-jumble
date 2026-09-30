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
};

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

function doMove(move) {
  if (isSolved()) return;
  const next = applyMove(state.board, move);
  if (!next) return;
  state.history.push({ board: state.board, move });
  state.board = next;
  countMove();
  update({ move, animate: true });
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
      yakuByRow: state.evals.map((e) => e.yaku),
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
  onHints: (on) => {
    state.hints = on;
    saveHints(on);
    view.setRowStatus(state.evals, { hints: on });
  },
});
hud.setHints(state.hints);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.closest('input')) {
    e.preventDefault();
    undo();
  }
});

setInterval(() => {
  if (state.startedAt !== null && !isSolved()) renderStats();
}, 250);

const params = new URLSearchParams(location.search);
newPuzzle({ seed: params.get('seed') ?? '', difficulty: params.get('d') ?? DEFAULT_DIFFICULTY });
