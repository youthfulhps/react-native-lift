import { BlurView } from 'expo-blur';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// Recipe (AC-D5): renderBackdrop with expo-blur on iOS and a dim on Android
// (its blur is experimental and costly there). Fade over the same duration
// as motion.backdrop.duration (200 by default): a drop waits for it.
function BlurBackdrop({ visible }: { visible: boolean }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: 200 });
  }, [visible, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
    >
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={30}
          tint="systemMaterial"
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.dim]} />
      )}
    </Animated.View>
  );
}

export const blurBackdrop = (state: { visible: boolean }) => (
  <BlurBackdrop {...state} />
);

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(0, 0, 0, 0.25)' },
});
