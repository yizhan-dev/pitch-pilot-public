// Logical-address and data-reference regressions; no dataset or browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as paths from '../src/data/paths.ts';

test('new clip addresses and old bookmarks resolve to the same file', () => {
  for (const address of ['shot-15-53', 'pel-wil/shot-15-53', 'clips/pel-wil/shot-15-53', 'clips/legacy-match/shot-15-53.json']) {
    assert.deepEqual(paths.parseClip(address), { match: 'pel-wil', id: 'shot-15-53' });
    assert.equal(paths.clipFile(address), '/data/matches/pel-wil/clips/shot-15-53.json');
  }
  assert.equal(paths.clipFile('another/shot-15-53', '.space.bin'), '/data/matches/another/clips/shot-15-53.space.bin');
});

test('relative and historical match references share one resolver', () => {
  for (const reference of ['narration/en/shot-15-53/p1.mp3', 'clips/pel-wil/narration/en/shot-15-53/p1.mp3', '/data/clips/legacy-match/narration/en/shot-15-53/p1.mp3', '/pitch-pilot/data/matches/pel-wil/narration/en/shot-15-53/p1.mp3']) {
    assert.equal(paths.inMatch(reference), '/data/matches/pel-wil/narration/en/shot-15-53/p1.mp3');
  }
  assert.equal(paths.inMatch('clips/shot-15-53.joints.bin'), '/data/matches/pel-wil/clips/shot-15-53.joints.bin');
});

test('clips, models and motions resolve under their folders', () => {
  assert.equal(paths.clipFile('shot-15-53.json'), '/data/matches/pel-wil/clips/shot-15-53.json');
  assert.equal(paths.modelFile('response/model.bin'), '/data/models/response/model.bin');
  assert.equal(paths.animFile('running'), '/data/anim/running.json');
  assert.equal(paths.assetFile('loading/drone.jpg'), '/data/assets/loading/drone.jpg');
});

test('user addresses cannot traverse paths or request another origin', () => {
  for (const address of ['../secret', 'pel-wil/../secret', 'https://example.com/data', 'pel-wil/shot?query', 'pel-wil/shot\\secret']) {
    assert.throws(() => paths.parseClip(address));
  }
  for (const value of ['../secret', '/secret', 'narration/../secret']) assert.throws(() => paths.inMatch(value));
});
