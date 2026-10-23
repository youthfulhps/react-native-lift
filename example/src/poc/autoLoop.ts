import type { RefObject } from 'react';
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
  // Index this cell had at onLiftStart, until onLiftEnd.
  liftedIndex?: number;
  // Renders of another index while lifted: the overlay showed that item
  // (P3 rebind; itemKey must keep this at 0).
  shownOther: number;
};

// FlatList and FlashList share the two scroll calls the harness uses.
export type ListRef = RefObject<{
  scrollToOffset(p: { offset: number; animated?: boolean }): void;
  scrollToIndex(p: {
    index: number;
    viewPosition?: number;
    animated?: boolean;
  }): void;
} | null>;

export type MovedMode = 'momentum' | 'settled' | 'update' | 'rebind';

// Mirrors useLiftScrollLock() on the screen: true once no view is lifted.
export const lock = { scrollEnabled: true };

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

// 1 while a measurement window is open. Drives the cyan gate square that
// poc-auto.py uses to map recording frames to log cycles.
export const gate = makeMutable(0);

// One window per teleport transition (lift, then drop): P2 judges these, not
// the intended press/spring motion between them. Cycle n = windows 2n, 2n+1.
async function transition<T>(act: () => Promise<T>, after: number) {
  gate.value = 1;
  await frames(3);
  const result = await act();
  await frames(after);
  gate.value = 0;
  // Static frames after the gate so its off-frame shows no other motion.
  await frames(10);
  return result;
}

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
  list: ListRef,
  setActive: (index: number) => void,
  // false: same targets and scrolls, no lift/drop (crash triage control).
  lift = true
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

    const reason = lift ? await runCycle(cycle, target) : 'none';
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
 * Drop-after-move scenarios. While lifted the target's slot moves:
 * - momentum / settled (Step 1.2): animated scroll by `shift`, drop 4 frames
 *   in or after it stops.
 * - update (P3/P6): 2 items inserted above the target.
 * - rebind (P3): scrolled 40 rows away so the list can recycle the slot; the
 *   drop must commit immediately (target off screen) and leave nothing lifted.
 * pixel-check judges the windows (not rebind: its drop is an allowed jump);
 * this asserts the end state (content back in its cell, no remount).
 */
export async function runMovedDrop(
  list: ListRef,
  setActive: (index: number) => void,
  mode: MovedMode,
  { target, base, shift }: { target: number; base: number; shift: number },
  setExtra: (n: number) => void
): Promise<string> {
  const move = async () => {
    if (mode === 'update') {
      setExtra(2);
      await frames(60);
      return;
    }
    if (mode === 'rebind') {
      list.current?.scrollToOffset({
        offset: base + 40 * shift,
        animated: false,
      });
      await frames(30);
      return;
    }
    list.current?.scrollToOffset({ offset: base + shift, animated: true });
    // 'momentum': drop a few frames into the animated scroll.
    await frames(mode === 'momentum' ? 4 : 60);
  };
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
      press(entry.scale);
      await frames(HOLD + PRESS_FRAMES);
      if (
        !(await transition(
          () => until(entry, 'onLiftStart', () => entry.handle.current?.lift()),
          HOLD
        ))
      ) {
        reason = 'no-lift-start';
      } else {
        await springTo1(entry.scale);
        entry.shownOther = 0;
        // The window spans the move too: the lifted marker must hold still.
        const dropped = await transition(async () => {
          await move();
          // rebind: itemKey drops on the rebind itself (nothing lifted now).
          const autoDropped =
            mode === 'rebind' && entry.liftedIndex === undefined;
          return (
            autoDropped ||
            until(entry, 'onLiftEnd', () => entry.handle.current?.drop())
          );
        }, HOLD * 3);
        if (mode === 'rebind') {
          console.log(
            `REBIND cycle=${cycle} slotIndexAtDrop=${entry.index} ` +
              `shownOther=${entry.shownOther} lockReleased=${lock.scrollEnabled}`
          );
          list.current?.scrollToOffset({ offset: base, animated: false });
          await frames(HOLD * 2);
        }
        if (!dropped) {
          reason = 'no-lift-end';
        } else if (!lock.scrollEnabled) {
          reason = 'still-lifted';
        } else {
          // rebind: the list may have handed the target a different cell.
          const now = cells.get(target) ?? entry;
          const content = now.rect();
          const cell = now.cellRect();
          if (mode !== 'rebind' && mounts.get(target) !== mountsBefore) {
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
    setExtra(0);
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
    !(await transition(
      () => until(entry, 'onLiftStart', () => entry.handle.current?.lift()),
      HOLD
    ))
  ) {
    return 'no-lift-start';
  }
  await springTo1(entry.scale);
  // Quiet window so the drop's pre-commit probe frames carry no animation.
  await frames(HOLD);
  if (
    !(await transition(
      () => until(entry, 'onLiftEnd', () => entry.handle.current?.drop()),
      HOLD
    ))
  ) {
    return 'no-lift-end';
  }

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
