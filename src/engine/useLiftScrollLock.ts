import { useContext } from 'react';
import { LiftContext } from './strategy/teleport';

// Wire to `scrollEnabled`: false while any view is lifted (AC-E4).
export function useLiftScrollLock() {
  const ctx = useContext(LiftContext);
  if (!ctx) {
    throw new Error('react-native-lift: wrap your app in <LiftProvider>');
  }
  return !ctx.active;
}
