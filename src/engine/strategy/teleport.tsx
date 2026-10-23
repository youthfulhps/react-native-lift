import {
  createContext,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type HostInstance,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Portal, PortalHost, PortalProvider } from 'react-native-teleport';
import { scheduleOnRN } from 'react-native-worklets';
import type { LiftHandle } from '../../types';
import { focusToRestore } from '../focus';
import {
  IDLE,
  owns,
  transition,
  type LiftEvent,
  type LiftState,
} from '../liftState';
import { isUsable, windowRect } from '../measure';
import { useSystemDrop } from '../systemEvents';

const HOST_NAME = 'react-native-lift';

type Origin = { x: number; y: number };

type HostContextValue = {
  getHostRect: () => Origin | undefined;
  // Translate of the layer holding the PortalHost. An animated drop moves this
  // layer, not the container, so the container leaves the host with no
  // transform of its own and the re-parent lands on the same pixels.
  offsetX: SharedValue<number>;
  offsetY: SharedValue<number>;
  // Runs the one-lift-at-a-time machine (liftState.ts); returns the new state.
  send: (event: LiftEvent<LiftHandle>) => LiftState<LiftHandle>;
};

const HostContext = createContext<HostContextValue | null>(null);

// The lifted slot's handle, or null. Separate from HostContext so only
// consumers of it (scroll lock, backdrop) re-render on lift/drop.
export const LiftContext = createContext<{ active: LiftHandle | null } | null>(
  null
);

export function LiftHost({ children }: { children: ReactNode }) {
  const hostRef = useRef<HostInstance>(null);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const [active, setActive] = useState<LiftHandle | null>(null);
  const state = useRef<LiftState<LiftHandle>>(IDLE);
  const layerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }],
  }));
  const value = useMemo(
    () => ({
      // The outer view never moves; offsets are added explicitly.
      getHostRect: () => windowRect(hostRef.current),
      offsetX,
      offsetY,
      send: (event: LiftEvent<LiftHandle>) => {
        state.current = transition(state.current, event);
        // Backdrop and scroll lock follow the owner, measuring included.
        setActive(state.current.phase === 'idle' ? null : state.current.slot);
        return state.current;
      },
    }),
    [offsetX, offsetY]
  );
  const lift = useMemo(() => ({ active }), [active]);
  useSystemDrop(active);
  return (
    <PortalProvider>
      <HostContext.Provider value={value}>
        <LiftContext.Provider value={lift}>{children}</LiftContext.Provider>
        <View
          ref={hostRef}
          style={StyleSheet.absoluteFill}
          pointerEvents="box-none"
          collapsable={false}
        >
          {/* AC-E2: a tap outside the lifted view drops it. */}
          {active && (
            <Pressable
              testID="lift-backdrop"
              accessibilityLabel="lift-backdrop"
              style={StyleSheet.absoluteFill}
              onPress={() => active.drop()}
            />
          )}
          <Animated.View
            style={[StyleSheet.absoluteFill, layerStyle]}
            pointerEvents="box-none"
            collapsable={false}
          >
            <PortalHost name={HOST_NAME} style={StyleSheet.absoluteFill} />
          </Animated.View>
        </View>
      </HostContext.Provider>
    </PortalProvider>
  );
}

type Lifted = {
  left: number;
  top: number;
  width: number;
  height: number;
  // itemKey at lift time.
  key: string | number | undefined;
};

export type LiftSlotProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scale: SharedValue<number>;
  onLiftStart?: () => void;
  onLiftEnd?: () => void;
  // AC-E6: refocus the input that had focus when lift dismissed the keyboard,
  // unless something else took focus meanwhile. Default true.
  restoreFocus?: boolean;
  // Identity of the item rendered in this slot. A recycling list (FlashList)
  // can rebind the slot to another item while it is lifted; when this
  // changes, the slot drops at once so the overlay never shows that item.
  itemKey?: string | number;
  // Internal: an accepted lift that never committed (cancelled or failed
  // during the keyboard wait).
  onLiftCancel?: () => void;
  ref?: Ref<SlotHandle>;
};

// Internal: lift() also says whether it was accepted, so the gesture can
// undo its press scale when it was not.
export type SlotHandle = {
  lift(): boolean;
  // restoreFocus: false skips AC-E6's restore for this drop (a menu item
  // that navigates).
  drop(opts?: { immediate?: boolean; restoreFocus?: boolean }): void;
};

const near = (a: Origin, b: Origin) =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
const ORIGIN = { x: 0, y: 0 };

export function LiftSlot({
  children,
  style,
  scale,
  onLiftStart,
  onLiftEnd,
  restoreFocus = true,
  itemKey,
  onLiftCancel,
  ref,
}: LiftSlotProps) {
  const host = useContext(HostContext);
  if (!host) {
    throw new Error('react-native-lift: wrap your app in <LiftProvider>');
  }
  const { getHostRect, offsetX, offsetY, send } = host;
  const wrapperRef = useRef<HostInstance>(null);
  const size = useRef({ width: 0, height: 0 });
  const [lifted, setLifted] = useState<Lifted | null>(null);
  // Latest requested state, updated synchronously, so same-tick lift()/drop()
  // calls see each other instead of the last render's `lifted` (last call wins).
  const liftedRef = useRef<Lifted | null>(null);
  // Bumped by every lift()/drop(); a pending lift/drop continues only if current.
  const dropToken = useRef(0);
  // Waiting for the keyboard to close before measuring (P6 "닫힘 대기").
  const pendingLift = useRef(false);
  // Token the pending lift commits under; a lift() during the wait refreshes
  // it (last call wins), a drop() leaves it stale (cancel).
  const pendingToken = useRef(0);
  const keyboardWait = useRef<(() => void) | null>(null);
  // itemKey when lift() was called; a rebind during the keyboard wait
  // cancels the lift.
  const liftKey = useRef<string | number | undefined>(undefined);
  const focused = useRef<HostInstance | null>(null);
  // The current drop's restoreFocus option.
  const dropFocus = useRef(true);
  const mounted = useRef(true);
  // Read through refs: the once-created api closure calls restore/start.
  const latest = useRef({ restoreFocus, onLiftCancel, itemKey });
  latest.current = { restoreFocus, onLiftCancel, itemKey };
  // Stable identity: the machine and the backdrop compare handles.
  const api = useRef<SlotHandle | null>(null);
  const me = () => api.current!;

  // Two frames later: the keyboard reopening moves layout, and that should
  // not land in a commit frame.
  const restore = () => {
    const input = focused.current;
    const drop = dropFocus.current;
    focused.current = null;
    dropFocus.current = true;
    if (!input) {
      return;
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const next = focusToRestore(
          input,
          TextInput.State.currentlyFocusedInput(),
          { liftable: latest.current.restoreFocus, drop }
        );
        if (mounted.current && next) {
          TextInput.State.focusTextInput(next);
        }
      })
    );
  };

  const commit = (next: Lifted | null) => {
    liftedRef.current = next;
    setLifted(next);
  };

  // Host-layer offset that puts the lifted container over the wrapper, or
  // undefined when the wrapper is gone (0x0) or off screen.
  const target = (from: Lifted): Origin | undefined => {
    const wrapper = windowRect(wrapperRef.current);
    const hostRect = getHostRect();
    if (!isUsable(wrapper) || !hostRect) {
      return undefined;
    }
    return {
      x: wrapper.x - hostRect.x - from.left,
      y: wrapper.y - hostRect.y - from.top,
    };
  };

  // R11: the wrapper may have moved while lifted (scroll, bounce, data
  // change). Commit only when it has stopped (same rect two frames running)
  // and the host layer sits on it; otherwise wait, or animate there first.
  const settle = (token: number, from: Lifted, prev?: Origin) => {
    if (token !== dropToken.current) {
      return;
    }
    const t = target(from);
    if (!t) {
      commit(null);
      return;
    }
    const here = { x: offsetX.value, y: offsetY.value };
    const still = prev !== undefined && near(t, prev);
    // First sample still at the lift position: nothing moved, commit now.
    const unmoved = prev === undefined && near(here, ORIGIN);
    if (near(t, here) && (still || unmoved)) {
      commit(null);
      return;
    }
    if (!still) {
      requestAnimationFrame(() => settle(token, from, t));
      return;
    }
    offsetX.value = withTiming(t.x);
    offsetY.value = withTiming(t.y, undefined, (finished) => {
      'worklet';
      if (finished) {
        scheduleOnRN(settle, token, from, t);
      }
    });
  };

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const start = (token: number) => {
    pendingLift.current = false;
    keyboardWait.current = null;
    const wrapper = windowRect(wrapperRef.current);
    const hostRect = getHostRect();
    // Cancelled while waiting, or no onLayout yet (would lock the wrapper to 0x0).
    if (
      token !== dropToken.current ||
      liftKey.current !== latest.current.itemKey ||
      !wrapper ||
      !hostRect ||
      size.current.width === 0
    ) {
      // Idle by now unless another slot lifted meanwhile; then its lift
      // must not be reopened onto a keyboard.
      if (send({ type: 'cancel', slot: me() }).phase === 'idle') {
        // The keyboard was dismissed for nothing: give focus back.
        restore();
      } else {
        focused.current = null;
      }
      latest.current.onLiftCancel?.();
      return;
    }
    send({ type: 'committed', slot: me() });
    // B1: one commit flips hostName, sets the host-local rect, and locks
    // the wrapper to its untransformed onLayout size.
    commit({
      left: wrapper.x - hostRect.x,
      top: wrapper.y - hostRect.y,
      ...size.current,
      key: liftKey.current,
    });
  };

  // Created once; everything it calls reads refs, shared values or stable
  // context functions, so first-render closures stay correct.
  api.current ??= {
    lift() {
      if (!owns(send({ type: 'lift', slot: me() }), me())) {
        return false;
      }
      if (liftedRef.current) {
        // Already lifted, or mid drop: cancel the drop (its token no longer
        // matches) and bring the layer back to the lift position.
        dropToken.current++;
        offsetX.value = withTiming(0);
        offsetY.value = withTiming(0);
        return true;
      }
      liftKey.current = latest.current.itemKey;
      if (pendingLift.current) {
        pendingToken.current = ++dropToken.current;
        return true;
      }
      dropFocus.current = true;
      const token = ++dropToken.current;
      if (!Keyboard.isVisible()) {
        focused.current = null;
        start(token);
        return liftedRef.current !== null;
      }
      // Measure once the keyboard is gone and layout has settled: from the
      // end of the hide animation, the wrapper at the same rect for 3 frames
      // running (at most 30), then 3 more frames: the shadow tree settles a
      // frame or two before the screen does (Android KeyboardAvoidingView).
      focused.current = TextInput.State.currentlyFocusedInput() ?? null;
      pendingLift.current = true;
      pendingToken.current = token;
      let done = false;
      const settled = (
        prev: Origin | undefined,
        still: number,
        left: number
      ) => {
        const r = windowRect(wrapperRef.current);
        const now = r && { x: r.x, y: r.y };
        const n = now && prev && near(now, prev) ? still + 1 : 0;
        if (n >= 2 || left === 0) {
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => start(pendingToken.current))
            )
          );
        } else {
          requestAnimationFrame(() => settled(now, n, left - 1));
        }
      };
      let end: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        subs.forEach((sub) => sub.remove());
        clearTimeout(timer);
        clearTimeout(end);
      };
      const go = () => {
        if (!done) {
          done = true;
          stop();
          requestAnimationFrame(() => settled(undefined, 0, 30));
        }
      };
      const subs = [
        // iOS: the animation ends `duration` ms after keyboardWillHide;
        // keyboardDidHide comes ~0.4s after that (P6, iOS 17 simulator).
        // Android sends no will-events, and a 0 duration means no animation
        // timing: keyboardDidHide starts the wait then.
        Keyboard.addListener('keyboardWillHide', (e) => {
          if (e.duration > 0) {
            clearTimeout(end);
            end = setTimeout(go, e.duration);
          }
        }),
        Keyboard.addListener('keyboardDidHide', go),
      ];
      // A dismiss that never reports.
      const timer = setTimeout(go, 1000);
      keyboardWait.current = stop;
      Keyboard.dismiss();
      return true;
    },
    drop({ immediate = false, restoreFocus: focus = true } = {}) {
      const from = liftedRef.current;
      const token = ++dropToken.current;
      dropFocus.current = focus;
      // measuring -> idle at once (backdrop, scroll lock); lifted -> dropping.
      send({ type: 'drop', slot: me() });
      if (!from) {
        // A pending (keyboard-wait) lift sees the new token and gives up.
        return;
      }
      if (immediate) {
        commit(null);
        return;
      }
      settle(token, from);
    },
  };
  useImperativeHandle(ref, () => api.current!, []);

  // Unmounted while lifted, mid-drop or waiting for the keyboard: nothing
  // will commit null for us, so free the host (backdrop, scroll lock, the
  // machine) here.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A counter, not a node ref: bumping the latest value is the point.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      dropToken.current++;
      keyboardWait.current?.();
      pendingLift.current = false;
      if (liftedRef.current) {
        offsetX.value = 0;
        offsetY.value = 0;
        // No-op on a real unmount; on a hide/re-show (Fast Refresh, Suspense,
        // Activity) the isLifted effect then drops cleanly.
        commit(null);
      }
      send({ type: 'dropped', slot: me() });
    };
    // commit only touches a ref and the stable setLifted.
  }, [offsetX, offsetY, send]);

  // Rebound to another item while lifted: render it dropped in this very
  // commit (the overlay never shows the new item); the effect below syncs.
  const shown = lifted && lifted.key === itemKey ? lifted : null;
  const isLifted = shown !== null;
  const wasLifted = useRef(false);
  useLayoutEffect(() => {
    if (isLifted === wasLifted.current) {
      return;
    }
    wasLifted.current = isLifted;
    if (isLifted) {
      onLiftStart?.();
      return;
    }
    // Runs after the re-parent commit, so the mount (queued first) has taken
    // the container out of the host before this reset lands; the host is
    // empty by then and nothing visible moves. The machine keeps a second
    // slot from lifting onto the layer before 'dropped'.
    offsetX.value = 0;
    offsetY.value = 0;
    if (liftedRef.current) {
      // itemKey changed: dropped by render above; stop any drop animation.
      dropToken.current++;
      commit(null);
    }
    send({ type: 'dropped', slot: me() });
    restore();
    onLiftEnd?.();
    // restore() reads restoreFocus from this render.
  }, [isLifted, onLiftStart, onLiftEnd, offsetX, offsetY, send]);

  const onLayout = (e: LayoutChangeEvent) => {
    size.current = {
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    };
  };

  return (
    <View
      ref={wrapperRef}
      collapsable={false}
      onLayout={onLayout}
      style={[
        style,
        shown && styles.locked,
        shown && { width: shown.width, height: shown.height },
      ]}
    >
      {/* teleport moves the Portal's children (not the Portal) into the host and
          sizes the Portal to the host, so the rect goes on the container. */}
      <Portal
        hostName={shown ? HOST_NAME : undefined}
        style={shown ? undefined : styles.fill}
      >
        <Animated.View
          collapsable={false}
          style={[
            shown ? [styles.absolute, rectOf(shown)] : styles.fill,
            containerStyle,
          ]}
        >
          {children}
        </Animated.View>
      </Portal>
    </View>
  );
}

const rectOf = ({ left, top, width, height }: Lifted) => ({
  left,
  top,
  width,
  height,
});

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  absolute: { position: 'absolute' },
  // Freeze flex so a `flex: 1` wrapper keeps its measured size once emptied.
  locked: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
});
