// 1v1 protocol pieces shared by the browser client and the server.
// Messages are JSON objects with a `type` field.
//
// Client → server
//   create    { name }                       create a room (you are the host)
//   join      { code, name }                 join a room by code
//   configure { settings }                   host only, in the lobby
//   ready     { ready }                      both ready → match starts
//   move      { move }                       a board move (see js/core/board.js)
//   undo      {}                             undo last move (counts as a move)
//   leave     {}                             leave the room (forfeits a running match)
//
// Server → client
//   joined     { code, you }                 you = your player index (0 = host)
//   room       { code, phase, settings, players: [{ name, ready }], you }
//   roundStart { round, rounds, seed, difficulty, startAt, serverNow, timeLimitSec, hints, controlMode, requireOrder }
//   progress   { player, moves, solved }     either player's progress (no scores)
//   sync       { board, moves }              your board as the server has it (after a rejected move)
//   roundEnd   { round }
//   matchEnd   { rounds: [[result, result]], totals, winner, forfeit, names }
//              result = { solved, moves, seconds, points, score }; winner = index or null (draw)
//   error      { message }

import { MULTIPLAYER, DIFFICULTIES, DEFAULT_DIFFICULTY } from '../config.js';

export const PHASES = ['lobby', 'playing', 'between', 'finished'];

export function sanitizeName(name) {
  const clean = String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MULTIPLAYER.maxNameLength);
  return clean || 'Player';
}

export const normalizeCode = (code) => String(code ?? '').trim().toUpperCase();

export function defaultSettings() {
  return {
    difficulty: DEFAULT_DIFFICULTY,
    seed: '',
    rounds: MULTIPLAYER.rounds,
    timeLimitSec: MULTIPLAYER.roundTimeLimitSec,
    hints: MULTIPLAYER.hints,
    controlMode: MULTIPLAYER.controlMode,
    requireOrder: MULTIPLAYER.requireOrder,
  };
}

/** Clamp anything the host sends to the allowed choices. */
export function sanitizeSettings(input = {}, current = defaultSettings()) {
  const s = { ...current };
  if (DIFFICULTIES[input.difficulty]) s.difficulty = input.difficulty;
  if (typeof input.seed === 'string') s.seed = input.seed.trim().slice(0, 32);
  if (MULTIPLAYER.roundOptions.includes(Number(input.rounds))) s.rounds = Number(input.rounds);
  if (MULTIPLAYER.timeLimitOptions.includes(Number(input.timeLimitSec))) s.timeLimitSec = Number(input.timeLimitSec);
  if (typeof input.hints === 'boolean') s.hints = input.hints;
  if (input.controlMode === 'shift' || input.controlMode === 'drop') s.controlMode = input.controlMode;
  if (typeof input.requireOrder === 'boolean') s.requireOrder = input.requireOrder;
  return s;
}
