import type { RefObject } from 'react';
import type { FlatList } from 'react-native';
import {
  makeMutable,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { LiftHandle } from 'react-native-lift';
import { scheduleOnRN } from 'react-native-worklets';
import type { Probe, ProbeCtx } from './probe';

type Rect = { x: number; y: number; width: number; height: number };

export type CellEntry = {
  index: number;
  handle: RefObject<LiftHandle | null>;
  scale: SharedValue<number>;
  probe: Probe;
  rect: () => Rect | undefined;
  // Outer cell (list slot); equals rect()'s origin once dropped with no leftover translate.
  cellRect: () => Rect | undefined;
  layout: { width: number; height: number };
  ctx?: ProbeCtx;
  onLiftStart?: () => void;
  onLiftEnd?: () => void;
};

// Written by the cells in FlatListScreen.
export const cells = new Map<number, CellEntry>();
export const mounts = new Map<number, number>();

const CYCLES = 20;
// Covers top, an input cell, middle, post-scroll and bottom. 4 cycles each.
const TARGETS = [0, 3, 5, 61, 119];
const SCROLL_FIRST = new Set([61, 119]);
// >= the probe's 10-frame window, with slack for JS/UI frame skew.
const HOLD = 12;
// Give up waiting for a lift/drop commit after this many frames.
const TIMEOUT = 120;

// 1 while a cycle's measurement window is open. Drives the cyan gate square
// that poc-auto.py uses to map recording frames to log cycles.
export const gate = makeMutable(0);

// Pressed-state scale. Timed, not instant, so pixel-check sees smooth motion.
const press = (scale: SharedValue<number>) =>
  (scale.value = withTiming(0.95, { duration: 100 }));
const PRESS_FRAMES = 6;

export const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const tick = () => (--n <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });

// Runs `act` and resolves true once `key` fires on the entry, false on timeout.
function until(
  entry: CellEntry,
  key: 'onLiftStart' | 'onLiftEnd',
  act: () => void
) {
  const fired = new Promise<boolean>((resolve) => {
    entry[key] = () => resolve(true);
  });
  act();
  return Promise.race([fired, frames(TIMEOUT).then(() => false)]).finally(
    () => {
      entry[key] = undefined;
    }
  );
}

const springTo1 = (scale: SharedValue<number>) =>
  new Promise<void>((resolve) => {
    const done = () => resolve();
    scale.value = withSpring(1, undefined, () => {
      'worklet';
      scheduleOnRN(done);
    });
  });

const near = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) <= 1 &&
  Math.abs(a.y - b.y) <= 1 &&
  Math.abs(a.width - b.width) <= 1 &&
  Math.abs(a.height - b.height) <= 1;

export async function runAutoLoop(
  list: RefObject<FlatList<number> | null>,
  setActive: (index: number) => void
): Promise<string> {
  let failures = 0;
  list.current?.scrollToOffset({ offset: 0, animated: false });
  const perTarget = CYCLES / TARGETS.length;
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const target = TARGETS[Math.floor(cycle / perTarget)]!;
    const first = cycle % perTarget === 0;
    if (first) {
      cells
        .get(TARGETS[Math.floor(cycle / perTarget) - 1] ?? -1)
        ?.probe.setActive(false);
      setActive(target);
      if (SCROLL_FIRST.has(target)) {
        list.current?.scrollToIndex({
          index: target,
          viewPosition: 0.5,
          animated: false,
        });
      }
      // Let the scroll render and the probe ring fill.
      await frames(HOLD * 2);
      cells.get(target)?.probe.setActive(true);
      await frames(HOLD);
    }

    gate.value = 1;
    await frames(3);
    const reason = await runCycle(cycle, target);
    gate.value = 0;
    // Static frames after the gate so its off-frame shows no other motion.
    await frames(10);
    if (reason !== 'none') {
      failures++;
    }
    console.log(
      `AUTOLOOP cycle=${cycle} ok=${reason === 'none'} reason=${reason}`
    );
  }
  cells.get(TARGETS[TARGETS.length - 1]!)?.probe.setActive(false);
  console.log(`AUTOLOOP DONE cycles=${CYCLES} failures=${failures}`);
  // Back to the top so the TextInput cell is on screen for the final screenshot.
  list.current?.scrollToOffset({ offset: 0, animated: false });
  return `autoLoop ${CYCLES - failures}/${CYCLES} ok`;
}

const MOVED_CYCLES = 10;

/**
 * Step 1.2 drop-while-moved scenarios: lift, scroll the list by `shift`
 * (animated), then drop either while the scroll is still running ('momentum')
 * or after it has stopped ('settled'). The drop takes the re-measure +
 * animated path; pixel-check judges the commit frame, this asserts the end
 * state (no leftover translate, no remount).
 */
export async function runMovedDrop(
  list: RefObject<FlatList<number> | null>,
  setActive: (index: number) => void,
  mode: 'momentum' | 'settled',
  { target, base, shift }: { target: number; base: number; shift: number }
): Promise<string> {
  let failures = 0;
  setActive(target);
  for (let cycle = 0; cycle < MOVED_CYCLES; cycle++) {
    list.current?.scrollToOffset({ offset: base, animated: false });
    await frames(HOLD * 2);
    const entry = cells.get(target);
    const mountsBefore = mounts.get(target);
    let reason = 'none';
    if (!entry) {
      reason = 'not-mounted';
    } else {
      gate.value = 1;
      await frames(3);
      press(entry.scale);
      await frames(HOLD + PRESS_FRAMES);
      if (
        !(await until(entry, 'onLiftStart', () => entry.handle.current?.lift()))
      ) {
        reason = 'no-lift-start';
      } else {
        await springTo1(entry.scale);
        list.current?.scrollToOffset({ offset: base + shift, animated: true });
        // 'momentum': drop a few frames into the animated scroll.
        await frames(mode === 'momentum' ? 4 : 60);
        if (
          !(await until(entry, 'onLiftEnd', () => entry.handle.current?.drop()))
        ) {
          reason = 'no-lift-end';
        } else {
          await frames(HOLD * 3);
          const content = entry.rect();
          const cell = entry.cellRect();
          if (mounts.get(target) !== mountsBefore) {
            reason = 'remounted';
          } else if (
            !content ||
            !cell ||
            Math.abs(content.x - cell.x) > 1 ||
            Math.abs(content.y - cell.y) > 1
          ) {
            reason = `offset(${JSON.stringify(content)} vs cell ${JSON.stringify(cell)})`;
          }
        }
      }
    }
    gate.value = 0;
    // Static frames after the gate so its off-frame shows no other motion.
    await frames(10);
    if (reason !== 'none') {
      failures++;
    }
    console.log(
      `MOVED mode=${mode} cycle=${cycle} ok=${reason === 'none'} reason=${reason}`
    );
  }
  console.log(
    `MOVED DONE mode=${mode} cycles=${MOVED_CYCLES} failures=${failures}`
  );
  list.current?.scrollToOffset({ offset: 0, animated: false });
  return `moved-${mode} ${MOVED_CYCLES - failures}/${MOVED_CYCLES} ok`;
}

async function runCycle(cycle: number, target: number): Promise<string> {
  const entry = cells.get(target);
  const before = entry?.rect();
  const mountsBefore = mounts.get(target);
  if (!entry || !before) {
    return 'not-mounted';
  }
  entry.ctx = {
    cycle,
    origin: { x: before.x, y: before.y },
    layout: entry.layout,
  };

  press(entry.scale);
  // Longer than the probe's 10-frame pre-window, so it only sees the scaled pose.
  await frames(HOLD + PRESS_FRAMES);
  if (
    !(await until(entry, 'onLiftStart', () => entry.handle.current?.lift()))
  ) {
    return 'no-lift-start';
  }
  await frames(HOLD);
  await springTo1(entry.scale);
  // Quiet window so the drop's pre-commit probe frames carry no animation.
  await frames(HOLD);
  if (!(await until(entry, 'onLiftEnd', () => entry.handle.current?.drop()))) {
    return 'no-lift-end';
  }
  await frames(HOLD);

  const after = entry.rect();
  if (cells.get(target) !== entry || entry.index !== target) {
    return 'index-changed';
  }
  if (mounts.get(target) !== mountsBefore) {
    return 'remounted';
  }
  if (!after || !near(before, after)) {
    return `rect-moved(${JSON.stringify(before)}->${JSON.stringify(after)})`;
  }
  return 'none';
}
