import { useFocusEffect } from '@react-navigation/native';
import { useCallback, type RefObject } from 'react';
import type { LiftHandle } from 'react-native-lift';

// Recipe (React Navigation): a screen that stays mounted under a pushed one
// keeps its Liftables, so drop when it loses focus. Immediate: the screen is
// already animating away.
export function useDropOnBlur(ref: RefObject<LiftHandle | null>) {
  useFocusEffect(
    useCallback(() => () => ref.current?.drop({ immediate: true }), [ref])
  );
}
