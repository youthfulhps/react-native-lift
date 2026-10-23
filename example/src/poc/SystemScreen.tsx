import { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type HostInstance,
} from 'react-native';
import { useSharedValue, withSpring } from 'react-native-reanimated';
import { Liftable, useLiftRef } from 'react-native-lift';
import { frames } from './autoLoop';

// AC-E9: rotation, background, Android back, and an unmount (a timer, like a
// programmatic navigation) while lifted. Each must drop at once, leave the
// content in its slot (home:yes) and the backdrop gone (taps reach the
// screen). Driven by example/.maestro/poc/e9-system.yaml.
export function SystemScreen() {
  const [lifted, setLifted] = useState(false);
  const [ends, setEnds] = useState(0);
  const [home, setHome] = useState('-');
  const [taps, setTaps] = useState(0);
  const [shown, setShown] = useState(true);
  const scale = useSharedValue(1);
  const handle = useLiftRef();
  const slot = useRef<HostInstance>(null);
  const content = useRef<HostInstance>(null);
  return (
    <View style={styles.screen}>
      <Text testID="e9-status">
        {`lifted:${+lifted} ends:${ends} home:${home} taps:${taps}`}
      </Text>
      <Pressable
        testID="e9-tap"
        style={styles.button}
        onPress={() => setTaps((n) => n + 1)}
      >
        <Text>tap (backdrop gone?)</Text>
      </Pressable>
      <Pressable
        testID="e9-unmount-later"
        style={styles.button}
        onPress={() => {
          setShown(true);
          // Long enough for Maestro's long press to lift it first.
          setTimeout(() => setShown(false), 4000);
        }}
      >
        <Text>{shown ? 'unmount in 4s' : 'unmounted'}</Text>
      </Pressable>
      <Pressable
        testID="e9-liftdrop"
        style={styles.button}
        onPress={() => {
          // Same tick: the lift never renders; the host must still be freed.
          handle.current?.lift();
          handle.current?.drop();
        }}
      >
        <Text>lift + drop</Text>
      </Pressable>
      <Pressable
        testID="e9-remount"
        style={styles.button}
        onPress={() => setShown(true)}
      >
        <Text>remount</Text>
      </Pressable>
      {shown && (
        <View ref={slot} collapsable={false}>
          <Liftable
            ref={handle}
            scale={scale}
            onLiftStart={() => {
              setLifted(true);
              setHome('-');
              scale.value = withSpring(1);
            }}
            onLiftEnd={async () => {
              setLifted(false);
              setEnds((n) => n + 1);
              await frames(2);
              const a = content.current?.getBoundingClientRect();
              const b = slot.current?.getBoundingClientRect();
              const ok =
                !!a &&
                !!b &&
                Math.abs(a.x - b.x) < 1 &&
                Math.abs(a.y - b.y) < 1;
              setHome(ok ? 'yes' : 'no');
            }}
          >
            <View ref={content} collapsable={false} style={styles.card}>
              <Text testID="e9-card">e9-card</Text>
            </View>
          </Liftable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12 },
  button: { padding: 12, backgroundColor: '#ddd', borderRadius: 8 },
  card: { padding: 32, backgroundColor: '#fff', borderRadius: 12 },
});
