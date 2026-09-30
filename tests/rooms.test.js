import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomManager } from '../server/rooms.js';
import { generatePuzzle } from '../js/core/generator.js';
import { inverseMove } from '../js/core/board.js';
import { MULTIPLAYER } from '../js/config.js';

/** Room manager with a fake clock, plus helpers to make players. */
function setup() {
  let t = 1_000_000;
  let timers = [];
  const mgr = createRoomManager({
    now: () => t,
    schedule: (fn, ms) => { const id = { fn, at: t + ms }; timers.push(id); return id; },
    cancel: (id) => { timers = timers.filter((x) => x !== id); },
  });
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x !== due);
      t = due.at;
      due.fn();
    }
    t = end;
  };
  const player = () => {
    const inbox = [];
    const client = mgr.connect((m) => inbox.push(m));
    return {
      inbox,
      send: (type, data = {}) => client.handle({ type, ...data }),
      close: () => client.close(),
      last: (type) => inbox.filter((m) => m.type === type).at(-1),
      all: (type) => inbox.filter((m) => m.type === type),
    };
  };
  return { mgr, advance, player };
}

function lobby(env, settings) {
  const host = env.player();
  const guest = env.player();
  host.send('create', { name: 'Hana' });
  guest.send('join', { code: host.last('joined').code.toLowerCase(), name: 'Gus' });
  if (settings) host.send('configure', { settings });
  return { host, guest };
}

/** Replays the inverse of the scramble for the current round: a guaranteed solve. */
function solve(p, difficulty) {
  const { seed } = p.last('roundStart');
  for (const m of [...generatePuzzle(seed, difficulty).scramble].reverse()) {
    p.send('move', { move: inverseMove(m) });
    if (p.last('progress')?.solved && p.last('progress').player === p.last('room').you) break;
  }
}

test('create, join, and host-only settings', () => {
  const env = setup();
  const { host, guest } = lobby(env);
  assert.equal(guest.last('joined').you, 1);
  assert.deepEqual(guest.last('room').players.map((p) => p.name), ['Hana', 'Gus']);

  guest.send('configure', { settings: { rounds: 5 } });
  assert.match(guest.last('error').message, /host/);
  host.send('configure', { settings: { rounds: 5, difficulty: 'hard', timeLimitSec: 99999, controlMode: 'drop' } });
  const s = guest.last('room').settings;
  assert.equal(s.rounds, 5);
  assert.equal(s.difficulty, 'hard');
  assert.equal(s.timeLimitSec, MULTIPLAYER.roundTimeLimitSec); // not an allowed option: unchanged
  assert.equal(s.controlMode, 'drop');

  const third = env.player();
  third.send('join', { code: host.last('joined').code, name: 'X' });
  assert.match(third.last('error').message, /full/);
});

test('full 1-round match: solver wins, time-out scores 0, scores hidden until the end', () => {
  const env = setup();
  const { host, guest } = lobby(env, { rounds: 1, difficulty: 'easy', timeLimitSec: 60 });
  host.send('ready', { ready: true });
  assert.equal(host.last('roundStart'), undefined);
  guest.send('ready', { ready: true });
  const rs = host.last('roundStart');
  assert.deepEqual(guest.last('roundStart'), rs);

  // Moves during the countdown are ignored.
  host.send('move', { move: { type: 'row', row: 0, dir: 'left' } });
  assert.equal(host.last('progress'), undefined);

  env.advance(MULTIPLAYER.countdownSec * 1000 + 5000);
  solve(host, 'easy');
  const prog = guest.last('progress');
  assert.equal(prog.player, 0);
  assert.equal(prog.solved, true);
  assert.equal(guest.all('progress').some((m) => 'score' in m), false);
  assert.equal(host.last('matchEnd'), undefined); // guest still playing

  env.advance(60_000);
  const end = host.last('matchEnd');
  assert.ok(end);
  assert.equal(end.winner, 0);
  assert.equal(end.forfeit, false);
  assert.deepEqual(end.names, ['Hana', 'Gus']);
  assert.equal(end.rounds.length, 1);
  assert.ok(end.rounds[0][0].score > 0 && end.rounds[0][0].solved);
  assert.equal(end.rounds[0][1].score, 0);
  assert.equal(end.rounds[0][1].solved, false);
  assert.equal(host.last('room').phase, 'finished');
});

test('multi-round match runs every round, with a break in between', () => {
  const env = setup();
  const { host, guest } = lobby(env, { rounds: 3, timeLimitSec: 60 });
  host.send('ready', { ready: true });
  guest.send('ready', { ready: true });
  for (let r = 1; r <= 3; r++) {
    assert.equal(host.last('roundStart').round, r);
    env.advance(MULTIPLAYER.countdownSec * 1000 + 1000);
    solve(host, 'easy');
    solve(guest, 'easy');
    assert.equal(host.last('roundEnd').round, r); // both solved: the round ends early
    env.advance(MULTIPLAYER.roundBreakSec * 1000);
  }
  const end = host.last('matchEnd');
  assert.equal(end.rounds.length, 3);
  assert.equal(end.totals.length, 2);
  // Different seed each round.
  assert.equal(new Set(host.all('roundStart').map((m) => m.seed)).size, 3);
});

test('illegal moves get a sync; undo counts as a move', () => {
  const env = setup();
  const { host, guest } = lobby(env, { rounds: 1 });
  host.send('ready', { ready: true });
  guest.send('ready', { ready: true });
  env.advance(MULTIPLAYER.countdownSec * 1000);
  host.send('move', { move: { type: 'row', row: 99, dir: 'left' } });
  assert.ok(host.last('sync'));
  host.send('move', { move: { type: 'row', row: 0, dir: 'left' } });
  host.send('undo');
  assert.equal(guest.last('progress').moves, 2);
});

test('leaving mid-match forfeits to the opponent', () => {
  const env = setup();
  const { host, guest } = lobby(env, { rounds: 3 });
  host.send('ready', { ready: true });
  guest.send('ready', { ready: true });
  env.advance(MULTIPLAYER.countdownSec * 1000);
  guest.close();
  const end = host.last('matchEnd');
  assert.equal(end.forfeit, true);
  assert.equal(end.winner, 0);
  assert.deepEqual(host.last('room').players.map((p) => p.name), ['Hana']);
  // The room survives for a new opponent; an empty room is deleted.
  host.send('leave');
  assert.equal(env.mgr.rooms.size, 0);
});
