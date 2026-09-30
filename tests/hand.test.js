import { test } from 'node:test';
import assert from 'node:assert/strict';
import { counts34, parseTiles } from '../js/core/tiles.js';
import { decompose, isChiitoi, isKokushi, shanten, regularShanten } from '../js/core/hand.js';

const c = (s) => counts34(parseTiles(s));

test('decompose finds all standard splits', () => {
  assert.equal(decompose(c('123m456p789s11z222z'), 4).length, 1);
  // 111222333m: three pons or three chis
  assert.equal(decompose(c('111222333m456p99s'), 4).length, 2);
  assert.equal(decompose(c('123m456p789s11z23z'), 4).length, 0);
  // open hand: 11 closed tiles, 3 sets needed
  assert.equal(decompose(c('406s345p99p564m'), 3).length, 1);
});

test('chiitoitsu and kokushi', () => {
  assert.ok(isChiitoi(c('1133557799m1122z')));
  assert.ok(!isChiitoi(c('1111335577m1122z')));
  assert.ok(isKokushi(c('19m19p19s1234567z1m')));
  assert.ok(!isKokushi(c('19m19p19s1234566z1m')));
});

test('shanten values', () => {
  assert.equal(shanten(c('123m456p789s11z222z')), -1);
  assert.equal(shanten(c('123m456p789s1123z5z')), 1);
  assert.equal(shanten(c('1133557799m1122z')), -1);
  assert.equal(shanten(c('19m19p19s1234567z1m')), -1);
  assert.equal(shanten(c('19m19p19s123456z5m5p')), 1); // kokushi, missing chun, no pair
  assert.equal(shanten(c('123m456p789s11z22z3z')), 0); // tenpai + 1 extra tile
  // open: 11 closed tiles + 1 open meld
  assert.equal(regularShanten(c('406s345p99p564m'), 1), -1);
  assert.equal(regularShanten(c('406s345p99p561m'), 1), 0);
});
