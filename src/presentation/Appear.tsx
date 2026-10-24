import { useEffect, type ReactNode } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Motion } from './motion';

// Menu and accessory motion: fade and grow in on `visible`, fade out after.
export function Appear({
  visible,
  motion,
  children,
}: {
  visible: boolean;
  motion: Motion['menu'];
  children: ReactNode;
}) {
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(visible ? 1 : 0, { duration: motion.duration });
  }, [visible, motion.duration, shown]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ scale: motion.scale + (1 - motion.scale) * shown.value }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
