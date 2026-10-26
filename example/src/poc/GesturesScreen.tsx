import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, withSpring } from 'react-native-reanimated';
import { Liftable } from 'react-native-lift';

// P5: a Pressable and an RNGH pan inside the lifted (teleported) view.
// Driven by example/.maestro/poc/p5-gestures.yaml. The builder API runs on
// Gesture Handler 2 and 3, like the library.
export function GesturesScreen() {
  const [pressed, setPressed] = useState(0);
  const [panned, setPanned] = useState(false);
  const [lifted, setLifted] = useState(false);
  const scale = useSharedValue(1);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onUpdate(() => setPanned(true)),
    []
  );
  return (
    <View style={styles.screen}>
      <Text testID="gesture-status">
        {`pressed:${pressed} pan:${panned ? 'yes' : 'no'} lifted:${+lifted}`}
      </Text>
      <Liftable
        scale={scale}
        onLiftStart={() => {
          setLifted(true);
          scale.value = withSpring(1);
        }}
        onLiftEnd={() => setLifted(false)}
      >
        <View style={styles.card}>
          <Text testID="lift-card">lift-card</Text>
          <Pressable
            testID="inner-button"
            style={styles.button}
            onPress={() => setPressed((n) => n + 1)}
          >
            <Text>tap me</Text>
          </Pressable>
          <GestureDetector gesture={pan}>
            <View testID="pan-area" style={styles.pan}>
              <Text>pan here</Text>
            </View>
          </GestureDetector>
        </View>
      </Liftable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 16 },
  card: { padding: 16, gap: 12, backgroundColor: '#fff', borderRadius: 12 },
  button: { padding: 12, backgroundColor: '#ddd', borderRadius: 8 },
  pan: { height: 120, backgroundColor: '#eef', justifyContent: 'center' },
});
