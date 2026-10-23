import { expect, test } from '@jest/globals';
import { defaultMotion, mergeMotion } from '../motion';

test('no override: the defaults', () => {
  expect(mergeMotion()).toBe(defaultMotion);
});

test('a partial override keeps every other value', () => {
  const m = mergeMotion({ press: { scale: 0.9 }, backdrop: { opacity: 0.4 } });
  expect(m.press).toEqual({
    scale: 0.9,
    duration: defaultMotion.press.duration,
  });
  expect(m.backdrop).toEqual({
    opacity: 0.4,
    duration: defaultMotion.backdrop.duration,
  });
  expect(m.release).toBe(defaultMotion.release);
  expect(m.drop).toEqual(defaultMotion.drop);
});

test('a spring override replaces the spring whole (physics vs duration)', () => {
  const spring = { duration: 400, dampingRatio: 0.8 };
  expect(mergeMotion({ release: spring }).release).toBe(spring);
});

test('the defaults are not mutated', () => {
  mergeMotion({ drop: { duration: 100 } });
  expect(defaultMotion.drop).toEqual({ duration: 300 });
});
