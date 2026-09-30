// 1v1 client: WebSocket connection, lobby dialog, round flow, results.
// Talks to server/rooms.js (protocol in js/net/protocol.js) and drives the board through `game`:
//
//   game.startRound({ seed, difficulty, hints, controlMode, order, dropSwap, startsInMs, timeLimitSec, round, rounds })
//   game.syncBoard(board, moves)   game.lockBoard()   game.endVersus()   game.showTitle()
//   game.setOverlay(text | null)   game.setOpponent({ name, text } | null)

import { DIFFICULTIES, MULTIPLAYER, ORDER_RULES } from '../config.js';
import { sanitizeName } from './protocol.js';

const NAME_KEY = 'jong-jumble.name';
const $ = (id) => document.getElementById(id);

function loadName() {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* storage unavailable */ }
}

function formatLimit(sec) {
  return sec % 60 ? `${sec}s` : `${sec / 60} min`;
}

export function createVersus(game) {
  const dialog = $('versus-dialog');
  let ws = null;
  let room = null;         // last 'room' snapshot
  let you = null;          // my player index
  let inMatch = false;
  let opp = { moves: 0, solved: false };
  let countdownTimer = null;

  const opponentName = () => room?.players[1 - you]?.name ?? 'Opponent';

  // ------------------------------------------------------------------ connection

  function connect(onOpen) {
    if (ws && ws.readyState === WebSocket.OPEN) { onOpen(); return; }
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    showError('');
    ws = new WebSocket(url);
    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handle(msg);
    });
    ws.addEventListener('close', () => {
      const wasInRoom = room !== null;
      ws = null;
      room = null;
      if (wasInRoom) {
        stopCountdown();
        game.setOverlay(null);
        game.endVersus();
        for (const d of ['match-dialog', 'leave-dialog']) if ($(d).open) $(d).close();
        open();
        showError('Connection to the server was lost.');
      }
    });
    ws.addEventListener('error', () => showError('Could not reach the 1v1 server. Is it running (npm start)?'));
  }

  function send(type, data = {}) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
  }

  function leaveRoom() {
    send('leave');
    room = null;
    inMatch = false;
    stopCountdown();
    game.setOverlay(null);
    game.endVersus();
    ws?.close();
    ws = null;
  }

  // ------------------------------------------------------------------ server messages

  function handle(msg) {
    switch (msg.type) {
      case 'joined':
        you = msg.you;
        showLobby();
        break;
      case 'room':
        room = msg;
        you = msg.you;
        renderLobby();
        break;
      case 'roundStart': {
        inMatch = true;
        for (const d of [dialog, $('match-dialog')]) if (d.open) d.close();
        opp = { moves: 0, solved: false };
        const startsInMs = msg.startAt - msg.serverNow;
        game.startRound({ ...msg, startsInMs });
        renderOpponent();
        startCountdown(Date.now() + startsInMs, msg.round, msg.rounds);
        break;
      }
      case 'progress':
        if (msg.player === you) {
          if (msg.solved) game.setOverlay(`Solved! Waiting for ${opponentName()}…`);
        } else {
          opp = { moves: msg.moves, solved: msg.solved };
          renderOpponent();
        }
        break;
      case 'sync':
        game.syncBoard(msg.board, msg.moves);
        break;
      case 'roundEnd': {
        stopCountdown();
        game.lockBoard();
        const more = room && msg.round < room.settings.rounds;
        game.setOverlay(more ? `Round ${msg.round} over. Next round soon…` : 'Match over!');
        break;
      }
      case 'matchEnd':
        inMatch = false;
        game.setOverlay(null);
        game.lockBoard();
        if ($('leave-dialog').open) $('leave-dialog').close();
        showResults(msg);
        break;
      case 'error':
        showError(msg.message);
        $('vs-lobby-note').textContent = msg.message;
        break;
      default:
    }
  }

  // ------------------------------------------------------------------ connect view

  function showError(text) {
    $('vs-error').textContent = text;
  }

  function currentName() {
    const name = sanitizeName($('vs-name').value);
    saveName($('vs-name').value.trim());
    return name;
  }

  $('vs-create').addEventListener('click', () => {
    const name = currentName();
    connect(() => send('create', { name }));
  });
  $('vs-join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('vs-code').value.trim();
    if (!code) { showError('Enter the room code.'); return; }
    const name = currentName();
    connect(() => send('join', { code, name }));
  });
  $('vs-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
  $('vs-back').addEventListener('click', () => {
    dialog.close();
    leaveRoom();
    game.showTitle();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault(); // leaving goes through the Title / Leave buttons
  });

  // ------------------------------------------------------------------ lobby view

  function segmented(containerId, name, options) {
    const box = $(containerId);
    box.replaceChildren(...options.map(([value, label, sub]) => {
      const l = document.createElement('label');
      l.innerHTML = `<input type="radio" name="${name}" value="${value}"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span>`;
      return l;
    }));
    box.addEventListener('change', configure);
  }
  segmented('vs-difficulty', 'vs-difficulty',
    Object.entries(DIFFICULTIES).map(([k, d]) => [k, d.label, `${d.rows} rows`]));
  segmented('vs-rounds', 'vs-rounds', MULTIPLAYER.roundOptions.map((n) => [n, String(n)]));
  segmented('vs-time', 'vs-time', MULTIPLAYER.timeLimitOptions.map((s) => [s, formatLimit(s)]));
  segmented('vs-controls', 'vs-controls', [['shift', 'Shift'], ['drop', 'Drag & drop']]);
  segmented('vs-order', 'vs-order', Object.entries(ORDER_RULES).map(([k, r]) => [k, r.label, r.note]));
  $('vs-dropswap').addEventListener('change', configure);
  $('vs-hints').addEventListener('change', configure);
  $('vs-seed').addEventListener('change', configure);

  const radio = (name) => dialog.querySelector(`input[name="${name}"]:checked`)?.value;
  const setRadio = (name, value) => {
    const input = dialog.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  };

  function configure() {
    if (you !== 0) return;
    send('configure', {
      settings: {
        difficulty: radio('vs-difficulty'),
        rounds: Number(radio('vs-rounds')),
        timeLimitSec: Number(radio('vs-time')),
        controlMode: radio('vs-controls'),
        order: radio('vs-order'),
        dropSwap: $('vs-dropswap').checked,
        hints: $('vs-hints').checked,
        seed: $('vs-seed').value,
      },
    });
  }

  function showLobby() {
    $('vs-connect').hidden = true;
    $('vs-lobby').hidden = false;
    if (!dialog.open) dialog.showModal();
  }

  function renderLobby() {
    if (!room) return;
    $('vs-room-code').textContent = room.code;
    const s = room.settings;
    setRadio('vs-difficulty', s.difficulty);
    setRadio('vs-rounds', s.rounds);
    setRadio('vs-time', s.timeLimitSec);
    setRadio('vs-controls', s.controlMode);
    setRadio('vs-order', s.order);
    $('vs-dropswap').checked = s.dropSwap;
    $('vs-dropswap-field').hidden = s.controlMode !== 'drop';
    $('vs-hints').checked = s.hints;
    if (document.activeElement !== $('vs-seed')) $('vs-seed').value = s.seed;

    const isHost = you === 0;
    $('vs-settings').disabled = !isHost;
    $('vs-settings-legend').textContent = isHost ? 'Match settings (you are the host)' : 'Match settings (set by the host)';

    $('vs-players').replaceChildren(...[0, 1].map((i) => {
      const p = room.players[i];
      const li = document.createElement('li');
      li.className = p ? (p.ready ? 'ready' : '') : 'empty';
      li.innerHTML = p
        ? `<span class="p-name"></span><span class="p-tags">${i === 0 ? '<em>host</em>' : ''}${i === you ? '<em>you</em>' : ''}</span><span class="p-ready">${p.ready ? 'Ready ✓' : 'Not ready'}</span>`
        : '<span class="p-name">Waiting for opponent…</span>';
      if (p) li.querySelector('.p-name').textContent = p.name;
      return li;
    }));

    const me = room.players[you];
    $('vs-ready').textContent = me?.ready ? 'Not ready' : 'Ready';
    $('vs-ready').disabled = room.players.length < 2;
    $('vs-lobby-note').textContent = room.players.length < 2
      ? 'Waiting for someone to join with the code…'
      : room.players.every((p) => p.ready) ? 'Starting…'
        : me?.ready ? `Waiting for ${opponentName()} to ready up.` : 'Press Ready when you are set.';
  }

  $('vs-ready').addEventListener('click', () => {
    const me = room?.players[you];
    send('ready', { ready: !me?.ready });
  });
  $('vs-leave').addEventListener('click', () => {
    leaveRoom();
    $('vs-lobby').hidden = true;
    $('vs-connect').hidden = false;
  });
  $('vs-copy-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(room?.code ?? '');
      $('vs-copy-code').textContent = 'Copied!';
      setTimeout(() => { $('vs-copy-code').textContent = 'Copy code'; }, 1500);
    } catch { /* clipboard blocked */ }
  });

  // ------------------------------------------------------------------ in-round UI

  function renderOpponent() {
    game.setOpponent({
      name: opponentName(),
      text: opp.solved ? 'Solved ✓' : `${opp.moves} moves`,
    });
  }

  function startCountdown(startAtLocal, round, rounds) {
    stopCountdown();
    const tick = () => {
      const left = startAtLocal - Date.now();
      if (left > 0) {
        game.setOverlay(`Round ${round}/${rounds}  ·  ${Math.ceil(left / 1000)}`);
      } else if (left > -700) {
        game.setOverlay('Go!');
      } else {
        game.setOverlay(null);
        stopCountdown();
      }
    };
    tick();
    countdownTimer = setInterval(tick, 100);
  }

  function stopCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }

  // ------------------------------------------------------------------ results

  function showResults(msg) {
    const names = msg.names;
    const mine = you;
    const title = msg.winner === null ? "It's a draw!" : msg.winner === mine ? 'You win!' : `${names[msg.winner]} wins!`;
    $('match-title').textContent = title;
    const tiebreak = !msg.forfeit && msg.winner !== null && msg.totals[0] === msg.totals[1];
    $('match-sub').textContent = msg.forfeit
      ? `${names[msg.winner === 0 ? 1 : 0]} left the match.`
      : `Final score ${msg.totals[mine].toLocaleString()} – ${msg.totals[1 - mine].toLocaleString()}`
        + (tiebreak ? ' (tie broken by faster total time)' : '');

    const table = $('match-table');
    const cell = (tag, text, cls) => {
      const c = document.createElement(tag);
      c.textContent = text;
      if (cls) c.className = cls;
      return c;
    };
    const head = document.createElement('tr');
    head.append(cell('th', 'Round'), ...names.map((n, i) => cell('th', i === mine ? `${n} (you)` : n)));
    const rows = msg.rounds.map((r, i) => {
      const tr = document.createElement('tr');
      tr.append(cell('td', String(i + 1)), ...r.map((res) => cell('td',
        res.solved ? `${res.score.toLocaleString()}  (${res.moves} moves, ${res.seconds}s)` : '0  (unsolved)',
        res.solved ? '' : 'unsolved')));
      return tr;
    });
    const total = document.createElement('tr');
    total.className = 'total';
    total.append(cell('td', 'Total'), ...msg.totals.map((t, i) => cell('td', t.toLocaleString(), i === msg.winner ? 'winner' : '')));
    table.replaceChildren(head, ...rows, total);
    $('match-rematch').disabled = msg.forfeit;
    $('match-dialog').showModal();
  }

  $('match-rematch').addEventListener('click', () => {
    $('match-dialog').close();
    showLobby();
    send('ready', { ready: true });
  });
  $('match-leave').addEventListener('click', () => {
    $('match-dialog').close();
    leaveRoom();
    game.showTitle();
  });
  $('match-dialog').addEventListener('cancel', (e) => e.preventDefault());

  // ------------------------------------------------------------------ leaving mid-match

  $('leave-stay').addEventListener('click', () => $('leave-dialog').close());
  $('leave-confirm').addEventListener('click', () => {
    $('leave-dialog').close();
    leaveRoom();
    game.showTitle();
  });

  // ------------------------------------------------------------------ public API

  function open() {
    $('vs-name').value = loadName();
    $('vs-connect').hidden = room !== null;
    $('vs-lobby').hidden = room === null;
    if (!dialog.open) dialog.showModal();
    if (room === null) ($('vs-name').value ? $('vs-create') : $('vs-name')).focus();
  }

  return {
    open,
    /** Menu / logo during a 1v1: confirm before forfeiting; between matches just show the lobby. */
    requestLeave() {
      if (inMatch) $('leave-dialog').showModal();
      else open();
    },
    sendMove: (move) => send('move', { move }),
    sendUndo: () => send('undo'),
    get active() { return room !== null; },
  };
}
