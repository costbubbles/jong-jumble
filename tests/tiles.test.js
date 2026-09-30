import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseTiles, tilesToString, toIndex34, fromIndex34, normalize, sortTiles, TILE_IMAGES, ALL_TILES_34,
} from '../js/core/tiles.js';

test('parseTiles / tilesToString round-trip', () => {
  const tiles = parseTiles('123m 406p 77z');
  assert.deepEqual(tiles, ['1m', '2m', '3m', '4p', '0p', '6p', '7z', '7z']);
  assert.equal(tilesToString(tiles), '123m406p77z');
  assert.throws(() => parseTiles('8z'));
  assert.throws(() => parseTiles('12x'));
});

test('index34 mapping and red fives', () => {
  assert.equal(toIndex34('1m'), 0);
  assert.equal(toIndex34('9s'), 26);
  assert.equal(toIndex34('7z'), 33);
  assert.equal(toIndex34('0p'), toIndex34('5p'));
  assert.equal(normalize('0s'), '5s');
  for (let i = 0; i < 34; i++) assert.equal(toIndex34(fromIndex34(i)), i);
  assert.deepEqual(sortTiles(['5m', '1z', '0m', '1m']), ['1m', '5m', '0m', '1z']);
});

test('every tile has a sprite on disk', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const ids = [...ALL_TILES_34, '0m', '0p', '0s'];
  for (const id of ids) {
    assert.ok(TILE_IMAGES[id], `no sprite mapping for ${id}`);
    assert.ok(existsSync(root + TILE_IMAGES[id]), `missing file ${TILE_IMAGES[id]} for ${id}`);
  }
  // Suit letters differ between notation and filenames.
  assert.equal(TILE_IMAGES['1p'], 'sprites/1s.png');
  assert.equal(TILE_IMAGES['1s'], 'sprites/1b.png');
  assert.equal(TILE_IMAGES['0p'], 'sprites/5rs.png');
});
