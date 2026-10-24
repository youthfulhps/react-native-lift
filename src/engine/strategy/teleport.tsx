import {
  createContext,
  useContext,
  useId,
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
  type WithTimingConfig,
} from 'react-native-reanimated';
import { Portal, PortalHost, PortalProvider } from 'react-native-teleport';
import { scheduleOnRN } from 'react-native-worklets';
import {
  computeLayout,
  type Insets,
  type LayoutResult,
  type Rect,
  type Size,
} from '../computeLayout';
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
  send: (event: LiftEvent<SlotHandle>) => LiftState<SlotHandle>;
  phase: () => LiftState<SlotHandle>['phase'];
  // Re-render the host: the lifted slot's menu/accessory changed.
  refresh: () => void;
};

const HostContext = createContext<HostContextValue | null>(null);

// The lifted slot's handle, or null. Separate from HostContext so only
// consumers of it (scroll lock, backdrop) re-render on lift/drop.
export const LiftContext = createContext<{ active: SlotHandle | null } | null>(
  null
);

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

export function LiftHost({
  children,
  insets = NO_INSETS,
}: {
  children: ReactNode;
  // Safe area the menu and accessory stay inside (computeLayout rule 5).
  insets?: Insets;
}) {
  const hostRef = useRef<HostInstance>(null);
  // Host size for computeLayout; the window until the first onLayout.
  const hostSize = useRef<Size | null>(null);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  // Rendered copy of the machine: owner (backdrop, scroll lock) and phase.
  const [shown, setShown] = useState<LiftState<SlotHandle>>(IDLE);
  const [, setTick] = useState(0);
  const active = shown.phase === 'idle' ? null : shown.slot;
  const state = useRef<LiftState<SlotHandle>>(IDLE);
  const layerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }],
  }));
  const value = useMemo(
    () => ({
      // The outer view never moves; offsets are added explicitly.
      getHostRect: () => windowRect(hostRef.current),
      offsetX,
      offsetY,
      send: (event: LiftEvent<SlotHandle>) => {
        state.current = transition(state.current, event);
        // Backdrop and scroll lock follow the owner, measuring included.
        setShown(state.current);
        return state.current;
      },
      phase: () => state.current.phase,
      refresh: () => setTick((n) => n + 1),
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
          onLayout={(e) => {
            hostSize.current = e.nativeEvent.layout;
          }}
        >
          {/* Mounted while a slot owns the host, shown while it is lifted:
              a lift without a keyboard wait commits in the same batch, one
              that waits stays under no dim until it is above it, and a drop
              commits once the dim has faded out (no brightness jump either
              way). Immediate drops take it away at once. */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {active && (
              <Backdrop
                render={active.renderBackdrop}
                visible={shown.phase === 'lifted'}
              />
            )}
          </View>
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
          {/* Laid out around the view once it is lifted; keyed so another
              slot's lift starts over. */}
          {active && shown.phase !== 'measuring' && (
            <Chrome
              key={active.id}
              slot={active}
              visible={shown.phase === 'lifted'}
              insets={insets}
              screen={() => hostSize.current ?? Dimensions.get('window')}
            />
          )}
        </View>
      </HostContext.Provider>
    </PortalProvider>
  );
}

// A component, so hooks inside a renderBackdrop belong to it, not LiftHost.
function Backdrop({
  render,
  visible,
}: {
  render: SlotHandle['renderBackdrop'];
  visible: boolean;
}) {
  return render({ visible });
}

const NO_SIZE = { width: 0, height: 0 };

// Menu and accessory (AC-U1–U3): rendered hidden where they are, measured,
// placed by computeLayout, and only then shown, while the view moves and
// scales to its place.
function Chrome({
  slot,
  visible,
  insets,
  screen,
}: {
  slot: SlotHandle;
  visible: boolean;
  insets: Insets;
  screen: () => Size;
}) {
  const { menu, accessory, accessoryPosition } = slot.chrome();
  const [sizes, setSizes] = useState<{ menu?: Size; accessory?: Size }>({});
  const [placed, setPlaced] = useState<LayoutResult | null>(null);
  const ready = (!menu || sizes.menu) && (!accessory || sizes.accessory);
  useLayoutEffect(() => {
    const view = slot.rect();
    // Nothing to lay out: the view stays where it lifted.
    if ((!menu && !accessory) || !ready || placed || !view) {
      return;
    }
    const result = computeLayout({
      viewRect: view,
      menuSize: sizes.menu ?? NO_SIZE,
      accessorySize: sizes.accessory,
      accessoryPosition,
      safeArea: insets,
      screen: screen(),
    });
    // Not when the drop came first: a repeat lift would show the menu
    // around a view that never moved there.
    if (slot.arrange(result.viewRect, result.scale, result.clip)) {
      setPlaced(result);
    }
  }, [
    menu,
    accessory,
    ready,
    placed,
    sizes,
    slot,
    accessoryPosition,
    insets,
    screen,
  ]);
  if (!menu && !accessory) {
    return null;
  }
  const state: ChromeState = {
    visible: visible && placed !== null,
    close: (opts) => slot.drop(opts),
  };
  const part = (
    name: 'menu' | 'accessory',
    render: ChromeRender | undefined,
    rect: Rect | undefined
  ) =>
    render && (
      <View
        testID={`lift-${name}`}
        style={[
          styles.absolute,
          // Sized too: content that wraps must not re-measure once placed.
          rect
            ? {
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
              }
            : styles.hidden,
        ]}
        // Untouchable until placed and again once the drop starts: a second
        // tap during the fade-out must not run an item twice.
        pointerEvents={rect && state.visible ? 'box-none' : 'none'}
        // Nor reachable by a screen reader while hidden or fading out.
        accessibilityElementsHidden={!state.visible}
        importantForAccessibility={
          state.visible ? 'auto' : 'no-hide-descendants'
        }
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setSizes((cur) =>
            cur[name]?.width === width && cur[name]?.height === height
              ? cur
              : { ...cur, [name]: { width, height } }
          );
        }}
      >
        <Part render={render} state={state} />
      </View>
    );
  return (
    <>
      {part('accessory', accessory, placed?.accessoryRect)}
      {part('menu', menu, placed?.menuRect)}
    </>
  );
}

// A component, so hooks inside renderMenu/renderAccessory belong to it.
function Part({ render, state }: { render: ChromeRender; state: ChromeState }) {
  return render(state);
}

// `visible` from placed to the drop (animate on it); `close` drops the view.
export type ChromeState = {
  visible: boolean;
  close: (opts?: { restoreFocus?: boolean }) => void;
};
type ChromeRender = (state: ChromeState) => ReactNode;

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
  // Presentation, passed in as plain data and render functions (AC-E8):
  // the timing of the view's moves (into place for the menu, back on
  // drop), the backdrop while this slot owns the host, and the menu and
  // accessory laid out around the lifted view.
  moveTiming?: WithTimingConfig;
  renderBackdrop?: (state: { visible: boolean }) => ReactNode;
  renderMenu?: ChromeRender;
  renderAccessory?: ChromeRender;
  accessoryPosition?: 'top' | 'bottom';
  // The backdrop's and menu's fade-out (ms): a drop does not put the view
  // back under them before then. It runs alongside the drop animation.
  fadeOut?: number;
  // On the wrapper (AC-E7: the menu as accessibility actions). `accessible`
  // defaults to true with actions: iOS exposes actions only on an
  // accessible element, which also makes the content one element.
  accessible?: boolean;
  accessibilityActions?: readonly { name: string; label?: string }[];
  onAccessibilityAction?: (e: { nativeEvent: { actionName: string } }) => void;
  ref?: Ref<SlotHandle>;
};

// Internal: lift() also says whether it was accepted, so the gesture can
// undo its press scale when it was not.
export type SlotHandle = {
  id: string;
  // 'new': accepted from idle; 'repeat': this slot already owned the host
  // (a repeat, or a lift mid-drop); false: rejected.
  lift(): 'new' | 'repeat' | false;
  renderBackdrop(state: { visible: boolean }): ReactNode;
  chrome(): {
    menu?: ChromeRender;
    accessory?: ChromeRender;
    accessoryPosition?: 'top' | 'bottom';
  };
  // Host-local rect of the lifted view (unscaled), if lifted.
  rect(): Rect | undefined;
  // Move and scale the lifted view to `view` (its scaled visual rect) and
  // cut `clip` (screen units) off it; false if it is no longer lifted.
  arrange(view: Rect, scale: number, clip?: LayoutResult['clip']): boolean;
  // restoreFocus: false skips AC-E6's restore for this drop (a menu item
  // that navigates).
  drop(opts?: { immediate?: boolean; restoreFocus?: boolean }): void;
};

const near = (a: Origin, b: Origin) =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
const ORIGIN = { x: 0, y: 0 };
// Layout rule 4: what is cut off the lifted view, in its own (unscaled) units.
type Cut = { top: number; bottom: number };
const NO_CUT: Cut = { top: 0, bottom: 0 };
const UNPLACED = { x: 0, y: 0, scale: 1, cut: NO_CUT };

export function LiftSlot({
  children,
  style,
  scale,
  onLiftStart,
  onLiftEnd,
  restoreFocus = true,
  itemKey,
  onLiftCancel,
  moveTiming,
  renderBackdrop,
  renderMenu,
  renderAccessory,
  accessoryPosition,
  fadeOut,
  accessible,
  accessibilityActions,
  onAccessibilityAction,
  ref,
}: LiftSlotProps) {
  const id = useId();
  const host = useContext(HostContext);
  if (!host) {
    throw new Error('react-native-lift: wrap your app in <LiftProvider>');
  }
  const { getHostRect, offsetX, offsetY, send, phase, refresh } = host;
  const wrapperRef = useRef<HostInstance>(null);
  const size = useRef({ width: 0, height: 0 });
  const [lifted, setLifted] = useState<Lifted | null>(null);
  // Latest requested state, updated synchronously, so same-tick lift()/drop()
  // calls see each other instead of the last render's `lifted`. lift() then
  // drop() ends dropped (nothing renders); a lift() during a drop cancels it
  // (repeat).
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
  // When the current drop's fade-out (and scale back) ends (Date.now() ms).
  const fadeEnd = useRef(0);
  // Where arrange() put the lifted view: layer offset, scale and cut.
  const place = useRef(UNPLACED);
  // The cut being shown: set once per arrange, not animated. The clip views
  // sit inside the container, so the cut edge moves and scales with it.
  const [cut, setCut] = useState(NO_CUT);
  const liftScale = useSharedValue(1);
  const mounted = useRef(true);
  // Read through refs: the once-created api closure calls restore/start.
  const latest = useRef({
    restoreFocus,
    onLiftCancel,
    itemKey,
    moveTiming,
    renderBackdrop,
    renderMenu,
    renderAccessory,
    accessoryPosition,
    fadeOut,
  });
  latest.current = {
    restoreFocus,
    onLiftCancel,
    itemKey,
    moveTiming,
    renderBackdrop,
    renderMenu,
    renderAccessory,
    accessoryPosition,
    fadeOut,
  };
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
        // Not onto a keyboard under another slot's lift.
        if (mounted.current && next && phase() === 'idle') {
          TextInput.State.focusTextInput(next);
        }
      })
    );
  };

  // Last rendered lifted state, as seen by the isLifted effect.
  const wasLifted = useRef(false);
  const commit = (next: Lifted | null) => {
    liftedRef.current = next;
    if (!next) {
      // Back in the slot at full size (already there unless immediate).
      // No write at all for a view that was never arranged.
      if (place.current.scale !== 1) {
        liftScale.value = 1;
      }
      place.current = UNPLACED;
      setCut(NO_CUT);
    }
    setLifted(next);
    if (!next && !wasLifted.current) {
      // Dropped before the lift ever rendered (lift() and drop() in one
      // batch, or rebound first): no isLifted edge will free the machine.
      send({ type: 'dropped', slot: me() });
      restore();
      latest.current.onLiftCancel?.();
    }
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
    // (The layer may not have stepped yet towards an arranged place.)
    const unmoved =
      prev === undefined && near(here, ORIGIN) && near(place.current, ORIGIN);
    if (near(t, here) && (still || unmoved)) {
      // The backdrop fades out from the drop on; back under it only once
      // it is gone (a frame after its duration), then re-check the spot.
      const wait = fadeEnd.current - Date.now();
      if (wait > 0) {
        setTimeout(
          () => requestAnimationFrame(() => settle(token, from, t)),
          wait
        );
        return;
      }
      commit(null);
      return;
    }
    if (!still) {
      requestAnimationFrame(() => settle(token, from, t));
      return;
    }
    offsetX.value = withTiming(t.x, latest.current.moveTiming);
    offsetY.value = withTiming(t.y, latest.current.moveTiming, (finished) => {
      'worklet';
      if (finished) {
        scheduleOnRN(settle, token, from, t);
      }
    });
  };

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value * liftScale.value }],
  }));

  const start = (token: number) => {
    pendingLift.current = false;
    keyboardWait.current = null;
    const wrapper = windowRect(wrapperRef.current);
    const hostRect = getHostRect();
    // Cancelled while waiting, no onLayout yet (would lock the wrapper to
    // 0x0), or the machine moved on (dropped by a racing render).
    const ok =
      token === dropToken.current &&
      liftKey.current === latest.current.itemKey &&
      wrapper &&
      hostRect &&
      size.current.width > 0 &&
      // Only measuring -> lifted: 'lifted' here means a lift() raced a drop
      // whose render has not landed yet, and that render will free the host.
      phase() === 'measuring' &&
      owns(send({ type: 'committed', slot: me() }), me());
    if (!ok || !wrapper || !hostRect) {
      send({ type: 'cancel', slot: me() });
      // The keyboard was dismissed for nothing: give focus back.
      restore();
      latest.current.onLiftCancel?.();
      return;
    }
    // The layer is ours now; clear what a drop cut short by an unmount left.
    offsetX.value = 0;
    offsetY.value = 0;
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
    id,
    renderBackdrop: (state) => latest.current.renderBackdrop?.(state) ?? null,
    chrome: () => ({
      menu: latest.current.renderMenu,
      accessory: latest.current.renderAccessory,
      accessoryPosition: latest.current.accessoryPosition,
    }),
    rect() {
      const at = liftedRef.current;
      return at
        ? { x: at.left, y: at.top, width: at.width, height: at.height }
        : undefined;
    },
    arrange(view, s, clip) {
      const at = liftedRef.current;
      if (!at || phase() !== 'lifted') {
        return false;
      }
      // The scale is about the centre; the layer offset does the rest.
      place.current = {
        x: view.x - (at.left + (at.width * (1 - s)) / 2),
        y: view.y - (at.top + (at.height * (1 - s)) / 2),
        scale: s,
        cut: !clip ? NO_CUT : { ...NO_CUT, [clip.side]: clip.amount / s },
      };
      setCut(place.current.cut);
      const timing = latest.current.moveTiming;
      offsetX.value = withTiming(place.current.x, timing);
      offsetY.value = withTiming(place.current.y, timing);
      liftScale.value = withTiming(s, timing);
      return true;
    },
    lift() {
      if (!owns(send({ type: 'lift', slot: me() }), me())) {
        return false;
      }
      if (liftedRef.current) {
        // Already lifted, or mid drop: cancel the drop (its token no longer
        // matches) and bring the view back to its lifted place.
        dropToken.current++;
        const timing = latest.current.moveTiming;
        offsetX.value = withTiming(place.current.x, timing);
        offsetY.value = withTiming(place.current.y, timing);
        liftScale.value = withTiming(place.current.scale, timing);
        setCut(place.current.cut);
        return 'repeat';
      }
      liftKey.current = latest.current.itemKey;
      dropFocus.current = true;
      if (pendingLift.current) {
        pendingToken.current = ++dropToken.current;
        return 'repeat';
      }
      const token = ++dropToken.current;
      if (!Keyboard.isVisible()) {
        focused.current = null;
        start(token);
        return liftedRef.current ? 'new' : false;
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
      return 'new';
    },
    drop({ immediate = false, restoreFocus: focus = true } = {}) {
      const from = liftedRef.current;
      const token = ++dropToken.current;
      dropFocus.current = focus;
      // The fade starts on lifted -> dropping only; a second drop() does not
      // push the commit back.
      const fading = phase() === 'lifted';
      // measuring -> idle at once (backdrop, scroll lock); lifted -> dropping.
      send({ type: 'drop', slot: me() });
      if (!from) {
        // A pending (keyboard-wait) lift sees the new token and gives up.
        return;
      }
      // Never rendered (lift() and drop() in one batch): nothing showed, so
      // nothing to wait for.
      if (immediate || !wasLifted.current) {
        commit(null);
        return;
      }
      if (fading) {
        // A scaled view shrinks back over the move; a moved one is also
        // animated by settle.
        const scaled = place.current.scale !== 1;
        if (scaled) {
          liftScale.value = withTiming(1, latest.current.moveTiming);
        }
        fadeEnd.current =
          Date.now() +
          Math.max(
            latest.current.fadeOut ?? 0,
            scaled ? (latest.current.moveTiming?.duration ?? 300) : 0
          );
      }
      // The cut part lies outside the safe area here: shown again at once,
      // so the view grows back whole.
      setCut(NO_CUT);
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
    // commit() reads refs and stable context functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offsetX, offsetY, send]);

  // The menu and accessory render in the host but close over this slot's
  // props: re-render the host when they change while lifted.
  useLayoutEffect(() => {
    if (liftedRef.current) {
      refresh();
    }
  }, [renderMenu, renderAccessory, accessoryPosition, refresh]);

  // Rebound to another item while lifted: render it dropped in this very
  // commit (the overlay never shows the new item); the effect below syncs.
  const shown = lifted && lifted.key === itemKey ? lifted : null;
  const isLifted = shown !== null;
  const clipped = shown !== null && cut !== NO_CUT;
  useLayoutEffect(() => {
    // Rebound (itemKey), before or after the lifted render: finish the drop
    // the render above already shows.
    if (liftedRef.current && liftedRef.current.key !== itemKey) {
      dropToken.current++;
      commit(null);
    }
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
    // slot from lifting onto the layer before 'dropped'. Not when another
    // slot owns the layer (an Activity re-show of a slot dropped while
    // hidden): that would cut its drop animation.
    if (send({ type: 'dropped', slot: me() }).phase === 'idle') {
      offsetX.value = 0;
      offsetY.value = 0;
    }
    restore();
    onLiftEnd?.();
    // restore() and commit() read refs and stable context functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    lifted,
    itemKey,
    isLifted,
    onLiftStart,
    onLiftEnd,
    offsetX,
    offsetY,
    send,
  ]);

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
      accessible={
        accessible ?? (accessibilityActions?.length ? true : undefined)
      }
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
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
          {/* Rule 4: plain views, so the handoff path gains no animated
              component. Uncut, both just fill the container (layout only,
              flattened); cut, the outer one is the visible part and the inner
              one keeps the view's own size, shifted under it. */}
          <View style={clipped ? clipRect(shown, cut) : styles.fill}>
            <View style={clipped ? innerRect(shown, cut) : styles.fill}>
              {children}
            </View>
          </View>
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

const clipRect = ({ height }: Lifted, { top, bottom }: Cut) => ({
  overflow: 'hidden' as const,
  marginTop: top,
  height: height - top - bottom,
});

const innerRect = ({ height }: Lifted, { top }: Cut) => ({
  marginTop: -top,
  height,
});

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  absolute: { position: 'absolute' },
  // Measured before it is placed: invisible and untouchable meanwhile.
  hidden: { opacity: 0, left: 0, top: 0 },
  // Freeze flex so a `flex: 1` wrapper keeps its measured size once emptied.
  locked: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
});
