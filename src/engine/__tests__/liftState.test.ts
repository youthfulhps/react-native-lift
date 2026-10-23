import { describe, expect, test } from '@jest/globals';
import {
  IDLE,
  owns,
  transition,
  type LiftEvent,
  type LiftState,
} from '../liftState';

const A = 'a';
const B = 'b';
type S = LiftState<string>;
const at = (phase: 'measuring' | 'lifted' | 'dropping', slot = A): S => ({
  phase,
  slot,
});

// [from, event, to]
const table: [S, LiftEvent<string>, S][] = [
  [IDLE, { type: 'lift', slot: A }, at('measuring')],
  [IDLE, { type: 'committed', slot: A }, IDLE],
  [IDLE, { type: 'cancel', slot: A }, IDLE],
  [IDLE, { type: 'drop', slot: A }, IDLE],
  [IDLE, { type: 'dropped', slot: A }, IDLE],

  [at('measuring'), { type: 'lift', slot: A }, at('measuring')],
  [at('measuring'), { type: 'committed', slot: A }, at('lifted')],
  [at('measuring'), { type: 'cancel', slot: A }, IDLE],
  [at('measuring'), { type: 'drop', slot: A }, IDLE],
  [at('measuring'), { type: 'dropped', slot: A }, IDLE],

  [at('lifted'), { type: 'lift', slot: A }, at('lifted')],
  [at('lifted'), { type: 'committed', slot: A }, at('lifted')],
  [at('lifted'), { type: 'cancel', slot: A }, at('lifted')],
  [at('lifted'), { type: 'drop', slot: A }, at('dropping')],
  [at('lifted'), { type: 'dropped', slot: A }, IDLE],

  // Lifting again mid-drop cancels the drop.
  [at('dropping'), { type: 'lift', slot: A }, at('lifted')],
  [at('dropping'), { type: 'drop', slot: A }, at('dropping')],
  [at('dropping'), { type: 'cancel', slot: A }, at('dropping')],
  [at('dropping'), { type: 'dropped', slot: A }, IDLE],
];

test.each(table)('%j + %j -> %j', (from, event, to) => {
  expect(transition(from, event)).toEqual(to);
});

describe('another slot', () => {
  // The host layer is shared: a second view lifted while the first one is
  // still animating its drop would move with that animation.
  test('a lift request during a drop animation is rejected', () => {
    const next = transition(at('dropping'), { type: 'lift', slot: B });
    expect(next).toEqual(at('dropping'));
    expect(owns(next, B)).toBe(false);
  });

  test.each(['measuring', 'lifted'] as const)(
    'a lift request while %s is rejected',
    (phase) => {
      expect(owns(transition(at(phase), { type: 'lift', slot: B }), B)).toBe(
        false
      );
    }
  );

  test.each(['committed', 'cancel', 'drop', 'dropped'] as const)(
    "its '%s' does not touch the owner's state",
    (type) => {
      for (const phase of ['measuring', 'lifted', 'dropping'] as const) {
        expect(transition(at(phase), { type, slot: B })).toEqual(at(phase));
      }
    }
  );

  test('can lift once the owner has dropped', () => {
    const s = transition(at('dropping'), { type: 'dropped', slot: A });
    expect(owns(transition(s, { type: 'lift', slot: B }), B)).toBe(true);
  });
});
