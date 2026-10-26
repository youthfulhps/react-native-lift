import { Dimensions } from 'react-native';

export type Rect = { x: number; y: number; width: number; height: number };

// What is measured: a host view's instance. Structural, so the published
// types do not name `HostInstance`, which older supported RN types lack.
export type HostView = { getBoundingClientRect(): Rect };

// Synchronous window rect from the shadow tree, transforms included. Host
// instances expose it by default from RN 0.82 (enableAccessToHostTreeInFabric),
// which sets the supported floor.
export const windowRect = (
  view: HostView | null | undefined
): Rect | undefined => view?.getBoundingClientRect();

// False when the view is gone (0x0) or entirely off screen: there is nowhere
// to animate to, so a drop commits immediately.
export function isUsable(rect: Rect | undefined): rect is Rect {
  const win = Dimensions.get('window');
  return (
    !!rect &&
    !(rect.width === 0 && rect.height === 0) &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0 &&
    rect.x < win.width &&
    rect.y < win.height
  );
}
