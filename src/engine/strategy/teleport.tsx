import {
  createContext,
  useCallback,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
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

const HostRectContext = createContext<(() => Origin | undefined) | null>(null);

export function LiftHost({ children }: { children: ReactNode }) {
  const hostRef = useRef<HostInstance>(null);
  const getHostRect = useCallback(
    () => hostRef.current?.getBoundingClientRect(),
    []
  );
  return (
    <PortalProvider>
      <HostRectContext.Provider value={getHostRect}>
        {children}
        <View
          ref={hostRef}
          style={StyleSheet.absoluteFill}
          pointerEvents="box-none"
          collapsable={false}
        >
          <PortalHost name={HOST_NAME} style={StyleSheet.absoluteFill} />
        </View>
      </HostRectContext.Provider>
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

export function LiftSlot({
  children,
  style,
  scale,
  onLiftStart,
  onLiftEnd,
  ref,
}: LiftSlotProps) {
  const getHostRect = useContext(HostRectContext);
  if (!getHostRect) {
    throw new Error('react-native-lift: wrap your app in <LiftProvider>');
  }
  const wrapperRef = useRef<HostInstance>(null);
  const size = useRef({ width: 0, height: 0 });
  const [lifted, setLifted] = useState<Lifted | null>(null);
  // Latest requested state, updated synchronously, so same-tick lift()/drop()
  // calls see each other instead of the last render's `lifted` (last call wins).
  const liftedRef = useRef<Lifted | null>(null);
  // Bumped by every lift()/drop(); an animated drop commits only if still current.
  const dropToken = useRef(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const commit = (next: Lifted | null) => {
    liftedRef.current = next;
    setLifted(next);
  };
  const finishDrop = (token: number) => {
    if (token === dropToken.current) {
      commit(null);
    }
  };

  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Declared before the layout effect below so onLiftStart/onLiftEnd see the
  // handle of the committed state.
  useImperativeHandle(
    ref,
    () => ({
      lift() {
        if (liftedRef.current) {
          // Already lifted, or mid drop-animation: cancel the drop (its
          // completion no longer matches the token) and settle back in place.
          dropToken.current++;
          translateX.value = withTiming(0);
          translateY.value = withTiming(0);
          return;
        }
        const wrapper = wrapperRef.current?.getBoundingClientRect();
        const host = getHostRect();
        // No onLayout yet would lock the wrapper to 0x0.
        if (!wrapper || !host || size.current.width === 0) {
          return;
        }
        // B1: one commit flips hostName, sets the host-local rect, and locks
        // the wrapper to its untransformed onLayout size.
        commit({
          left: wrapper.x - host.x,
          top: wrapper.y - host.y,
          ...size.current,
        });
      },
      drop({ immediate = false } = {}) {
        const from = liftedRef.current;
        if (!from) {
          return;
        }
        const token = ++dropToken.current;
        // R11: re-measure; the target may have moved while lifted.
        const wrapper = wrapperRef.current?.getBoundingClientRect();
        const host = getHostRect();
        const win = Dimensions.get('window');
        const unusable =
          !wrapper ||
          !host ||
          (wrapper.width === 0 && wrapper.height === 0) ||
          wrapper.x + wrapper.width <= 0 ||
          wrapper.y + wrapper.height <= 0 ||
          wrapper.x >= win.width ||
          wrapper.y >= win.height;
        if (immediate || unusable) {
          commit(null);
          return;
        }
        const dx = wrapper.x - host.x - from.left;
        const dy = wrapper.y - host.y - from.top;
        // Sub-pixel noise must not take the animated (commit-race) path.
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          commit(null);
          return;
        }
        translateX.value = withTiming(dx);
        translateY.value = withTiming(dy, undefined, (finished) => {
          'worklet';
          if (finished) {
            scheduleOnRN(finishDrop, token);
          }
        });
      },
    }),
    // commit/finishDrop only touch refs and the stable setLifted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getHostRect, translateX, translateY]
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
    // ponytail: this JS-side translate reset races the native re-parent commit
    // (Portal back into the wrapper); that ordering is exactly what P2 measures.
    // Upgrade path is B2 if the probe/pixel check shows a frame of offset.
    translateX.value = 0;
    translateY.value = 0;
    onLiftEnd?.();
  }, [isLifted, onLiftStart, onLiftEnd, translateX, translateY]);

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
