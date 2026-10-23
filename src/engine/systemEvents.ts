import { useEffect } from 'react';
import { AppState, BackHandler, Dimensions } from 'react-native';
import type { LiftHandle } from '../types';

// AC-E9 while a view is lifted: rotation (any window change) and going to the
// background drop it at once, with no animation into a layout that is about
// to change. Android back drops it the normal way and is consumed, so the
// screen behind does not navigate in the same press.
export function useSystemDrop(active: LiftHandle | null) {
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const subs = [
      Dimensions.addEventListener('change', () =>
        active.drop({ immediate: true })
      ),
      AppState.addEventListener('change', (state) => {
        if (state === 'background') {
          active.drop({ immediate: true });
        }
      }),
      BackHandler.addEventListener('hardwareBackPress', () => {
        active.drop();
        return true;
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [active]);
}
