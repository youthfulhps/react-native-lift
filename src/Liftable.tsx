import { useImperativeHandle, useRef, type Ref } from 'react';
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
import type { LiftHandle } from './types';

export type LiftableProps = Omit<
  LiftSlotProps,
  'scale' | 'ref' | 'onLiftCancel'
> & {
  ref?: Ref<LiftHandle>;
  // The press scale (0.95 while pressed). Pass your own to animate it after
  // a lift; without one, Liftable springs it back to 1 when the view lifts.
  scale?: SharedValue<number>;
  // Long press lifts (default true). False: lift only through the ref.
  longPress?: boolean;
};

export function Liftable({
  scale,
  longPress = true,
  onLiftStart,
  ref,
  ...props
}: LiftableProps) {
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
    onLift: () => {
      // Rejected (another view is lifted, no layout yet): undo the press.
      if (!slot.current?.lift()) {
        pressScale.value = withSpring(1);
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
        onLiftCancel={() => {
          pressScale.value = withSpring(1);
        }}
        onLiftStart={() => {
          if (!scale) {
            ownScale.value = withSpring(1);
          }
          onLiftStart?.();
        }}
      />
    </GestureDetector>
  );
}
