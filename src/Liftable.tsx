import { useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import {
  LiftSlot,
  type ChromeState,
  type LiftSlotProps,
  type SlotHandle,
} from './engine/strategy/teleport';
import { useLiftGesture } from './engine/useLiftGesture';
import { Appear } from './presentation/Appear';
import { DimBackdrop, type BackdropState } from './presentation/DimBackdrop';
import { Menu } from './presentation/Menu';
import { mergeMotion, type MotionOverride } from './presentation/motion';
import type { LiftHandle, MenuItem } from './types';

type Close = ChromeState['close'];
type ChromeRender = (state: ChromeState) => ReactNode;

export type LiftableProps = Omit<
  LiftSlotProps,
  | 'scale'
  | 'ref'
  | 'onLiftCancel'
  | 'moveTiming'
  | 'renderBackdrop'
  | 'renderMenu'
  | 'renderAccessory'
  | 'fadeOut'
  | 'accessibilityActions'
  | 'onAccessibilityAction'
> & {
  ref?: Ref<LiftHandle>;
  // The press scale (0.95 while pressed). Pass your own to animate it after
  // a lift; without one, Liftable springs it back to 1 when the view lifts.
  scale?: SharedValue<number>;
  // Long press lifts (default true). False: lift only through the ref.
  longPress?: boolean;
  // No lift at all: no long press, ref.lift() does nothing, no
  // accessibility actions (AC-U4).
  disabled?: boolean;
  // Override any motion value (AC-M1); the rest keep their defaults.
  motion?: MotionOverride;
  // Replaces the default dim (AC-M3), e.g. with a blur. Animate on
  // `visible` over motion.backdrop.duration: a drop puts the view back once
  // that fade is done. Drops with no animation (rotation, background,
  // unmount, itemKey change, drop({ immediate: true })) remove it at once.
  // Return an element and keep hooks inside its component (the host may
  // reuse one instance across owners). It receives no touches: a tap
  // anywhere outside the lifted view drops it.
  renderBackdrop?: (state: BackdropState) => ReactNode;
  // Shown next to the lifted view (AC-U1), and as its accessibility actions
  // (AC-E7, which run the item without a lift).
  menu?: readonly MenuItem[];
  // Replaces the default menu (AC-U2); close() drops the view.
  // renderMenu and renderAccessory render in the overlay under
  // LiftProvider: read context (navigation, theme) in your own component
  // and close over it; hooks inside them see LiftProvider's context.
  renderMenu?: (items: readonly MenuItem[], close: Close) => ReactNode;
  // E.g. a reaction bar, above the view (default) or below it (AC-U3).
  renderAccessory?: (close: Close) => ReactNode;
  // Called once when a long press lifts the view (AC-M4), e.g. a haptic.
  haptics?: () => void;
};

export function Liftable({
  scale,
  longPress = true,
  disabled = false,
  onLiftStart,
  motion: override,
  renderBackdrop,
  menu,
  renderMenu,
  renderAccessory,
  haptics,
  ref,
  ...props
}: LiftableProps) {
  const motion = mergeMotion(override);
  const ownScale = useSharedValue(1);
  const pressScale = scale ?? ownScale;
  const slot = useRef<SlotHandle>(null);
  useImperativeHandle(ref, () => ({
    lift: () => {
      if (!disabled) {
        slot.current?.lift();
      }
    },
    drop: (opts) => slot.current?.drop(opts),
  }));
  const gesture = useLiftGesture({
    scale: pressScale,
    press: motion.press,
    release: motion.release,
    onLift: () => {
      // Accepted: haptics now, even if the teleport waits for the keyboard.
      // Rejected (another view is lifted, no layout yet): undo the press.
      const lifted = slot.current?.lift();
      if (lifted === 'new') {
        haptics?.();
      } else if (!lifted) {
        pressScale.value = withSpring(1, motion.release);
      }
    },
    enabled: longPress && !disabled,
  });
  const items = menu ?? [];
  const appear = (content: ReactNode, { visible }: ChromeState) => (
    <Appear visible={visible} motion={motion.menu}>
      {content}
    </Appear>
  );
  const menuRender: ChromeRender | undefined = renderMenu
    ? (state) => appear(renderMenu(items, state.close), state)
    : items.length
      ? (state) => appear(<Menu items={items} close={state.close} />, state)
      : undefined;
  const accessoryRender: ChromeRender | undefined =
    renderAccessory && ((state) => appear(renderAccessory(state.close), state));
  const actions =
    disabled || !items.length
      ? undefined
      : items.map((item) => ({ name: item.title, label: item.title }));
  return (
    <GestureDetector gesture={gesture}>
      <LiftSlot
        {...props}
        ref={slot}
        scale={pressScale}
        moveTiming={motion.drop}
        fadeOut={
          menuRender || accessoryRender
            ? Math.max(motion.backdrop.duration, motion.menu.duration)
            : motion.backdrop.duration
        }
        renderBackdrop={
          renderBackdrop ??
          ((state) => <DimBackdrop {...state} motion={motion.backdrop} />)
        }
        renderMenu={menuRender}
        renderAccessory={accessoryRender}
        accessibilityActions={actions}
        onAccessibilityAction={
          actions &&
          ((e) =>
            items
              .find((item) => item.title === e.nativeEvent.actionName)
              ?.onPress())
        }
        onLiftCancel={() => {
          pressScale.value = withSpring(1, motion.release);
        }}
        onLiftStart={() => {
          if (!scale) {
            ownScale.value = withSpring(1, motion.release);
          }
          onLiftStart?.();
        }}
      />
    </GestureDetector>
  );
}
