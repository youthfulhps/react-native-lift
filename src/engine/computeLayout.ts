export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Insets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type LayoutInput = {
  viewRect: Rect;
  menuSize: Size;
  accessorySize?: Size;
  accessoryPosition?: 'top' | 'bottom';
  safeArea: Insets;
  screen: Size;
  minScale?: number;
  gap?: number;
};

export type LayoutResult = {
  /** Visual rect of the lifted view after shift and scale, before clipping. */
  viewRect: Rect;
  scale: number;
  clip?: { side: 'top' | 'bottom'; amount: number };
  menuRect: Rect;
  accessoryRect?: Rect;
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(v, hi));

// ponytail: assumes menu + accessory alone fit the safe height; if not, they overflow the bottom edge.
export function computeLayout({
  viewRect: view,
  menuSize: menu,
  accessorySize: acc,
  accessoryPosition = 'top',
  safeArea,
  screen,
  minScale = 0.5,
  gap = 8,
}: LayoutInput): LayoutResult {
  const top = safeArea.top;
  const bottom = screen.height - safeArea.bottom;
  const left = safeArea.left;
  const right = screen.width - safeArea.right;

  const accTop = accessoryPosition === 'top';
  const accSpan = acc ? acc.height + gap : 0;
  const menuSpan = menu.height + gap;

  // 1. Menu below the view if the below-side stack fits there, otherwise above.
  const menuBelow =
    view.y + view.height + (accTop ? 0 : accSpan) + menuSpan <= bottom;
  // 6. Accessory hugs the view on its side; the menu is outermost on its side.
  const above = (accTop ? accSpan : 0) + (menuBelow ? 0 : menuSpan);
  const below = (accTop ? 0 : accSpan) + (menuBelow ? menuSpan : 0);
  const room = bottom - top - above - below;

  // 3./4. Scale down to fit, not below minScale; clip what still overflows.
  let scale = 1;
  let clipAmount = 0;
  if (view.height * minScale > room) {
    scale = minScale;
    clipAmount = view.height * minScale - room;
  } else if (view.height > room) {
    scale = room / view.height;
  }

  const width = view.width * scale;
  const height = view.height * scale;
  const visible = height - clipAmount;
  // 2. Shift the (centre-scaled) view only as much as needed to keep the stack inside.
  const visibleTop = clamp(
    view.y + (view.height - height) / 2,
    top + above,
    bottom - below - visible
  );
  const visibleBottom = visibleTop + visible;

  const viewRect = {
    x: view.x + (view.width - width) / 2,
    // Clip is opposite the menu: with the menu below, the hidden part is on top.
    y: menuBelow ? visibleTop - clipAmount : visibleTop,
    width,
    height,
  };

  // 5. Menu/accessory start at the view's left edge, with x clamped into the safe region.
  const placeX = (w: number) => clamp(viewRect.x, left, right - w);

  return {
    viewRect,
    scale,
    ...(clipAmount > 0 && {
      clip: { side: menuBelow ? 'top' : 'bottom', amount: clipAmount },
    }),
    menuRect: {
      x: placeX(menu.width),
      y: menuBelow ? visibleBottom + below - menu.height : visibleTop - above,
      width: menu.width,
      height: menu.height,
    },
    ...(acc && {
      accessoryRect: {
        x: placeX(acc.width),
        y: accTop ? visibleTop - accSpan : visibleBottom + gap,
        width: acc.width,
        height: acc.height,
      },
    }),
  };
}
