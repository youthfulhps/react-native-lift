import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Motion } from './motion';

export type BackdropState = {
  // True while the view is lifted (from the teleport, after any keyboard
  // wait) until the drop starts.
  visible: boolean;
};

// Default backdrop (AC-M3): a dim that fades in and out.
export function DimBackdrop({
  visible,
  motion,
}: BackdropState & { motion: Motion['backdrop'] }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(visible ? motion.opacity : 0, {
      duration: motion.duration,
    });
  }, [visible, motion.opacity, motion.duration, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID="lift-dim"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.dim, style]}
    />
  );
}

const styles = StyleSheet.create({ dim: { backgroundColor: '#000' } });
