import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTiles } from '../js/core/tiles.js';
import { createBoard } from '../js/core/board.js';
import { evaluateHand, evaluateRow } from '../js/core/yaku.js';

const hand = (closed, melds = [], seatWind = '1z', roundWind = '1z') => evaluateHand({
  closed: parseTiles(closed),
  melds: melds.map((m) => {
    const tiles = parseTiles(m);
    return { tiles, type: new Set(tiles).size === 1 ? 'pon' : 'chi' };
  }),
  seatWind, roundWind,
});

const row = (notation, seatWind = '1z', roundWind = '1z') =>
  evaluateRow(createBoard({ rows: [notation], roundWind, seatWinds: [seatWind] }), 0);

test('reference image row 1: winning 4m completes 56m; open South pon needs a South wind', () => {
  const east = row('406s 345p 99p 56m [222z] 4m', '1z');
  assert.equal(east.status, 'noyaku');

  const south = row('406s 345p 99p 56m [222z] 4m', '2z');
  assert.equal(south.status, 'solved');
  assert.ok(south.yaku.includes('Yakuhai: Seat Wind (South)'));
});

test('reference image row 2: winning 9p completes 78p in the middle of the row', () => {
  const e = row('123s 05s 78p 123m 444m 9p');
  assert.equal(e.status, 'solved');
  assert.deepEqual(e.yaku.slice(0, 2), ['Riichi', 'Menzen Tsumo']);
});

test('ordering rules', () => {
  // Descending or scrambled sequences don't count.
  assert.equal(row('123s 05s 87p 123m 444m 9p').status, 'reorder');
  assert.equal(row('213s 05s 78p 123m 444m 9p').status, 'reorder');
  // Triplets in any order, red five included.
  assert.equal(row('123s 234p 505p 123m 4m 4m').status, 'solved');
  // Pair must be adjacent.
  assert.equal(row('123s 5p 234p 5p 123m 99m 9m').status, 'reorder');
  // Wait kinds: kanchan, penchan, shanpon, tanki.
  assert.equal(row('123s 55p 79p 123m 444m 8p').status, 'solved');
  assert.equal(row('123s 55p 12p 123m 444m 3p').status, 'solved');
  assert.equal(row('123s 55p 789p 123m 44m 4m').status, 'solved');
  assert.equal(row('123s 5p 789p 123m 444m 5p').status, 'solved');
  // A stray 9p in the playfield doesn't complete 78p; only the winning tile does.
  assert.equal(row('123s 05s 9p 78p 123m 444m').status, 'reorder');
  // Chains split runs: a sequence can't span across a chain.
  assert.equal(row('12s [222z] 3s 55p 123m 44m 4m', '2z').status, 'reorder');
});

test('hand points (tsumo)', () => {
  // Reference row 2 as dealer: riichi, tsumo, aka dora = 3 han 30 fu -> 2000 all = 6000
  const r2 = row('123s 05s 78p 123m 444m 9p', '1z');
  assert.deepEqual([r2.han, r2.fu, r2.points], [3, 30, 6000]);
  // Reference row 1, South seat: yakuhai + aka = 2 han 30 fu -> 500/1000 = 2000
  const r1 = row('406s 345p 99p 56m [222z] 4m', '2z');
  assert.deepEqual([r1.han, r1.fu, r1.points], [2, 30, 2000]);
  // Pinfu tsumo: riichi, tsumo, pinfu = 3 han 20 fu -> 700/1300 = 2700
  const pinfu = row('123m 456p 789s 55m 23s 4s', '2z');
  assert.ok(pinfu.yaku.includes('Pinfu'));
  assert.deepEqual([pinfu.han, pinfu.fu, pinfu.points], [3, 20, 2700]);
  // Kanchan wait breaks pinfu
  assert.ok(!row('123m 456p 789s 55m 24s 3s', '2z').yaku.includes('Pinfu'));
  // Open chinitsu + ittsu = 6 han haneman -> 3000/6000 = 12000
  const hane = row('123m 789m 99m 11m [456m] 1m', '2z');
  assert.deepEqual([hane.han, hane.points, hane.limit], [6, 12000, 'Haneman']);
});

test('valid groups are reported for boxes', () => {
  const e = row('123s 55p 87p 123m 444m 9p');
  assert.equal(e.status, 'reorder');
  assert.deepEqual(e.groups.map((g) => `${g.type}@${g.col}`), ['chi@0', 'pair@3', 'chi@7', 'pon@10']);
  const won = row('123s 05s 78p 123m 444m 9p');
  assert.ok(won.groups.some((g) => g.wait === 'ryanmen' && g.col === 5 && g.len === 2));
  assert.deepEqual(won.waits, [{ col: 5, len: 2 }]);
});

test('tiles the winning tile would complete are found', () => {
  // win 4m: 56m (cols 0-1) ryanmen, 35m (cols 3-4) kanchan, lone 4m (col 6); 9p 1s unrelated
  const e = row('56m 9p 35m 1s 4m 123456z 4m');
  assert.deepEqual(e.waits, [{ col: 0, len: 2 }, { col: 3, len: 2 }, { col: 6, len: 1 }]);
  // an adjacent pair of the winning tile is one box (shanpon), not two singles
  assert.deepEqual(row('44m 123456789p 11s 4m').waits, [{ col: 0, len: 2 }]);
  // not across a chain, and not descending
  assert.deepEqual(row('5m [111z] 6m 65m 9999p 11s 4m').waits, []);
});

test('chiitoitsu needs adjacent pairs; kokushi any order', () => {
  assert.equal(row('11m 33m 55m 77m 99m 11z 2z 2z').status, 'solved');
  assert.equal(row('1m 33m 1m 55m 77m 99m 11z 2z 2z').status, 'reorder');
  assert.equal(row('9m1m 19p 9s1s 7654321z 1m').status, 'solved');
});

test('open yaku', () => {
  assert.ok(hand('234m567p22s456s', ['678m']).yaku.includes('Tanyao'));
  assert.ok(hand('123m789m11z999m', ['456m']).yaku.includes('Honitsu'));
  assert.ok(hand('123m789m99m111m', ['456m']).yaku.includes('Chinitsu'));
  assert.ok(hand('123m789m99m111m', ['456m']).yaku.includes('Ittsu'));
  assert.ok(hand('123m123p11z999s', ['123s']).yaku.includes('Sanshoku Doujun'));
  assert.ok(hand('111m999p11z999s', ['777z']).yaku.includes('Toitoi'));
  assert.ok(hand('123m789p11z999s', ['777z']).yaku.includes('Chanta'));
  assert.ok(hand('123m789p11m999s', ['789s']).yaku.includes('Junchan'));
  assert.ok(hand('555z666z77z123m', ['789p']).yaku.includes('Shousangen'));
  assert.deepEqual(hand('555z666z22z777z', ['111z']).yaku, ['Daisangen', 'Tsuuiisou']);
  assert.equal(hand('123m456p789s11z', ['345s']).hasYaku, false);
});

test('closed extras: chiitoitsu, iipeikou, kokushi', () => {
  assert.ok(hand('1133557799m1122z').yaku.includes('Chiitoitsu'));
  assert.ok(hand('112233m456p789s11z').yaku.includes('Iipeikou'));
  assert.ok(hand('19m19p19s1234567z1m').yaku.includes('Kokushi Musou'));
});

test('incomplete hands report shanten', () => {
  const e = hand('123m456p789s1123z5z');
  assert.equal(e.complete, false);
  assert.equal(e.shanten, 1);
});

// ---------------------------------------------------------------------------
// Ordering rules: { order: 'strict' | 'reverse' | 'any' }
// ---------------------------------------------------------------------------

const rowAny = (notation, seatWind = '1z', roundWind = '1z') =>
  evaluateRow(createBoard({ rows: [notation], roundWind, seatWinds: [seatWind] }), 0, { order: 'any' });
const rowRev = (notation, seatWind = '1z', roundWind = '1z') =>
  evaluateRow(createBoard({ rows: [notation], roundWind, seatWinds: [seatWind] }), 0, { order: 'reverse' });

test('reverse rule: descending sequences and waits count, jumbled ones do not', () => {
  assert.equal(row('321s 05s 78p 321m 444m 9p').status, 'reorder');
  const rev = rowRev('321s 05s 78p 321m 444m 9p');
  assert.equal(rev.status, 'solved');
  assert.equal(rev.points, row('123s 05s 78p 123m 444m 9p').points);
  assert.equal(rowRev('123s 05s 87p 123m 444m 9p').status, 'solved');   // descending wait 8-7 + 9
  assert.equal(rowRev('123s 05s 97p 123m 444m 8p').status, 'solved');   // descending kanchan 9_7
  assert.equal(rowRev('213s 05s 78p 123m 444m 9p').status, 'reorder');  // 2-1-3 is neither
  // The descending 8-7 wait is the group the winning 9p completes (boxed at cols 5-6)
  assert.ok(rowRev('123s 55p 87p 123m 444m 9p').groups.some((g) => g.col === 5 && g.len === 2 && g.wait));
});

test('any-order rule: a shuffled winning row wins with the same value', () => {
  const sorted = row('123s 05s 78p 123m 444m 9p');
  const shuffled = '4m 7p 1s 2m 5s 3s 4m 0s 1m 8p 2s 3m 4m 9p';
  assert.equal(row(shuffled).status, 'reorder');
  const any = rowAny(shuffled);
  assert.equal(any.status, 'solved');
  assert.deepEqual([any.han, any.fu, any.points], [sorted.han, sorted.fu, sorted.points]);
  // Out-of-order sequences are fine too
  assert.equal(rowAny('123s 05s 87p 123m 444m 9p').status, 'solved');
});

test('any-order rule: wait type is inferred for fu (pinfu needs a ryanmen reading)', () => {
  const p = rowAny('3s 456p 55m 2s 789s 123m 4s', '2z');
  assert.ok(p.yaku.includes('Pinfu'));
  assert.deepEqual([p.han, p.fu, p.points], [3, 20, 2700]);
});

test('any-order rule: yaku and open sets still apply', () => {
  assert.equal(rowAny('406s 345p 99p 56m [222z] 4m', '1z').status, 'noyaku');
  assert.equal(rowAny('0s 4s 9p 6s 345p 9p 56m [222z] 4m', '2z').status, 'solved');
  assert.equal(rowAny('123m 456p 789s 1122z 5z').status, 'shanten');
  assert.equal(rowAny('1m 33m 55m 1m 77m 99m 11z 2z 2z').status, 'solved'); // chiitoitsu, any order
});
