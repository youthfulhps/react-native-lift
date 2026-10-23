import { useLongPressGesture } from 'react-native-gesture-handler';
import {
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
  type WithSpringConfig,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// Long press: press-in shrinks (press.scale), activation lifts, a press that never
// activates (scroll took over, finger moved > maxDistance) springs back.
// Scale after a lift is the caller's (presentation's) business.
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
  return useLongPressGesture({
    enabled,
    minDuration: 400,
    maxDistance: 10,
    onBegin: () => {
      'worklet';
      activated.value = false;
      scale.value = withTiming(press.scale, { duration: press.duration });
    },
    onActivate: () => {
      'worklet';
      activated.value = true;
      scheduleOnRN(onLift);
    },
    onFinalize: () => {
      'worklet';
      if (!activated.value) {
        scale.value = withSpring(1, release);
      }
    },
  });
}
