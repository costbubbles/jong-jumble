// HUD: binds the static controls in index.html (seed form, stats, buttons, win dialog).

import { DIFFICULTIES } from '../config.js';
import { TILE_NAMES } from '../core/tiles.js';

const $ = (id) => document.getElementById(id);

export function formatTime(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * handlers: { onPlay(seedText, difficulty), onDifficulty(difficulty), onUndo(), onRestart(),
 *             onNew(), onHints(bool) }
 */
export function createHud(handlers) {
  const difficulty = $('difficulty');
  for (const [key, d] of Object.entries(DIFFICULTIES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${d.label} (${d.rows} rows)`;
    difficulty.appendChild(opt);
  }

  $('seed-form').addEventListener('submit', (e) => {
    e.preventDefault();
    handlers.onPlay($('seed-input').value.trim(), difficulty.value);
  });
  difficulty.addEventListener('change', () => handlers.onDifficulty(difficulty.value));
  $('undo').addEventListener('click', handlers.onUndo);
  $('restart').addEventListener('click', handlers.onRestart);
  $('new').addEventListener('click', handlers.onNew);
  $('hints').addEventListener('change', (e) => handlers.onHints(e.target.checked));

  const dialog = $('win-dialog');
  $('win-close').addEventListener('click', () => dialog.close());
  $('win-new').addEventListener('click', () => { dialog.close(); handlers.onNew(); });
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
    setPuzzle({ seed, typed, difficulty: diff, roundWind }) {
      difficulty.value = diff;
      $('seed-input').value = typed ? seed : '';
      $('seed-display').textContent = seed;
      $('round-wind').textContent = TILE_NAMES[roundWind];
      $('new').textContent = typed ? 'Reset' : 'New puzzle';
      $('new').title = typed
        ? 'Typed seed: resets to the start of this puzzle. Clear the seed box and press Play for a random one.'
        : 'Generate a new random puzzle';
    },
    setStats({ moves, seconds, canUndo, solved }) {
      $('moves').textContent = moves;
      $('time').textContent = formatTime(seconds);
      $('undo').disabled = !canUndo || solved;
    },
    setHints(on) { $('hints').checked = on; },
    /** rows: evaluateRow results for the solved board. */
    showWin({ score, moves, seconds, seed, link, rows }) {
      $('win-score').textContent = score.toLocaleString();
      $('win-moves').textContent = moves;
      $('win-time').textContent = formatTime(seconds);
      $('win-seed').textContent = seed;
      $('share-link').value = link;
      const list = $('win-yaku');
      list.replaceChildren(...rows.map((r) => {
        const li = document.createElement('li');
        const head = document.createElement('strong');
        head.textContent = `${r.points.toLocaleString()} pts`;
        const detail = ` (${r.han} han ${r.fu} fu${r.limit ? `, ${r.limit}` : ''}): `;
        li.append(head, detail + r.yakuHan.map((y) => `${y.name} ${y.han}`).join(', '));
        return li;
      }));
      dialog.showModal();
    },
    hideWin() { if (dialog.open) dialog.close(); },
  };
}
