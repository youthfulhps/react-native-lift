import { useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import {
  LiftSlot,
  type LiftSlotProps,
  type SlotHandle,
} from './engine/strategy/teleport';
import { useLiftGesture } from './engine/useLiftGesture';
import { DimBackdrop, type BackdropState } from './presentation/DimBackdrop';
import { mergeMotion, type MotionOverride } from './presentation/motion';
import type { LiftHandle } from './types';

export type LiftableProps = Omit<
  LiftSlotProps,
  'scale' | 'ref' | 'onLiftCancel' | 'dropTiming' | 'renderBackdrop'
> & {
  ref?: Ref<LiftHandle>;
  // The press scale (0.95 while pressed). Pass your own to animate it after
  // a lift; without one, Liftable springs it back to 1 when the view lifts.
  scale?: SharedValue<number>;
  // Long press lifts (default true). False: lift only through the ref.
  longPress?: boolean;
  // Override any motion value (AC-M1); the rest keep their defaults.
  motion?: MotionOverride;
  // Replaces the default dim (AC-M3), e.g. with a blur.
  renderBackdrop?: (state: BackdropState) => ReactNode;
  // Called once when a long press lifts the view (AC-M4), e.g. a haptic.
  haptics?: () => void;
};

export function Liftable({
  scale,
  longPress = true,
  onLiftStart,
  motion: override,
  renderBackdrop,
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
      slot.current?.lift();
    },
    drop: (opts) => slot.current?.drop(opts),
  }));
  const gesture = useLiftGesture({
    scale: pressScale,
    press: motion.press,
    release: motion.release,
    onLift: () => {
      // Accepted: feedback now, with the backdrop, even if the teleport
      // waits for the keyboard. Rejected (another view is lifted, no layout
      // yet): undo the press.
      if (slot.current?.lift()) {
        haptics?.();
      } else {
        pressScale.value = withSpring(1, motion.release);
      }
    },
    enabled: longPress,
  });
  return (
    <GestureDetector gesture={gesture}>
      <LiftSlot
        {...props}
        ref={slot}
        scale={pressScale}
        dropTiming={motion.drop}
        renderBackdrop={
          renderBackdrop ??
          ((state) => <DimBackdrop {...state} motion={motion.backdrop} />)
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
