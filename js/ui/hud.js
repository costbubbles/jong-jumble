// HUD: binds the static controls in index.html: top bar (stats, Undo/Restart/New, Menu, How to play),
// the Solo setup dialog, the help dialog and the win dialog.

import { DIFFICULTIES, ORDER_RULES } from '../config.js';
import { TILE_NAMES } from '../core/tiles.js';

const $ = (id) => document.getElementById(id);

export function formatTime(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const CONTROL_NOTES = {
  shift: 'Arrows, WASD, or drag a tile to rotate its row or column.',
  drop: 'Click tiles to select a run, then drag it to another row (swap) or along its row (reorder).',
};

/**
 * handlers: {
 *   onPlay({ seed, difficulty, order }), onResume(), onTitle(), onMenu(),
 *   onUndo(), onRestart(), onNew(), onHints(bool), onControlMode('shift' | 'drop'), onDropSwap(bool),
 * }
 */
export function createHud(handlers) {
  // ------------------------------------------------------------------ setup dialog
  const setup = $('setup-dialog');
  const difficulty = $('difficulty');
  for (const [key, d] of Object.entries(DIFFICULTIES)) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="radio" name="difficulty" value="${key}"><span>${d.label}<small>${d.rows} rows</small></span>`;
    difficulty.appendChild(label);
  }
  const order = $('order');
  for (const [key, r] of Object.entries(ORDER_RULES)) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="radio" name="order" value="${key}"><span>${r.label}<small>${r.note}</small></span>`;
    order.appendChild(label);
  }
  const radioValue = (name) => setup.querySelector(`input[name="${name}"]:checked`)?.value;
  const setRadio = (name, value) => {
    const input = setup.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  };

  $('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    setup.close();
    handlers.onPlay({
      seed: $('seed-input').value.trim(),
      difficulty: radioValue('difficulty'),
      order: radioValue('order'),
    });
  });
  $('setup-resume').addEventListener('click', () => { setup.close(); handlers.onResume(); });
  $('setup-home').addEventListener('click', () => { setup.close(); handlers.onTitle(); });
  // Esc: resume if there is a game to go back to, otherwise back to the title screen.
  setup.addEventListener('cancel', (e) => {
    e.preventDefault();
    setup.close();
    if ($('setup-resume').hidden) handlers.onTitle();
    else handlers.onResume();
  });
  setup.querySelectorAll('input[name="control-mode"]').forEach((input) => input.addEventListener('change', () => {
    $('control-note').textContent = CONTROL_NOTES[input.value];
    $('drop-swap-field').hidden = input.value !== 'drop';
    handlers.onControlMode(input.value);
  }));
  $('drop-swap').addEventListener('change', (e) => handlers.onDropSwap(e.target.checked));
  $('hints').addEventListener('change', (e) => handlers.onHints(e.target.checked));

  // ------------------------------------------------------------------ top bar
  $('menu-btn').addEventListener('click', handlers.onMenu);
  $('help-btn').addEventListener('click', () => $('help-dialog').showModal());
  $('help-close').addEventListener('click', () => $('help-dialog').close());
  $('undo').addEventListener('click', handlers.onUndo);
  $('restart').addEventListener('click', handlers.onRestart);
  $('new').addEventListener('click', handlers.onNew);

  // ------------------------------------------------------------------ win dialog
  const win = $('win-dialog');
  $('win-close').addEventListener('click', () => win.close());
  $('win-new').addEventListener('click', () => { win.close(); handlers.onNew(); });
  $('copy-link').addEventListener('click', async () => {
    const input = $('share-link');
    try {
      await navigator.clipboard.writeText(input.value);
      $('copy-link').textContent = 'Copied!';
    } catch {
      input.select();
    }
    setTimeout(() => { $('copy-link').textContent = 'Copy link'; }, 1500);
  });

  return {
    /** Open the Solo setup. canResume shows "Resume" (a puzzle is in progress). */
    openSetup({ canResume }) {
      $('setup-resume').hidden = !canResume;
      $('setup-play').textContent = canResume ? 'New game' : 'Play';
      if (!setup.open) setup.showModal();
      $('setup-play').focus();
    },
    setSetupValues({ seed, typed, difficulty: diff, controlMode, hints, order: orderRule, dropSwap }) {
      $('seed-input').value = typed ? seed : '';
      setRadio('difficulty', diff);
      setRadio('order', orderRule);
      $('drop-swap').checked = dropSwap;
      $('drop-swap-field').hidden = controlMode !== 'drop';
      setRadio('control-mode', controlMode);
      $('control-note').textContent = CONTROL_NOTES[controlMode] ?? '';
      $('hints').checked = hints;
    },
    setPuzzle({ seed, typed, roundWind }) {
      $('seed-display').textContent = seed;
      $('round-wind').textContent = TILE_NAMES[roundWind];
      $('new').textContent = typed ? 'Reset' : 'New';
      $('new').title = typed
        ? 'Typed seed: resets to the start of this puzzle. Use Menu to pick another seed.'
        : 'Generate a new random puzzle';
    },
    /** 1v1 mode: no Restart/New, a match-round stat, an opponent stat, and a countdown timer. */
    setVersus(on, { round, rounds } = {}) {
      $('restart').hidden = on;
      $('new').hidden = on;
      $('stat-match').hidden = !on;
      $('stat-opponent').hidden = !on;
      $('time-label').textContent = on ? 'Time left' : 'Time';
      $('menu-btn').textContent = on ? 'Leave' : 'Menu';
      if (on) $('match-round').textContent = `${round}/${rounds}`;
    },
    setOpponent({ name, text }) {
      $('opp-name').textContent = name;
      $('opp-status').textContent = text;
    },
    setStats({ moves, seconds, canUndo, solved }) {
      $('moves').textContent = moves;
      $('time').textContent = formatTime(seconds);
      $('undo').disabled = !canUndo || solved;
    },
    /** rows: evaluateRow results for the solved board. */
    showWin({ score, breakdown, moves, seconds, seed, link, rows }) {
      $('win-score').textContent = score.toLocaleString();
      $('win-breakdown').textContent = breakdown ?? '';
      $('win-moves').textContent = moves;
      $('win-time').textContent = formatTime(seconds);
      $('win-seed').textContent = seed;
      $('share-link').value = link;
      $('win-yaku').replaceChildren(...rows.map((r) => {
        const li = document.createElement('li');
        const head = document.createElement('strong');
        head.textContent = `${r.points.toLocaleString()} pts`;
        const detail = ` (${r.han} han ${r.fu} fu${r.limit ? `, ${r.limit}` : ''}): `;
        li.append(head, detail + r.yakuHan.map((y) => `${y.name} ${y.han}`).join(', '));
        return li;
      }));
      win.showModal();
    },
    hideWin() { if (win.open) win.close(); },
  };
}
