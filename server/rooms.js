// 1v1 rooms: lobby, host settings, best-of-N rounds with time limits, authoritative move replay,
// hidden scores until the end of the match. Transport-agnostic: each connection is a "client"
// created with connect(send); feed it parsed messages with client.handle(msg) and call
// client.close() when the connection drops. Timing is injectable for tests.

import { MULTIPLAYER } from '../js/config.js';
import { generatePuzzle } from '../js/core/generator.js';
import { applyMove } from '../js/core/board.js';
import { evaluateBoard } from '../js/core/yaku.js';
import { computeScore } from '../js/core/scoring.js';
import { randomSeed, deriveSeed } from '../js/core/rng.js';
import { defaultSettings, normalizeCode, sanitizeName, sanitizeSettings } from '../js/net/protocol.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MOVE_TYPES = new Set(['row', 'col', 'drop']);

export function createRoomManager({ now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const rooms = new Map();

  function newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < MULTIPLAYER.roomCodeLength; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!rooms.has(code)) return code;
    }
  }

  // ------------------------------------------------------------------ room helpers

  const others = (room, p) => room.players.filter((x) => x !== p);

  function broadcast(room, msg) {
    for (const p of room.players) p.send(msg);
  }

  function sendRoom(room) {
    for (const p of room.players) {
      p.send({
        type: 'room',
        code: room.code,
        phase: room.phase,
        settings: room.settings,
        players: room.players.map((x) => ({ name: x.name, ready: x.ready })),
        you: room.players.indexOf(p),
      });
    }
  }

  function clearTimer(room) {
    if (room.timer) cancel(room.timer);
    room.timer = null;
  }

  // ------------------------------------------------------------------ match flow

  function startMatch(room) {
    room.matchSeed = room.settings.seed || randomSeed(8);
    room.round = 0;
    room.results = [];
    for (const p of room.players) p.ready = false;
    startRound(room);
  }

  function startRound(room) {
    clearTimer(room);
    room.round++;
    const seed = deriveSeed(room.matchSeed, room.round);
    room.rules = { order: room.settings.order };
    room.puzzle = generatePuzzle(seed, room.settings.difficulty, room.rules);
    room.startAt = now() + MULTIPLAYER.countdownSec * 1000;
    room.phase = 'playing';
    for (const p of room.players) {
      p.game = { board: room.puzzle.board, history: [], moves: 0, solvedAt: null };
    }
    broadcast(room, {
      type: 'roundStart',
      round: room.round,
      rounds: room.settings.rounds,
      seed,
      difficulty: room.settings.difficulty,
      startAt: room.startAt,
      serverNow: now(),
      timeLimitSec: room.settings.timeLimitSec,
      hints: room.settings.hints,
      controlMode: room.settings.controlMode,
      order: room.settings.order,
      dropSwap: room.settings.dropSwap,
    });
    room.timer = schedule(() => endRound(room),
      MULTIPLAYER.countdownSec * 1000 + room.settings.timeLimitSec * 1000);
  }

  function resultFor(room, p) {
    const g = p.game;
    const solved = g.solvedAt !== null;
    const seconds = solved ? (g.solvedAt - room.startAt) / 1000 : room.settings.timeLimitSec;
    const handPoints = solved ? evaluateBoard(g.board, room.rules).map((e) => e.points) : [];
    return {
      solved,
      moves: g.moves,
      seconds: Math.round(seconds * 10) / 10,
      points: handPoints.reduce((a, b) => a + b, 0),
      score: computeScore({ startShanten: room.puzzle.startShanten, handPoints, moves: g.moves, seconds, solved }),
    };
  }

  function endRound(room) {
    if (room.phase !== 'playing') return;
    clearTimer(room);
    room.results.push(room.players.map((p) => resultFor(room, p)));
    broadcast(room, { type: 'roundEnd', round: room.round });
    if (room.round < room.settings.rounds) {
      room.phase = 'between';
      room.timer = schedule(() => startRound(room), MULTIPLAYER.roundBreakSec * 1000);
    } else {
      finishMatch(room, null);
    }
  }

  /** forfeitBy: the player who left mid-match (their opponent wins), or null. */
  function finishMatch(room, forfeitBy) {
    clearTimer(room);
    const names = room.allNames;
    const totals = [0, 1].map((i) => room.results.reduce((sum, r) => sum + (r[i]?.score ?? 0), 0));
    let winner;
    if (forfeitBy !== null) {
      winner = forfeitBy === 0 ? 1 : 0;
    } else if (totals[0] !== totals[1]) {
      winner = totals[0] > totals[1] ? 0 : 1;
    } else if (MULTIPLAYER.tiebreak === 'fewerSeconds') {
      const secs = [0, 1].map((i) => room.results.reduce((sum, r) => sum + r[i].seconds, 0));
      winner = secs[0] === secs[1] ? null : secs[0] < secs[1] ? 0 : 1;
    } else {
      winner = null;
    }
    room.phase = 'finished';
    broadcast(room, { type: 'matchEnd', rounds: room.results, totals, winner, forfeit: forfeitBy !== null, names });
    for (const p of room.players) p.ready = false;
    sendRoom(room);
  }

  // ------------------------------------------------------------------ connections

  function connect(send) {
    const client = { send, name: 'Player', room: null, ready: false, game: null };

    function error(message) {
      send({ type: 'error', message });
    }

    function enter(room) {
      client.room = room;
      client.ready = false;
      room.players.push(client);
      room.allNames = room.players.map((p) => p.name);
      send({ type: 'joined', code: room.code, you: room.players.indexOf(client) });
      sendRoom(room);
    }

    function leave() {
      const room = client.room;
      if (!room) return;
      const index = room.players.indexOf(client);
      const inMatch = room.phase === 'playing' || room.phase === 'between';
      if (inMatch && room.players.length === 2) {
        // Record the partial round, then award the match to the opponent.
        if (room.phase === 'playing') room.results.push(room.players.map((p) => resultFor(room, p)));
        finishMatch(room, index);
      }
      room.players.splice(index, 1);
      client.room = null;
      if (!room.players.length) {
        clearTimer(room);
        rooms.delete(room.code);
        return;
      }
      room.phase = room.phase === 'finished' || inMatch ? 'finished' : 'lobby';
      room.allNames = room.players.map((p) => p.name);
      for (const p of room.players) p.ready = false;
      sendRoom(room);
    }

    const handlers = {
      create(msg) {
        if (client.room) return error('Already in a room.');
        if (rooms.size >= MULTIPLAYER.maxRooms) return error('The server is full, try again later.');
        client.name = sanitizeName(msg.name);
        const room = {
          code: newCode(), players: [], phase: 'lobby', settings: defaultSettings(),
          round: 0, results: [], timer: null, allNames: [],
        };
        rooms.set(room.code, room);
        enter(room);
      },
      join(msg) {
        if (client.room) return error('Already in a room.');
        const room = rooms.get(normalizeCode(msg.code));
        if (!room) return error('No room with that code.');
        if (room.players.length >= 2) return error('That room is full.');
        if (room.phase === 'playing' || room.phase === 'between') return error('That match already started.');
        client.name = sanitizeName(msg.name);
        enter(room);
      },
      configure(msg) {
        const room = client.room;
        if (!room || room.players[0] !== client) return error('Only the host can change settings.');
        if (room.phase !== 'lobby' && room.phase !== 'finished') return;
        room.settings = sanitizeSettings(msg.settings, room.settings);
        for (const p of room.players) p.ready = false; // settings changed: everyone confirms again
        sendRoom(room);
      },
      ready(msg) {
        const room = client.room;
        if (!room || (room.phase !== 'lobby' && room.phase !== 'finished')) return;
        client.ready = !!msg.ready;
        if (room.players.length === 2 && room.players.every((p) => p.ready)) {
          room.allNames = room.players.map((p) => p.name);
          startMatch(room);
        } else {
          sendRoom(room);
        }
      },
      move(msg) {
        const room = client.room;
        const g = client.game;
        if (!room || room.phase !== 'playing' || !g || g.solvedAt !== null) return;
        if (now() < room.startAt || !msg.move || !MOVE_TYPES.has(msg.move.type)) return;
        // Only the host's control mode is allowed, and drops follow the host's same-row swap setting.
        const isDrop = msg.move.type === 'drop';
        const next = isDrop === (room.settings.controlMode === 'drop')
          ? applyMove(g.board, isDrop ? { ...msg.move, swap: room.settings.dropSwap } : msg.move)
          : null;
        if (!next) {
          send({ type: 'sync', board: g.board, moves: g.moves });
          return;
        }
        g.history.push(g.board);
        g.board = next;
        afterMove(room);
      },
      undo() {
        const room = client.room;
        const g = client.game;
        if (!room || room.phase !== 'playing' || !g || g.solvedAt !== null || !g.history.length) return;
        if (now() < room.startAt) return;
        g.board = g.history.pop();
        afterMove(room);
      },
      leave() {
        leave();
      },
    };

    function afterMove(room) {
      const g = client.game;
      g.moves++;
      if (evaluateBoard(g.board, room.rules).every((e) => e.solved)) g.solvedAt = now();
      broadcast(room, {
        type: 'progress', player: room.players.indexOf(client), moves: g.moves, solved: g.solvedAt !== null,
      });
      if (room.players.every((p) => p.game?.solvedAt !== null && p.game?.solvedAt !== undefined)) endRound(room);
    }

    return {
      handle(msg) {
        if (!msg || typeof msg.type !== 'string' || !Object.hasOwn(handlers, msg.type)) return;
        handlers[msg.type](msg);
      },
      close() {
        leave();
      },
    };
  }

  return { connect, rooms };
}
