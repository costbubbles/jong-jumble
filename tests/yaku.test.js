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

test('reference image row 1: drawn 4m completes 56m; open South pon needs a South wind', () => {
  const east = row('406s 345p 99p 56m 4m [222z]', '1z');
  assert.equal(east.status, 'noyaku');
  assert.equal(east.drawnCol, 10);

  const south = row('406s 345p 99p 56m 4m [222z]', '2z');
  assert.equal(south.status, 'solved');
  assert.ok(south.yaku.includes('Yakuhai: Seat Wind (South)'));
});

test('reference image row 2: drawn 9p completes 78p in the middle of the row', () => {
  const e = row('123s 05s 78p 123m 444m 9p');
  assert.equal(e.status, 'solved');
  assert.equal(e.drawnCol, 13);
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
  // Only the last loose tile is the drawn tile; a stray 9p elsewhere doesn't complete 78p.
  assert.equal(row('123s 05s 9p 78p 123m 444m').status, 'reorder');
  // Chains split runs: a sequence can't span across a chain.
  assert.equal(row('12s [222z] 3s 55p 123m 44m 4m', '2z').status, 'reorder');
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
