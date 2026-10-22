import type { ReactNode } from 'react';
import { LiftHost } from './engine/strategy/teleport';

// LiftHost renders teleport's PortalProvider plus our single PortalHost; the
// `root` host PortalProvider adds on its own is teleport's and unused here.
export function LiftProvider({ children }: { children: ReactNode }) {
  return <LiftHost>{children}</LiftHost>;
}
