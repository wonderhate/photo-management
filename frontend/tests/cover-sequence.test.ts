import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coverSequence} from '../src/core/cover-sequence.ts';

test('every library photo appears once per cycle, including photos beyond a page of results', () => {
  const ids = Array.from({length: 537}, (_, i) => `photo-${i}`);
  const next = coverSequence(ids);
  let last: string | undefined;
  for (let cycle = 0; cycle < 3; cycle++) {
    const seen = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
      const id = next()!; assert.notEqual(id, last); assert.ok(!seen.has(id)); seen.add(id); last = id;
    }
    assert.deepEqual(seen, new Set(ids));
  }
});

test('cycle boundaries avoid the current cover even with deterministic edge shuffles', () => {
  for (const random of [() => 0, () => .99999]) {
    const next = coverSequence(['a', 'b'], 'a', random);
    assert.deepEqual(Array.from({length: 6}, () => next()), ['b', 'a', 'b', 'a', 'b', 'a']);
  }
});

test('unavailable previews are skipped, and an entirely unavailable library terminates', () => {
  const next = coverSequence(['a', 'b', 'c']);
  const failed = new Set([next()!]);
  for (let i = 0; i < 6; i++) assert.ok(!failed.has(next(failed)!));
  failed.add('a'); failed.add('b'); failed.add('c');
  assert.equal(next(failed), undefined);
});

test('empty and single-photo libraries are safe and the input is not mutated', () => {
  assert.equal(coverSequence([])(), undefined);
  const ids = ['only', 'only']; const next = coverSequence(ids);
  assert.equal(next(), 'only'); assert.equal(next(), 'only');
  assert.deepEqual(ids, ['only', 'only']);
});

test('a failed last candidate cannot repeat the still-visible cover across cycles', () => {
  const next = coverSequence(['bad', 'a', 'b'], '', () => .99999);
  assert.equal(next(), 'b'); assert.equal(next(), 'a'); assert.equal(next(), 'bad');
  assert.equal(next(new Set(['bad']), 'a'), 'b');
});
