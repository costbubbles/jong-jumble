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

test('reference image row 1: open South pon needs a South wind', () => {
  const b = createBoard({ rows: ['406s 345p 99p 564m [222z]'], roundWind: '1z', seatWinds: ['1z'] });
  const eastSeat = evaluateRow(b, 0);
  assert.equal(eastSeat.complete, true);
  assert.equal(eastSeat.hasYaku, false);
  assert.equal(eastSeat.solved, false);

  const southSeat = evaluateRow({ ...b, seatWinds: ['2z'] }, 0);
  assert.equal(southSeat.solved, true);
  assert.ok(southSeat.yaku.includes('Yakuhai: Seat Wind (South)'));
});

test('reference image row 2: closed hand is valid via riichi', () => {
  const b = createBoard({ rows: ['123s05s78p123444m9p'] });
  const e = evaluateRow(b, 0);
  assert.equal(e.solved, true);
  assert.deepEqual(e.yaku.slice(0, 2), ['Riichi', 'Menzen Tsumo']);
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
