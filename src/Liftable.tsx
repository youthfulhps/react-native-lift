import { useImperativeHandle, useRef } from 'react';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { LiftSlot, type LiftSlotProps } from './engine/strategy/teleport';
import { useLiftGesture } from './engine/useLiftGesture';
import type { LiftHandle } from './types';

export type LiftableProps = Omit<LiftSlotProps, 'scale'> & {
  scale?: SharedValue<number>;
  // Long press lifts (default true). False: lift only through the ref.
  longPress?: boolean;
};

export function Liftable({
  scale,
  longPress = true,
  ref,
  ...props
}: LiftableProps) {
  const ownScale = useSharedValue(1);
  const pressScale = scale ?? ownScale;
  const slot = useRef<LiftHandle>(null);
  useImperativeHandle(ref, () => ({
    lift: () => slot.current?.lift(),
    drop: (opts) => slot.current?.drop(opts),
  }));
  const gesture = useLiftGesture({
    scale: pressScale,
    onLift: () => slot.current?.lift(),
    enabled: longPress,
  });
  return (
    <GestureDetector gesture={gesture}>
      <LiftSlot {...props} ref={slot} scale={pressScale} />
    </GestureDetector>
  );
}
