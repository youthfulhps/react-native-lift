import type { ReactNode } from 'react';
import type { Insets } from './engine/computeLayout';
import { LiftHost } from './engine/strategy/teleport';

// LiftHost renders teleport's PortalProvider plus our single PortalHost; the
// `root` host PortalProvider adds on its own is teleport's and unused here.
// `insets`: the safe area the menu and accessory stay inside, e.g.
// useSafeAreaInsets() from react-native-safe-area-context. Default 0. They
// are taken from the provider's edges: put it at the window origin (not
// inside a SafeAreaView), or the insets count twice.
export function LiftProvider({
  children,
  insets,
}: {
  children: ReactNode;
  insets?: Insets;
}) {
  return <LiftHost insets={insets}>{children}</LiftHost>;
}
