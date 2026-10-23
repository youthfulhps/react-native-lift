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
  Dimensions,
  StyleSheet,
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

const HOST_NAME = 'react-native-lift';

type Origin = { x: number; y: number };

type HostContextValue = {
  getHostRect: () => Origin | undefined;
  // Translate of the layer holding the PortalHost. An animated drop moves this
  // layer, not the container, so the container leaves the host with no
  // transform of its own and the re-parent lands on the same pixels.
  offsetX: SharedValue<number>;
  offsetY: SharedValue<number>;
};

const HostContext = createContext<HostContextValue | null>(null);

export function LiftHost({ children }: { children: ReactNode }) {
  const hostRef = useRef<HostInstance>(null);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const layerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }],
  }));
  const value = useMemo(
    () => ({
      // The outer view never moves; offsets are added explicitly.
      getHostRect: () => hostRef.current?.getBoundingClientRect(),
      offsetX,
      offsetY,
    }),
    [offsetX, offsetY]
  );
  return (
    <PortalProvider>
      <HostContext.Provider value={value}>
        {children}
        <View
          ref={hostRef}
          style={StyleSheet.absoluteFill}
          pointerEvents="box-none"
          collapsable={false}
        >
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

type Lifted = { left: number; top: number; width: number; height: number };

export type LiftSlotProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scale: SharedValue<number>;
  onLiftStart?: () => void;
  onLiftEnd?: () => void;
  ref?: Ref<LiftHandle>;
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
  ref,
}: LiftSlotProps) {
  const host = useContext(HostContext);
  if (!host) {
    throw new Error('react-native-lift: wrap your app in <LiftProvider>');
  }
  const { getHostRect, offsetX, offsetY } = host;
  const wrapperRef = useRef<HostInstance>(null);
  const size = useRef({ width: 0, height: 0 });
  const [lifted, setLifted] = useState<Lifted | null>(null);
  // Latest requested state, updated synchronously, so same-tick lift()/drop()
  // calls see each other instead of the last render's `lifted` (last call wins).
  const liftedRef = useRef<Lifted | null>(null);
  // Bumped by every lift()/drop(); a pending drop continues only if current.
  const dropToken = useRef(0);

  const commit = (next: Lifted | null) => {
    liftedRef.current = next;
    setLifted(next);
  };

  // Host-layer offset that puts the lifted container over the wrapper, or
  // undefined when the wrapper is gone (0x0) or off screen.
  const target = (from: Lifted): Origin | undefined => {
    const wrapper = wrapperRef.current?.getBoundingClientRect();
    const hostRect = getHostRect();
    const win = Dimensions.get('window');
    if (
      !wrapper ||
      !hostRect ||
      (wrapper.width === 0 && wrapper.height === 0) ||
      wrapper.x + wrapper.width <= 0 ||
      wrapper.y + wrapper.height <= 0 ||
      wrapper.x >= win.width ||
      wrapper.y >= win.height
    ) {
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

  // Declared before the layout effect below so onLiftStart/onLiftEnd see the
  // handle of the committed state.
  useImperativeHandle(
    ref,
    () => ({
      lift() {
        if (liftedRef.current) {
          // Already lifted, or mid drop: cancel the drop (its token no longer
          // matches) and bring the layer back to the lift position.
          dropToken.current++;
          offsetX.value = withTiming(0);
          offsetY.value = withTiming(0);
          return;
        }
        const wrapper = wrapperRef.current?.getBoundingClientRect();
        const hostRect = getHostRect();
        // No onLayout yet would lock the wrapper to 0x0.
        if (!wrapper || !hostRect || size.current.width === 0) {
          return;
        }
        // B1: one commit flips hostName, sets the host-local rect, and locks
        // the wrapper to its untransformed onLayout size.
        commit({
          left: wrapper.x - hostRect.x,
          top: wrapper.y - hostRect.y,
          ...size.current,
        });
      },
      drop({ immediate = false } = {}) {
        const from = liftedRef.current;
        if (!from) {
          return;
        }
        const token = ++dropToken.current;
        if (immediate) {
          commit(null);
          return;
        }
        settle(token, from);
      },
    }),
    // commit/settle only touch refs, shared values and the stable setLifted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getHostRect, offsetX, offsetY]
  );

  const isLifted = lifted !== null;
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
    // empty by then and nothing visible moves.
    // ponytail: one layer for all slots; a second slot lifting during another
    // slot's drop animation would ride it. Step 2.2 (one lift at a time) closes it.
    offsetX.value = 0;
    offsetY.value = 0;
    onLiftEnd?.();
  }, [isLifted, onLiftStart, onLiftEnd, offsetX, offsetY]);

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
        lifted && styles.locked,
        lifted && { width: lifted.width, height: lifted.height },
      ]}
    >
      {/* teleport moves the Portal's children (not the Portal) into the host and
          sizes the Portal to the host, so the rect goes on the container. */}
      <Portal
        hostName={lifted ? HOST_NAME : undefined}
        style={lifted ? undefined : styles.fill}
      >
        <Animated.View
          collapsable={false}
          style={[
            lifted ? [styles.absolute, lifted] : styles.fill,
            containerStyle,
          ]}
        >
          {children}
        </Animated.View>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  absolute: { position: 'absolute' },
  // Freeze flex so a `flex: 1` wrapper keeps its measured size once emptied.
  locked: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
});
