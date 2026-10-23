import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard, Text, View } from 'react-native';
import { LiftProvider } from '../LiftProvider';
import { Liftable } from '../Liftable';

// Just enough Reanimated for Liftable, LiftHost and DimBackdrop: shared
// values are plain boxes, animations jump to their target. The real
// packages need the native UI runtime.
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: { View: RN.View },
    // Stable across renders, like the real one (effects depend on it).
    useSharedValue: (value: unknown) =>
      require('react').useRef({ value }).current,
    useAnimatedStyle: (style: () => object) => style(),
    withTiming: (to: number) => to,
    withSpring: (to: number) => to,
  };
});
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
    fn(...args),
}));

// The lift gesture's onLift, as Liftable configured it.
let onLift: () => void = () => {};
jest.mock('../engine/useLiftGesture', () => ({
  useLiftGesture: (config: { onLift: () => void }) => {
    onLift = config.onLift;
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

// Long press activates on a laid-out view.
async function longPress() {
  await fireEvent(
    // content -> container -> wrapper (the Portal mock adds no node).
    screen.getByTestId('content').parent!.parent!,
    'layout',
    { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 60 } } }
  );
  await act(() => onLift());
}

function app(props: Partial<Parameters<typeof Liftable>[0]> = {}) {
  return (
    <LiftProvider>
      <Liftable {...props}>
        <View testID="content">
          <Text>row</Text>
        </View>
      </Liftable>
    </LiftProvider>
  );
}

beforeEach(() => {
  onLift = () => {};
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

test('the default backdrop is the dim', async () => {
  await render(app());
  await longPress();
  expect(screen.getByTestId('lift-dim')).toBeTruthy();
});

test('renderBackdrop replaces the dim', async () => {
  await render(
    app({
      renderBackdrop: ({ visible }) => (
        <View testID="custom-backdrop">
          <Text>{`visible:${visible}`}</Text>
        </View>
      ),
    })
  );
  await longPress();
  expect(screen.getByTestId('custom-backdrop')).toBeTruthy();
  expect(screen.getByText('visible:true')).toBeTruthy();
  expect(screen.queryByTestId('lift-dim')).toBeNull();
});

// Step 3.1: the feedback hides the keyboard wait. With the keyboard open the
// teleport waits for it to close, but haptics and the dim start at once.
test('keyboard open: haptics and dim start before the teleport', async () => {
  const visible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const haptics = jest.fn();
  const onLiftStart = jest.fn();
  await render(app({ haptics, onLiftStart }));
  await longPress();
  expect(dismiss).toHaveBeenCalled();
  expect(haptics).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('lift-dim')).toBeTruthy();
  expect(onLiftStart).not.toHaveBeenCalled();
  visible.mockRestore();
  dismiss.mockRestore();
});
