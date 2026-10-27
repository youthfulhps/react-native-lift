import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  runOnJS,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
  type WithSpringConfig,
} from 'react-native-reanimated';

// Long press: press-in shrinks (press.scale), activation lifts, a press that never
// activates (scroll took over, finger moved > maxDistance) springs back.
// Scale after a lift is the caller's (presentation's) business.
//
// The builder API (Gesture.LongPress) and Reanimated's runOnJS exist in both
// Gesture Handler 2 and 3 and Reanimated 3 and 4, so one code path covers them.
export function useLiftGesture({
  scale,
  onLift,
  enabled = true,
  press,
  release,
}: {
  scale: SharedValue<number>;
  onLift: () => void;
  enabled?: boolean;
  // Motion values, as plain data from the presentation layer.
  press: { scale: number; duration: number };
  release: WithSpringConfig;
}) {
  const activated = useSharedValue(false);
  return useMemo(
    () =>
      Gesture.LongPress()
        .enabled(enabled)
        .minDuration(400)
        .maxDistance(10)
        .onBegin(() => {
          'worklet';
          activated.value = false;
          scale.value = withTiming(press.scale, { duration: press.duration });
        })
        .onStart(() => {
          'worklet';
          activated.value = true;
          runOnJS(onLift)();
        })
        .onFinalize(() => {
          'worklet';
          if (!activated.value) {
            scale.value = withSpring(1, release);
          }
        }),
    [activated, enabled, onLift, press.duration, press.scale, release, scale]
  );
}
