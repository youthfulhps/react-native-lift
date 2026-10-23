import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type HostInstance,
} from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Liftable, useLiftRef, useLiftScrollLock } from 'react-native-lift';
import { scheduleOnRN } from 'react-native-worklets';
import { frames, gate } from './autoLoop';
import { useProbe, type ProbeCtx } from './probe';

// P6: lift a message while the keyboard is open (the engine dismisses it and
// measures once it has closed), optionally receiving new messages while
// lifted. The screen drops by itself 4.5s after the lift so the drop window
// is gated; the long press itself comes from Maestro
// (example/.maestro/poc/p6-chat-*.yaml).
// Near the bottom: stays above the open keyboard while 'one' mode pushes it
// up a row per round (3 rounds).
const TARGET = 1;
const HOLD = 12;
// useLiftGesture's minDuration: the long press activates this long after its
// onBegin, which starts the press scale.
const MIN_DURATION = 400;
type Auto = 'off' | 'one' | 'flood';
const AUTOS: Auto[] = ['off', 'one', 'flood'];

let cycleNo = 0;

// Status lives in its own component so a lift/drop doesn't re-render the
// list (that load once delayed the probe's mark() by 8 frames).
const status = {
  set: (_: { lifted?: boolean; focused?: boolean; lifts?: number }) => {},
  lifts: 0,
  // True from onLiftStart to onLiftEnd: a late keyboardDidHide (iOS can send
  // a second one) must not reopen the lift window over a lifted view.
  lifted: false,
};
function Status() {
  const [s, setS] = useState({ lifted: false, focused: false, lifts: 0 });
  useEffect(() => {
    status.set = (patch) => setS((cur) => ({ ...cur, ...patch }));
  }, []);
  return (
    <View>
      <Text testID="chat-lifted">{`lifted:${+s.lifted}`}</Text>
      <Text testID="chat-focus">{`focus:${s.focused ? 'yes' : 'no'}`}</Text>
      <Text testID="chat-lifts">{`lifts:${s.lifts}`}</Text>
    </View>
  );
}

const Message = memo(function MessageView({
  id,
  auto,
  restore,
  addMessages,
}: {
  id: number;
  auto: Auto;
  restore: boolean;
  addMessages: (n: number) => void;
}) {
  const handle = useLiftRef();
  const scale = useSharedValue(1);
  const content = useRef<HostInstance>(null);
  const marker = useAnimatedRef();
  const fill = useAnimatedRef();
  const probe = useProbe(marker, fill);
  const ctx = useRef<ProbeCtx | undefined>(undefined);
  const layout = useRef({ width: 0, height: 0 });
  // Window origin before the lift (the probe's settle signature). Measured
  // when the cell settles after the keyboard closes; onLiftStart is too late
  // (the shadow tree lags the commit there).
  const before = useRef<{ x: number; y: number } | undefined>(undefined);
  const isTarget = id === TARGET;
  // Felt latency (long press activated -> onLiftStart): the first frame the
  // press scale leaves 1 is onBegin (+<=1 frame), stamped on the UI thread.
  const press = useRef({ at: 0, keyboard: false, hiddenAt: 0 });
  const pressed = useCallback((at: number) => {
    press.current = { at, keyboard: Keyboard.isVisible(), hiddenAt: 0 };
  }, []);
  useAnimatedReaction(
    () => scale.value < 1,
    (down, was) => {
      if (down && !was) {
        scheduleOnRN(pressed, Date.now());
      }
    }
  );
  useEffect(() => {
    probe.setActive(isTarget);
    return () => probe.setActive(false);
  }, [isTarget, probe]);
  // Lift window: opens once the keyboard has closed and this message has
  // stopped moving (Android's KeyboardAvoidingView relayouts after the hide
  // event), one frame ahead of the engine's 3-frame check. "Closed" is the
  // engine's signal: the end of the iOS hide animation (keyboardWillHide +
  // duration), else keyboardDidHide. onLiftStart closes the window; the
  // timeout does if no lift follows.
  useEffect(() => {
    if (!isTarget) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let end: ReturnType<typeof setTimeout> | undefined;
    // One open per hide: the will-timer or didHide, whichever comes first.
    // Re-armed when the keyboard shows again (focus restore).
    let waiting = false;
    const closed = async () => {
      if (waiting) {
        return;
      }
      waiting = true;
      clearTimeout(end);
      // Same rule as the engine (same rect 3 frames running), then 2 of the
      // engine's 3 extra frames: the window opens just before the commit.
      // `before` keeps the latest pre-commit rect.
      let prev = content.current?.getBoundingClientRect();
      for (let i = 0, still = 0; i < 32 && still < 4 && !status.lifted; i++) {
        await frames(1);
        const r = content.current?.getBoundingClientRect();
        still =
          still >= 2 || (r && prev && Math.abs(r.y - prev.y) < 0.5)
            ? still + 1
            : 0;
        prev = r;
        before.current = r && { x: r.x, y: r.y };
      }
      if (status.lifted) {
        return;
      }
      gate.value = 1;
      clearTimeout(timer);
      timer = setTimeout(() => (gate.value = 0), 2000);
    };
    const subs = [
      Keyboard.addListener('keyboardDidShow', () => {
        waiting = false;
      }),
      Keyboard.addListener('keyboardWillHide', (e) => {
        if (e.duration > 0) {
          clearTimeout(end);
          end = setTimeout(closed, e.duration);
        }
      }),
      Keyboard.addListener('keyboardDidHide', () => {
        press.current.hiddenAt = Date.now();
        closed();
      }),
    ];
    return () => {
      subs.forEach((sub) => sub.remove());
      clearTimeout(timer);
      clearTimeout(end);
    };
  }, [isTarget]);

  return (
    <Liftable
      ref={handle}
      scale={scale}
      restoreFocus={restore}
      onLiftStart={async () => {
        status.lifted = true;
        status.set({ lifted: true, lifts: ++status.lifts });
        const r = content.current?.getBoundingClientRect();
        const origin = before.current ?? (r && { x: r.x, y: r.y });
        before.current = undefined;
        if (isTarget) {
          const { at, keyboard, hiddenAt } = press.current;
          const activated = at + MIN_DURATION;
          console.log(
            `P6 LATENCY keyboard=${keyboard ? 'open' : 'closed'} ` +
              `ms=${Date.now() - activated}` +
              (hiddenAt ? ` didHide=${hiddenAt - activated}` : '')
          );
        }
        if (isTarget && origin) {
          ctx.current = {
            cycle: cycleNo++,
            origin,
            layout: layout.current,
          };
          probe.mark('lift', ctx.current);
        }
        await frames(HOLD);
        gate.value = 0;
        // After the probe's 10-frame post window.
        await frames(6);
        scale.value = withSpring(1);
        if (auto !== 'off') {
          setTimeout(() => addMessages(auto === 'one' ? 1 : 20), 400);
        }
        // After Maestro's ~3s long press has let go.
        setTimeout(async () => {
          gate.value = 1;
          await frames(3);
          handle.current?.drop();
        }, 4500);
      }}
      onLiftEnd={async () => {
        status.lifted = false;
        status.set({ lifted: false });
        if (isTarget && ctx.current) {
          probe.mark('drop', ctx.current);
        }
        // Before the engine's focus restore (2 frames after the commit)
        // reopens the keyboard and moves the list.
        await frames(2);
        gate.value = 0;
      }}
    >
      <View ref={content} collapsable={false} style={styles.message}>
        <Animated.View
          ref={fill}
          collapsable={false}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          onLayout={(e) => {
            layout.current = e.nativeEvent.layout;
          }}
        />
        <Text testID={isTarget ? 'lift-target' : undefined}>{`msg-${id}`}</Text>
        <Animated.View
          ref={marker}
          collapsable={false}
          style={[styles.marker, isTarget && styles.markerOn]}
        />
      </View>
    </Liftable>
  );
});

function Gate() {
  const style = useAnimatedStyle(() => ({ opacity: gate.value }));
  return <Animated.View style={[styles.gate, style]} pointerEvents="none" />;
}

export function KeyboardChatScreen() {
  // Inverted: index 0 is the newest message, drawn at the bottom.
  const [ids, setIds] = useState(() => Array.from({ length: 30 }, (_, i) => i));
  const [auto, setAuto] = useState<Auto>('off');
  // Diagnosis only (Step 2.2): off removes the keyboard reopening after drop.
  const [restore, setRestore] = useState(true);
  const scrollEnabled = useLiftScrollLock();
  const next = useRef(1000);
  const addMessages = useCallback(
    (n: number) =>
      setIds((cur) => [
        ...Array.from({ length: n }, () => next.current++),
        ...cur,
      ]),
    []
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // padding on Android too: edge-to-edge doesn't resize for the keyboard.
      behavior="padding"
    >
      <View style={styles.bar}>
        <Status />
        <Pressable
          testID="auto-toggle"
          style={styles.button}
          onPress={() =>
            setAuto((a) => AUTOS[(AUTOS.indexOf(a) + 1) % AUTOS.length]!)
          }
        >
          <Text>{`auto:${auto}`}</Text>
        </Pressable>
        <Pressable
          testID="restore-toggle"
          style={styles.button}
          onPress={() => setRestore((r) => !r)}
        >
          <Text>{`restore:${restore ? 'on' : 'off'}`}</Text>
        </Pressable>
        <Gate />
      </View>
      <FlatList
        inverted
        // Chat lists keep the keyboard on taps they handle; with the default
        // ('never') the iOS ScrollView captures the touch while it is open.
        keyboardShouldPersistTaps="handled"
        data={ids}
        keyExtractor={String}
        scrollEnabled={scrollEnabled}
        renderItem={({ item }) => (
          <Message
            id={item}
            auto={auto}
            restore={restore}
            addMessages={addMessages}
          />
        )}
      />
      <TextInput
        testID="chat-input"
        style={styles.input}
        placeholder="message"
        // Pre-filled: Maestro's iOS inputText hangs intermittently, and E6
        // only needs a value that must survive the lift.
        defaultValue="hello"
        onFocus={() => status.set({ focused: true })}
        onBlur={() => status.set({ focused: false })}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 },
  button: { padding: 8, backgroundColor: '#ddd', borderRadius: 6 },
  message: {
    height: 64,
    paddingLeft: 32,
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  marker: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 24,
    height: 24,
    backgroundColor: '#888',
  },
  markerOn: { backgroundColor: '#FF00FF' },
  input: { borderWidth: 1, margin: 8, padding: 8, marginBottom: 32 },
  gate: { width: 16, height: 16, backgroundColor: '#00FFFF' },
});
