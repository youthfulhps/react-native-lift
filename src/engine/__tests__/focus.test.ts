import { expect, test } from '@jest/globals';
import { focusToRestore } from '../focus';

const input = { name: 'chat input' };
const other = { name: 'search input' };
const on = { liftable: true, drop: true };

test('restores the input lift took focus from', () => {
  expect(focusToRestore(input, null, on)).toBe(input);
});

test('nothing to restore when nothing was focused', () => {
  expect(focusToRestore(null, null, on)).toBeNull();
});

// AC-E6 exceptions
test('another input has focus right after the menu action', () => {
  expect(focusToRestore(input, other, on)).toBeNull();
});

test("the menu item's restoreFocus: false (it navigates)", () => {
  expect(focusToRestore(input, null, { ...on, drop: false })).toBeNull();
});

test("the Liftable's restoreFocus: false", () => {
  expect(focusToRestore(input, null, { ...on, liftable: false })).toBeNull();
});
