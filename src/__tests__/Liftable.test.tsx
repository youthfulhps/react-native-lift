import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState, Dimensions, Keyboard, Text, View } from 'react-native';
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

const layout = {
  nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 60 } },
};

// The long press activates on laid-out view `n`.
async function longPress(n = 0) {
  // content -> container -> wrapper (the Portal mock adds no node).
  await fireEvent(
    screen.getAllByTestId('content')[n]!.parent!.parent!,
    'layout',
    layout
  );
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
