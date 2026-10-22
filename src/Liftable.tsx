import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { LiftSlot, type LiftSlotProps } from './engine/strategy/teleport';

export type LiftableProps = Omit<LiftSlotProps, 'scale'> & {
  scale?: SharedValue<number>;
};

export function Liftable({ scale, ...props }: LiftableProps) {
  const ownScale = useSharedValue(1);
  return <LiftSlot {...props} scale={scale ?? ownScale} />;
}
