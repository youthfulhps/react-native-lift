import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import {
  AppState,
  Dimensions,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { computeLayout } from '../engine/computeLayout';
import { LiftProvider } from '../LiftProvider';
import { Liftable, type LiftableProps } from '../Liftable';
import type { LiftHandle } from '../types';

// Just enough Reanimated for Liftable, LiftHost and DimBackdrop: shared
// values are plain boxes, animations land at once (finish callbacks run) and
// are recorded with their config. The real packages need the UI runtime.
const mockAnimations: { kind: string; to: number; config: unknown }[] = [];
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const animate =
    (kind: string) =>
    (to: number, config?: unknown, done?: (finished: boolean) => void) => {
      mockAnimations.push({ kind, to, config });
      // Like the real one: the finish callback comes later, not inside the
      // call (the caller assigns the value first).
      if (done) {
        setTimeout(() => done(true), 0);
      }
      return to;
    };
  return {
    __esModule: true,
    default: { View: RN.View },
    // Stable across renders, like the real one (effects depend on it).
    useSharedValue: (value: unknown) =>
      require('react').useRef({ value }).current,
    useAnimatedStyle: (style: () => object) => style(),
    withTiming: animate('timing'),
    withSpring: animate('spring'),
  };
});
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
    fn(...args),
}));

// Each Liftable's gesture config, in mount order.
const mockGestures: { onLift: () => void; press: unknown; release: unknown }[] =
  [];
jest.mock('../engine/useLiftGesture', () => ({
  useLiftGesture: (config: never) => {
    const index = require('react').useRef(-1);
    if (index.current < 0) {
      index.current = mockGestures.length;
    }
    mockGestures[index.current] = config;
    return {};
  },
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: unknown }) => children,
}));
jest.mock('react-native-teleport', () => ({
  Portal: ({ children }: { children: unknown }) => children,
  PortalHost: () => null,
  PortalProvider: ({ children }: { children: unknown }) => children,
}));
// No layout in jest: every view sits at a fixed on-screen rect.
jest.mock('../engine/measure', () => ({
  windowRect: () => ({ x: 0, y: 100, width: 300, height: 60 }),
  isUsable: () => mockUsable,
}));
let mockUsable = true;
// The real computeLayout, watched (AC-U3: what the chrome passes it).
jest.mock('../engine/computeLayout', () => {
  const actual = jest.requireActual<typeof import('../engine/computeLayout')>(
    '../engine/computeLayout'
  );
  return { ...actual, computeLayout: jest.fn(actual.computeLayout) };
});

const layout = {
  nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 60 } },
};

// content -> inner -> clip -> container -> wrapper (the Portal mock adds no
// node).
const wrapperOf = (n = 0) =>
  screen.getAllByTestId('content')[n]!.parent!.parent!.parent!.parent!;

// The long press activates on laid-out view `n`.
async function longPress(n = 0) {
  await fireEvent(wrapperOf(n), 'layout', layout);
  await act(() => mockGestures[n]!.onLift());
}

type RowProps = Omit<LiftableProps, 'children'>;

function Row(props: RowProps) {
  return (
    <Liftable {...props}>
      <View testID="content">
        <Text>row</Text>
      </View>
    </Liftable>
  );
}

const app = (props: RowProps = {}) => (
  <LiftProvider>
    <Row {...props} />
  </LiftProvider>
);

// Shows `visible` and counts mounts (a remount would restart a fade).
let mounts = 0;
// System event handlers useSystemDrop subscribed (rotation, AppState).
const mockSystem: {
  dimensions?: () => void;
  appState?: (state: string) => void;
} = {};
function Probe({ visible }: { visible: boolean }) {
  useEffect(() => {
    mounts++;
  }, []);
  return <Text testID="custom-backdrop">{`visible:${visible}`}</Text>;
}

beforeEach(() => {
  mockUsable = true;
  mockGestures.length = 0;
  mockAnimations.length = 0;
  mounts = 0;
  (computeLayout as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('haptics is called once when the long press lifts the view', async () => {
  const haptics = jest.fn();
  await render(app({ haptics }));
  await longPress();
  expect(haptics).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('lift-backdrop')).toBeTruthy();
});

test('a repeat activation on the lifted view calls no haptics', async () => {
  const haptics = jest.fn();
  await render(app({ haptics }));
  await longPress();
  await act(() => mockGestures[0]!.onLift());
  expect(haptics).toHaveBeenCalledTimes(1);
});

test('no haptics adapter: lifting does not throw', async () => {
  await render(app());
  await expect(longPress()).resolves.toBeUndefined();
  expect(screen.getByTestId('lift-backdrop')).toBeTruthy();
});

test('a rejected lift (another view is lifted) calls no haptics', async () => {
  const first = jest.fn();
  const second = jest.fn();
  await render(
    <LiftProvider>
      <Row haptics={first} />
      <Row haptics={second} />
    </LiftProvider>
  );
  await longPress(0);
  await longPress(1);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
});

test('the default backdrop is the dim, at the motion opacity', async () => {
  await render(app({ motion: { backdrop: { opacity: 0.4, duration: 120 } } }));
  await longPress();
  expect(screen.getByTestId('lift-dim')).toBeTruthy();
  expect(mockAnimations).toContainEqual({
    kind: 'timing',
    to: 0.4,
    config: { duration: 120 },
  });
});

test('renderBackdrop replaces the dim', async () => {
  await render(app({ renderBackdrop: (s) => <Probe {...s} /> }));
  await longPress();
  expect(screen.getByText('visible:true')).toBeTruthy();
  expect(screen.queryByTestId('lift-dim')).toBeNull();
});

test('motion reaches the gesture and the release spring', async () => {
  const release = { duration: 400, dampingRatio: 0.8 };
  await render(app({ motion: { press: { scale: 0.9 }, release } }));
  expect(mockGestures[0]!.press).toEqual({ scale: 0.9, duration: 150 });
  expect(mockGestures[0]!.release).toBe(release);
  await longPress();
  // Liftable springs its own press scale back to 1 once lifted.
  expect(mockAnimations).toContainEqual({
    kind: 'spring',
    to: 1,
    config: release,
  });
});

// No brightness jump on a drop: the view stays lifted (above the dim)
// until the dim has faded out, then goes back.
test('a drop commits only once the dim has faded out', async () => {
  jest.useFakeTimers();
  const ref = { current: null as LiftHandle | null };
  const onLiftEnd = jest.fn();
  await render(
    app({
      ref,
      onLiftEnd,
      renderBackdrop: (s) => <Probe {...s} />,
      motion: { backdrop: { duration: 250 } },
    })
  );
  await longPress();
  // Unmoved: nothing to animate, only the fade to wait for.
  await act(() => ref.current!.drop());
  expect(screen.getByText('visible:false')).toBeTruthy();
  await act(() => jest.advanceTimersByTime(249));
  expect(onLiftEnd).not.toHaveBeenCalled();
  expect(screen.getByText('visible:false')).toBeTruthy();
  // The fade's end, then a frame.
  await act(() => jest.advanceTimersByTime(1 + 16));
  expect(onLiftEnd).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('custom-backdrop')).toBeNull();
  expect(mounts).toBe(1);
});

// An open keyboard that hides when lift() dismisses it; returns the
// listeners lift() subscribed (keyboardWillHide, keyboardDidHide).
function openKeyboard() {
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const listeners: Record<string, (e: { duration: number }) => void> = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((
    type: string,
    fn: (e: { duration: number }) => void
  ) => {
    listeners[type] = fn;
    return { remove: () => {} };
  }) as never);
  return { dismiss, listeners };
}

// iOS: the hide animation ends `duration` ms after keyboardWillHide, then
// 3 still frames + 3 frames.
async function hideKeyboard(
  listeners: ReturnType<typeof openKeyboard>['listeners']
) {
  await act(() => listeners.keyboardWillHide!({ duration: 250 }));
  await act(() => jest.advanceTimersByTime(250 + 20 * 16));
}

// With the keyboard open the teleport waits for it to close. Haptics come
// at once; the backdrop mounts at once but shows only from the teleport, so
// the view never sits under the dim (no brightness jump), and it is not
// remounted.
test('keyboard open: haptics first, backdrop shown at the teleport', async () => {
  jest.useFakeTimers();
  const { dismiss, listeners } = openKeyboard();
  const haptics = jest.fn();
  const onLiftStart = jest.fn();
  await render(
    app({ haptics, onLiftStart, renderBackdrop: (s) => <Probe {...s} /> })
  );
  await longPress();
  expect(dismiss).toHaveBeenCalled();
  expect(haptics).toHaveBeenCalledTimes(1);
  expect(screen.getByText('visible:false')).toBeTruthy();
  expect(onLiftStart).not.toHaveBeenCalled();

  await hideKeyboard(listeners);
  expect(onLiftStart).toHaveBeenCalledTimes(1);
  expect(haptics).toHaveBeenCalledTimes(1);
  expect(screen.getByText('visible:true')).toBeTruthy();
  expect(mounts).toBe(1);
});

test('dim start: at once without a keyboard, at the teleport with one', async () => {
  const dimIn = { kind: 'timing', to: 0.25, config: { duration: 200 } };
  await render(app());
  await longPress();
  expect(mockAnimations).toContainEqual(dimIn);

  await screen.unmount();
  mockAnimations.length = 0;
  mockGestures.length = 0;
  jest.useFakeTimers();
  const { listeners } = openKeyboard();
  const onLiftStart = jest.fn();
  await render(app({ onLiftStart }));
  await longPress();
  expect(screen.getByTestId('lift-dim')).toBeTruthy();
  expect(mockAnimations).not.toContainEqual(dimIn);
  await hideKeyboard(listeners);
  expect(onLiftStart).toHaveBeenCalledTimes(1);
  expect(mockAnimations).toContainEqual(dimIn);
});

test('the default dim fades to 0 over its duration on a drop', async () => {
  jest.useFakeTimers();
  const ref = { current: null as LiftHandle | null };
  await render(app({ ref, motion: { backdrop: { duration: 180 } } }));
  await longPress();
  mockAnimations.length = 0;
  await act(() => ref.current!.drop());
  expect(screen.getByTestId('lift-dim')).toBeTruthy();
  expect(mockAnimations).toContainEqual({
    kind: 'timing',
    to: 0,
    config: { duration: 180 },
  });
});

test('a second drop() during the fade wait does not push the commit back', async () => {
  jest.useFakeTimers();
  const ref = { current: null as LiftHandle | null };
  const onLiftEnd = jest.fn();
  await render(
    app({ ref, onLiftEnd, motion: { backdrop: { duration: 200 } } })
  );
  await longPress();
  await act(() => ref.current!.drop());
  await act(() => jest.advanceTimersByTime(150));
  await act(() => ref.current!.drop());
  await act(() => jest.advanceTimersByTime(50 + 16));
  expect(onLiftEnd).toHaveBeenCalledTimes(1);
});

test('lift() and drop() in one batch: nothing renders, nothing waits', async () => {
  jest.useFakeTimers();
  const ref = { current: null as LiftHandle | null };
  const onLiftStart = jest.fn();
  await render(
    app({ ref, onLiftStart, renderBackdrop: (s) => <Probe {...s} /> })
  );
  await fireEvent(wrapperOf(), 'layout', layout);
  await act(() => {
    ref.current!.lift();
    ref.current!.drop();
  });
  expect(onLiftStart).not.toHaveBeenCalled();
  expect(screen.queryByTestId('custom-backdrop')).toBeNull();
  expect(screen.queryByTestId('lift-backdrop')).toBeNull();
});

// Drops with no animation do not wait for the fade: the view goes back
// and the backdrop goes in the same act, no timers advanced.
test.each<
  [
    string,
    (ref: LiftHandle, rerender: (props: RowProps) => Promise<void>) => unknown,
  ]
>([
  ['drop({ immediate: true })', (ref) => ref.drop({ immediate: true })],
  [
    "drop({ immediate: true }) during a drop's fade wait",
    (ref) => {
      ref.drop();
      ref.drop({ immediate: true });
    },
  ],
  ['itemKey change', (_, rerender) => rerender({ itemKey: 'b' })],
  ['rotation (window change)', () => mockSystem.dimensions!()],
  ['going to the background', () => mockSystem.appState!('background')],
  [
    'measure null / off screen',
    (ref) => {
      mockUsable = false;
      ref.drop();
    },
  ],
])('immediate drop, no fade wait: %s', async (_, run) => {
  jest.useFakeTimers();
  jest.spyOn(Dimensions, 'addEventListener').mockImplementation(((
    _type: string,
    fn: () => void
  ) => {
    mockSystem.dimensions = fn;
    return { remove: () => {} };
  }) as never);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    fn: (s: string) => void
  ) => {
    mockSystem.appState = fn;
    return { remove: () => {} };
  }) as never);
  const ref = { current: null as LiftHandle | null };
  const onLiftEnd = jest.fn();
  const props = (extra: RowProps = {}): RowProps => ({
    ref,
    onLiftEnd,
    itemKey: 'a',
    renderBackdrop: (s) => <Probe {...s} />,
    ...extra,
  });
  await render(app(props()));
  await longPress();
  expect(screen.getByText('visible:true')).toBeTruthy();
  await act(() =>
    run(ref.current!, (extra) => screen.rerender(app(props(extra))))
  );
  expect(onLiftEnd).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('custom-backdrop')).toBeNull();
  expect(screen.queryByTestId('lift-backdrop')).toBeNull();
});

test('unmounted while lifted: the backdrop goes at once', async () => {
  jest.useFakeTimers();
  const props = {
    renderBackdrop: (s: { visible: boolean }) => <Probe {...s} />,
  };
  const tree = (show: boolean) => (
    <LiftProvider>{show ? <Row {...props} /> : null}</LiftProvider>
  );
  await render(tree(true));
  await longPress();
  await screen.rerender(tree(false));
  expect(screen.queryByTestId('custom-backdrop')).toBeNull();
  expect(screen.queryByTestId('lift-backdrop')).toBeNull();
});

test('a lift that fails at once (no layout yet) leaves no backdrop', async () => {
  await render(app({ renderBackdrop: (s) => <Probe {...s} /> }));
  // No layout event: the slot rejects the lift in the same batch.
  await act(() => mockGestures[0]!.onLift());
  expect(screen.queryByTestId('custom-backdrop')).toBeNull();
  expect(screen.queryByTestId('lift-backdrop')).toBeNull();
});

// Step 3.2: menu, accessory, callbacks, accessibility.

const menuItems = (log: string[] = []) => [
  { key: 'copy', title: 'Copy', onPress: () => log.push('copy') },
  {
    key: 'delete',
    title: 'Delete',
    destructive: true,
    onPress: () => log.push('delete'),
  },
];

// The menu/accessory wrappers measure their content before they are placed.
async function placeChrome(menu = { width: 250, height: 88 }) {
  for (const [id, size] of [
    ['lift-menu', menu],
    ['lift-accessory', { width: 200, height: 40 }],
  ] as const) {
    // Hidden from screen readers until placed.
    const el = screen.queryByTestId(id, { includeHiddenElements: true });
    if (el) {
      await fireEvent(el, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, ...size } },
      });
    }
  }
}

const styleOf = (el: { props: { style?: unknown } }) =>
  StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

test('U1: the default menu lists the items, destructive in its own style', async () => {
  await render(app({ menu: menuItems() }));
  await longPress();
  await placeChrome();
  expect(screen.getByTestId('lift-menu-default')).toBeTruthy();
  expect(styleOf(screen.getByText('Delete')).color).toBe('#FF3B30');
  expect(styleOf(screen.getByText('Copy')).color).not.toBe(
    styleOf(screen.getByText('Delete')).color
  );
});

test('the menu is measured hidden, then placed and shown', async () => {
  await render(app({ menu: menuItems() }));
  await longPress();
  const hidden = screen.getByTestId('lift-menu', {
    includeHiddenElements: true,
  });
  expect(hidden.props.accessibilityElementsHidden).toBe(true);
  expect(styleOf(hidden).opacity).toBe(0);
  expect(hidden.props.pointerEvents).toBe('none');
  expect(mockAnimations.some((a) => a.to === 1 && a.kind === 'timing')).toBe(
    false
  );
  await placeChrome();
  const placed = screen.getByTestId('lift-menu');
  // Below the view (host-local 0..60) plus the gap; 8 in from the side the
  // full-width view touches (edgeMargin).
  expect(styleOf(placed)).toMatchObject({ left: 8, top: 68 });
  expect(styleOf(placed).opacity).toBeUndefined();
  // Appear fades it in.
  expect(mockAnimations.some((a) => a.to === 1 && a.kind === 'timing')).toBe(
    true
  );
});

test('no menu and no accessory: nothing to lay out', async () => {
  await render(app());
  await longPress();
  expect(screen.queryByTestId('lift-menu')).toBeNull();
  expect(screen.queryByTestId('lift-accessory')).toBeNull();
  expect(computeLayout).not.toHaveBeenCalled();
});

test('U2: renderMenu replaces the default menu; its close() drops', async () => {
  jest.useFakeTimers();
  const onLiftEnd = jest.fn();
  await render(
    app({
      menu: menuItems(),
      onLiftEnd,
      renderMenu: (items, close) => (
        <Pressable testID="custom-menu" onPress={() => close()}>
          <Text>{items.map((i) => i.title).join(',')}</Text>
        </Pressable>
      ),
    })
  );
  await longPress();
  await placeChrome();
  expect(screen.queryByTestId('lift-menu-default')).toBeNull();
  expect(screen.getByText('Copy,Delete')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('custom-menu'));
  await act(() => jest.advanceTimersByTime(200 + 16));
  expect(onLiftEnd).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('custom-menu')).toBeNull();
});

test.each(['top', 'bottom'] as const)(
  'U3: renderAccessory renders on lift; accessoryPosition %s reaches computeLayout',
  async (accessoryPosition) => {
    await render(
      app({
        menu: menuItems(),
        accessoryPosition,
        renderAccessory: () => <Text>reactions</Text>,
      })
    );
    expect(screen.queryByText('reactions')).toBeNull();
    await longPress();
    expect(
      screen.getByText('reactions', { includeHiddenElements: true })
    ).toBeTruthy();
    await placeChrome();
    expect(computeLayout).toHaveBeenCalledTimes(1);
    expect(computeLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        accessoryPosition,
        accessorySize: { width: 200, height: 40 },
        menuSize: { width: 250, height: 88 },
      })
    );
  }
);

test('U3: the default accessory position is top', async () => {
  await render(app({ renderAccessory: () => <Text>reactions</Text> }));
  await longPress();
  await placeChrome();
  const { accessoryRect, viewRect } = (computeLayout as jest.Mock).mock
    .results[0]!.value as ReturnType<typeof computeLayout>;
  expect(accessoryRect!.y + accessoryRect!.height).toBeLessThanOrEqual(
    viewRect.y
  );
});

test('U4: onLiftStart then onLiftEnd, once each', async () => {
  jest.useFakeTimers();
  const calls: string[] = [];
  const ref = { current: null as LiftHandle | null };
  await render(
    app({
      ref,
      onLiftStart: () => calls.push('start'),
      onLiftEnd: () => calls.push('end'),
    })
  );
  await longPress();
  await act(() => ref.current!.drop());
  await act(() => jest.advanceTimersByTime(200 + 16));
  expect(calls).toEqual(['start', 'end']);
});

test('U4: disabled: no long press, ref.lift() does nothing', async () => {
  const ref = { current: null as LiftHandle | null };
  const onLiftStart = jest.fn();
  await render(app({ ref, disabled: true, onLiftStart, menu: menuItems() }));
  expect((mockGestures[0] as unknown as { enabled: boolean }).enabled).toBe(
    false
  );
  await fireEvent(wrapperOf(), 'layout', layout);
  await act(() => ref.current!.lift());
  expect(onLiftStart).not.toHaveBeenCalled();
  expect(screen.queryByTestId('lift-backdrop')).toBeNull();
  // No lift alternative either.
  expect(wrapperOf().props.accessibilityActions).toBeUndefined();
});

test('E2: a menu item runs, then drops, then onLiftEnd', async () => {
  jest.useFakeTimers();
  const log: string[] = [];
  await render(app({ menu: menuItems(log), onLiftEnd: () => log.push('end') }));
  await longPress();
  await placeChrome();
  await fireEvent.press(screen.getByTestId('lift-menu-item-delete'));
  expect(log).toEqual(['delete']);
  // The menu fades out with the dim; the view goes back after.
  expect(mockAnimations.some((a) => a.to === 0 && a.kind === 'timing')).toBe(
    true
  );
  await act(() => jest.advanceTimersByTime(200 + 16));
  expect(log).toEqual(['delete', 'end']);
  expect(screen.queryByTestId('lift-menu')).toBeNull();
});

test('E6: an item with restoreFocus false skips the focus restore', async () => {
  jest.useFakeTimers();
  const input = {};
  const focus = jest
    .spyOn(TextInput.State, 'focusTextInput')
    .mockImplementation(() => {});
  const current = jest
    .spyOn(TextInput.State, 'currentlyFocusedInput')
    .mockReturnValue(input as never);
  const { listeners } = openKeyboard();
  const items = [
    { key: 'go', title: 'Go', restoreFocus: false, onPress: () => {} },
    { key: 'stay', title: 'Stay', onPress: () => {} },
  ];
  await render(app({ menu: items }));
  for (const key of ['go', 'stay']) {
    await longPress();
    current.mockReturnValue(null as never);
    await hideKeyboard(listeners);
    await placeChrome();
    await fireEvent.press(screen.getByTestId(`lift-menu-item-${key}`));
    // The commit (fade + a frame), then the restore 2 frames after it.
    await act(() => jest.advanceTimersByTime(200 + 16));
    await act(() => jest.advanceTimersByTime(2 * 16));
    current.mockReturnValue(input as never);
  }
  expect(focus).toHaveBeenCalledTimes(1);
});

test('E7: menu titles as accessibility actions, run without a lift or haptics', async () => {
  const log: string[] = [];
  const onLiftStart = jest.fn();
  const haptics = jest.fn();
  await render(app({ menu: menuItems(log), onLiftStart, haptics }));
  const wrapper = wrapperOf();
  expect(
    wrapper.props.accessibilityActions.map((a: { name: string }) => a.name)
  ).toEqual(['Copy', 'Delete']);
  await fireEvent(wrapper, 'accessibilityAction', {
    nativeEvent: { actionName: 'Delete' },
  });
  expect(log).toEqual(['delete']);
  expect(onLiftStart).not.toHaveBeenCalled();
  expect(haptics).not.toHaveBeenCalled();
  expect(screen.queryByTestId('lift-backdrop')).toBeNull();
});

test('a view too tall for the menu shrinks and is clipped, and grows back before it drops', async () => {
  jest.useFakeTimers();
  // 60dp view, menu and gap 96dp, 119dp screen less a 7dp inset: 16dp of
  // room, so it scales to the 0.5 floor (30dp) and 14dp still overflow.
  jest
    .spyOn(Dimensions, 'get')
    .mockReturnValue({ width: 300, height: 119 } as never);
  const ref = { current: null as LiftHandle | null };
  const onLiftEnd = jest.fn();
  await render(
    <LiftProvider insets={{ top: 0, bottom: 7, left: 0, right: 0 }}>
      <Row ref={ref} menu={menuItems()} onLiftEnd={onLiftEnd} />
    </LiftProvider>
  );
  // content -> inner -> clip -> container.
  const clip = () => screen.getByTestId('content').parent!.parent!;
  const inner = () => screen.getByTestId('content').parent!;
  expect(StyleSheet.flatten(clip().props.style)?.overflow).toBeUndefined();
  await longPress();
  await placeChrome();
  expect(mockAnimations.some((a) => a.to === 0.5)).toBe(true);
  // Rule 4: still too tall at 0.5, so the side opposite the menu (above
  // it) is cut where it leaves the safe area.
  const r = jest.mocked(computeLayout).mock.results.at(-1)!.value as ReturnType<
    typeof computeLayout
  >;
  expect(r.clip).toEqual({ side: 'bottom', amount: 14 });
  const visibleBottom = r.viewRect.y + r.viewRect.height - r.clip!.amount;
  expect(visibleBottom).toBe(112);
  // In the view's own units (14 / 0.5 = 28 cut): the visible part, and the
  // view at full size under it. Scaled by the container, its edge lands on
  // the visible bottom.
  const cut = StyleSheet.flatten(clip().props.style);
  expect(cut).toEqual({ overflow: 'hidden', marginTop: 0, height: 32 });
  const shifted = StyleSheet.flatten(inner().props.style);
  expect(shifted.height).toBe(60);
  expect(shifted.marginTop).toBeCloseTo(0);
  expect(r.viewRect.y + cut.height * r.scale).toBe(visibleBottom);
  // The edge moves with the view: a plain child of the scaled container,
  // nothing animates it, and it stays put in view units over the move.
  const container = clip().parent!;
  expect(StyleSheet.flatten(container.props.style).transform).toEqual([
    { scale: 0.5 },
  ]);
  // A tap on the hidden part falls through to the backdrop.
  expect(container.props.pointerEvents).toBe('box-none');
  expect(mockAnimations.map((a) => a.to)).not.toContain(32);
  await act(() => jest.advanceTimersByTime(300 + 16));
  expect(StyleSheet.flatten(clip().props.style)).toEqual(cut);
  mockAnimations.length = 0;
  await act(() => ref.current!.drop());
  expect(mockAnimations.some((a) => a.to === 1)).toBe(true);
  // The cut part is outside the safe area: shown again as the view grows back.
  expect(StyleSheet.flatten(clip().props.style)?.overflow).toBeUndefined();
  // The scale back (300ms) outlasts the fade (200ms).
  await act(() => jest.advanceTimersByTime(250));
  expect(onLiftEnd).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTime(50 + 4 * 16));
  expect(onLiftEnd).toHaveBeenCalledTimes(1);
});

test('menu below: the top is cut, the view shifted up under the visible part', async () => {
  // 60dp view at y 100, menu and gap 96dp below it; the safe area starts at
  // 144 and ends at 256: 16dp of room, so 14dp of the 30dp (0.5) view are cut.
  jest
    .spyOn(Dimensions, 'get')
    .mockReturnValue({ width: 300, height: 263 } as never);
  await render(
    <LiftProvider insets={{ top: 144, bottom: 7, left: 0, right: 0 }}>
      <Row menu={menuItems()} />
    </LiftProvider>
  );
  await longPress();
  await placeChrome();
  const r = jest.mocked(computeLayout).mock.results.at(-1)!.value as ReturnType<
    typeof computeLayout
  >;
  expect(r.clip).toEqual({ side: 'top', amount: 14 });
  // 14 / 0.5 = 28 cut off the top, in the view's units.
  const content = screen.getByTestId('content');
  expect(StyleSheet.flatten(content.parent!.parent!.props.style)).toEqual({
    overflow: 'hidden',
    marginTop: 28,
    height: 32,
  });
  expect(StyleSheet.flatten(content.parent!.props.style)).toEqual({
    marginTop: -28,
    height: 60,
  });
  // Scaled, the visible part starts at the safe area's top.
  expect(r.viewRect.y + 28 * r.scale).toBe(144);
});

test('the cut comes back with a lift during the drop, and never outlives the lift', async () => {
  jest.useFakeTimers();
  jest
    .spyOn(Dimensions, 'get')
    .mockReturnValue({ width: 300, height: 119 } as never);
  const ref = { current: null as LiftHandle | null };
  await render(
    <LiftProvider insets={{ top: 0, bottom: 7, left: 0, right: 0 }}>
      <Row ref={ref} menu={menuItems()} />
    </LiftProvider>
  );
  const overflow = () =>
    StyleSheet.flatten(
      screen.getByTestId('content').parent!.parent!.props.style
    )?.overflow;
  await longPress();
  await placeChrome();
  expect(overflow()).toBe('hidden');
  // Lifted again mid drop: back to its arranged place, cut again.
  await act(() => ref.current!.drop());
  expect(overflow()).toBeUndefined();
  await act(() => ref.current!.lift());
  expect(overflow()).toBe('hidden');
  // An immediate drop clears it: the next lift starts uncut.
  await act(() => ref.current!.drop({ immediate: true }));
  await act(() => jest.advanceTimersByTime(16));
  await longPress();
  expect(overflow()).toBeUndefined();
});

test('a second tap on an item during the fade-out does not run it again', async () => {
  jest.useFakeTimers();
  const log: string[] = [];
  await render(app({ menu: menuItems(log) }));
  await longPress();
  await placeChrome();
  await fireEvent.press(screen.getByTestId('lift-menu-item-delete'));
  // Untouchable and out of the accessibility tree while it fades out.
  const hidden = { includeHiddenElements: true };
  const menu = screen.getByTestId('lift-menu', hidden);
  expect(menu.props.pointerEvents).toBe('none');
  expect(menu.props.accessibilityElementsHidden).toBe(true);
  expect(screen.queryByTestId('lift-menu')).toBeNull();
  await fireEvent.press(screen.getByTestId('lift-menu-item-delete', hidden));
  expect(log).toEqual(['delete']);
});

test('no menu: the drop waits for the backdrop fade only', async () => {
  jest.useFakeTimers();
  const ref = { current: null as LiftHandle | null };
  const onLiftEnd = jest.fn();
  await render(
    app({ ref, onLiftEnd, motion: { backdrop: { duration: 100 } } })
  );
  await longPress();
  await act(() => ref.current!.drop());
  await act(() => jest.advanceTimersByTime(100 + 16));
  expect(onLiftEnd).toHaveBeenCalledTimes(1);
});

test('menu items that change while lifted show up', async () => {
  // Only the row re-renders (its own state), not the provider.
  let setTitle: (t: string) => void = () => {};
  function StatefulRow() {
    const [title, set] = useState('Before');
    setTitle = set;
    return <Row menu={[{ key: 'k', title, onPress: () => {} }]} />;
  }
  await render(
    <LiftProvider>
      <StatefulRow />
    </LiftProvider>
  );
  await longPress();
  await placeChrome();
  expect(screen.getByText('Before')).toBeTruthy();
  await act(() => setTitle('After'));
  expect(screen.getByText('After')).toBeTruthy();
  expect(screen.queryByText('Before')).toBeNull();
});

test('accessible: a menu makes the view one element, unless overridden', async () => {
  const wrapper = () => wrapperOf();
  const view = await render(app({ menu: menuItems() }));
  expect(wrapper().props.accessible).toBe(true);
  await view.rerender(app({ menu: menuItems(), accessible: false }));
  expect(wrapper().props.accessible).toBe(false);
  expect(wrapper().props.accessibilityActions).toHaveLength(2);
});

test('the content fills the slot only when the slot style sizes it', async () => {
  // content -> inner -> clip -> container (the Portal mock adds nothing).
  const chain = () => {
    const inner = screen.getByTestId('content').parent!;
    return [inner, inner.parent!, inner.parent!.parent!].map(
      (el) => StyleSheet.flatten(el.props.style)?.flexGrow
    );
  };
  // Unsized (a chat bubble aligned to one side): the content's own height.
  // A growing chain would take all the height alignSelf leaves it.
  const view = await render(app({ style: { alignSelf: 'flex-end' } }));
  expect(chain()).toEqual([undefined, undefined, undefined]);
  await view.rerender(app({ style: { flex: 1 } }));
  expect(chain()).toEqual([1, 1, 1]);
  await view.rerender(app({ style: { height: 120 } }));
  expect(chain()).toEqual([1, 1, 1]);
  await view.rerender(app({ style: { width: '60%' } }));
  expect(chain()).toEqual([undefined, undefined, undefined]);
});
