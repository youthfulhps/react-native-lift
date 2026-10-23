import { useLongPressGesture } from 'react-native-gesture-handler';
import {
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// Long press: press-in shrinks to 0.95, activation lifts, a press that never
// activates (scroll took over, finger moved > maxDistance) springs back.
// Scale after a lift is the caller's (presentation's) business.
export function useLiftGesture({
  scale,
  onLift,
  enabled = true,
}: {
  scale: SharedValue<number>;
  onLift: () => void;
  enabled?: boolean;
}) {
  const activated = useSharedValue(false);
  return useLongPressGesture({
    enabled,
    minDuration: 400,
    maxDistance: 10,
    onBegin: () => {
      'worklet';
      activated.value = false;
      scale.value = withTiming(0.95, { duration: 150 });
    },
    onActivate: () => {
      'worklet';
      activated.value = true;
      scheduleOnRN(onLift);
    },
    onFinalize: () => {
      'worklet';
      if (!activated.value) {
        scale.value = withSpring(1);
      }
    },
  });
}
