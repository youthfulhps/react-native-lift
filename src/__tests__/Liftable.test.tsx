import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Keyboard, Text, View } from 'react-native';
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
      done?.(true);
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
  isUsable: () => true,
}));

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
function Probe({ visible }: { visible: boolean }) {
  useEffect(() => {
    mounts++;
  }, []);
  return <Text testID="custom-backdrop">{`visible:${visible}`}</Text>;
}

beforeEach(() => {
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

test('the backdrop fades out after a drop, then unmounts', async () => {
  jest.useFakeTimers();
  const ref = { current: null as LiftHandle | null };
  await render(
    app({
      ref,
      renderBackdrop: (s) => <Probe {...s} />,
      motion: { backdrop: { duration: 250 } },
    })
  );
  await longPress();
  // Unmoved: the drop commits at once and the host goes idle in that batch.
  await act(() => ref.current!.drop());
  expect(screen.queryByTestId('lift-backdrop')).toBeNull();
  expect(screen.getByText('visible:false')).toBeTruthy();
  await act(() => jest.advanceTimersByTime(249));
  expect(screen.getByText('visible:false')).toBeTruthy();
  await act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId('custom-backdrop')).toBeNull();
  expect(mounts).toBe(1);
});

// Step 3.1: the feedback hides the keyboard wait. With the keyboard open the
// teleport waits for it to close, but haptics and the backdrop start at once
// and stay (no remount) through the teleport.
test('keyboard open: feedback first, teleport after the hide', async () => {
  jest.useFakeTimers();
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
  const haptics = jest.fn();
  const onLiftStart = jest.fn();
  await render(
    app({ haptics, onLiftStart, renderBackdrop: (s) => <Probe {...s} /> })
  );
  await longPress();
  expect(dismiss).toHaveBeenCalled();
  expect(haptics).toHaveBeenCalledTimes(1);
  expect(screen.getByText('visible:true')).toBeTruthy();
  expect(onLiftStart).not.toHaveBeenCalled();

  // iOS: the hide animation ends `duration` ms after keyboardWillHide, then
  // 3 still frames + 3 frames.
  await act(() => listeners.keyboardWillHide!({ duration: 250 }));
  await act(() => jest.advanceTimersByTime(250 + 20 * 16));
  expect(onLiftStart).toHaveBeenCalledTimes(1);
  expect(haptics).toHaveBeenCalledTimes(1);
  expect(screen.getByText('visible:true')).toBeTruthy();
  expect(mounts).toBe(1);
});
