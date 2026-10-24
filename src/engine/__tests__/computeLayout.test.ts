import { describe, expect, it } from '@jest/globals';
import { computeLayout, type LayoutInput, type Rect } from '../computeLayout';

const screen = { width: 400, height: 800 };
const safeArea = { top: 50, bottom: 30, left: 0, right: 0 };
const menuSize = { width: 200, height: 150 };
const accessorySize = { width: 250, height: 40 };
const gap = 8;

const layout = (input: Pick<LayoutInput, 'viewRect'> & Partial<LayoutInput>) =>
  computeLayout({ menuSize, safeArea, screen, gap, ...input });

const expectInsideSafe = (rect: Rect | undefined) => {
  if (!rect) throw new Error('rect missing');
  expect(rect.x).toBeGreaterThanOrEqual(safeArea.left);
  expect(rect.y).toBeGreaterThanOrEqual(safeArea.top);
  expect(rect.x + rect.width).toBeLessThanOrEqual(
    screen.width - safeArea.right
  );
  expect(rect.y + rect.height).toBeLessThanOrEqual(
    screen.height - safeArea.bottom
  );
};

describe('computeLayout', () => {
  it('top edge item: menu below, view shifted down only as needed', () => {
    const viewRect = { x: 20, y: 50, width: 360, height: 100 };
    const r = layout({ viewRect, accessorySize });

    expect(r.scale).toBe(1);
    // Only enough to fit the top accessory above the view.
    expect(r.viewRect.y).toBe(safeArea.top + accessorySize.height + gap);
    expect(r.menuRect.y).toBe(r.viewRect.y + r.viewRect.height + gap);
    expectInsideSafe(r.menuRect);
    expectInsideSafe(r.accessoryRect);
  });

  it('bottom edge item: menu flips above the view', () => {
    const viewRect = { x: 300, y: 660, width: 100, height: 100 };
    const r = layout({ viewRect });

    expect(r.viewRect).toEqual(viewRect);
    expect(r.menuRect.y + r.menuRect.height + gap).toBe(r.viewRect.y);
    expectInsideSafe(r.menuRect);
  });

  it('big view: scaled down between minScale and 1', () => {
    const viewRect = { x: 20, y: 100, width: 360, height: 600 };
    const r = layout({ viewRect });

    expect(r.scale).toBeGreaterThan(0.5);
    expect(r.scale).toBeLessThan(1);
    expect(r.clip).toBeUndefined();
    expect(r.viewRect.width).toBeCloseTo(360 * r.scale);
    expectInsideSafe(r.menuRect);
  });

  it('huge view: minScale reached, clipped opposite the menu', () => {
    const viewRect = { x: 20, y: 0, width: 360, height: 2000 };
    const r = layout({ viewRect, accessorySize });

    expect(r.scale).toBe(0.5);
    expect(r.menuRect.y).toBeLessThan(r.viewRect.y);
    expect(r.clip?.side).toBe('bottom');
    const visibleBottom =
      r.viewRect.y + r.viewRect.height - (r.clip?.amount ?? 0);
    expect(visibleBottom).toBe(screen.height - safeArea.bottom);
    expectInsideSafe(r.menuRect);
    expectInsideSafe(r.accessoryRect);
  });

  it('huge view scrolled up: menu below, clipped on top', () => {
    const viewRect = { x: 20, y: -1500, width: 360, height: 2000 };
    const r = layout({ viewRect });

    expect(r.scale).toBe(0.5);
    expect(r.menuRect.y).toBeGreaterThan(r.viewRect.y);
    expect(r.clip?.side).toBe('top');
    expect(r.viewRect.y + (r.clip?.amount ?? 0)).toBe(safeArea.top);
    expectInsideSafe(r.menuRect);
  });

  it('accessory top: accessory sits above the view', () => {
    const viewRect = { x: 20, y: 300, width: 360, height: 100 };
    const r = layout({ viewRect, accessorySize, accessoryPosition: 'top' });
    const acc = r.accessoryRect!;

    expect(acc.y + acc.height + gap).toBe(r.viewRect.y);
    expect(r.menuRect.y).toBeGreaterThan(r.viewRect.y);
    expectInsideSafe(r.menuRect);
    expectInsideSafe(acc);
  });

  it('accessory bottom with menu below: view < accessory < menu, no overlap', () => {
    const viewRect = { x: 20, y: 200, width: 360, height: 100 };
    const r = layout({ viewRect, accessorySize, accessoryPosition: 'bottom' });
    const acc = r.accessoryRect!;

    expect(r.viewRect.y + r.viewRect.height).toBeLessThanOrEqual(acc.y);
    expect(acc.y + acc.height).toBeLessThanOrEqual(r.menuRect.y);
    expectInsideSafe(r.menuRect);
    expectInsideSafe(acc);
  });

  it('mid-screen small view: no shift, scale 1, no clip', () => {
    const viewRect = { x: 100, y: 300, width: 200, height: 80 };
    const r = layout({ viewRect });

    expect(r.viewRect).toEqual(viewRect);
    expect(r.scale).toBe(1);
    expect(r.clip).toBeUndefined();
    expectInsideSafe(r.menuRect);
  });
});
