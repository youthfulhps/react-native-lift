// AC-E6: after a drop, give focus back to the input lift took it from,
// unless the Liftable (`restoreFocus`) or the drop itself (a menu item's
// `restoreFocus`, e.g. it navigates) opted out, or something else has focus
// by now (the menu action focused another input).
export function focusToRestore<T>(
  saved: T | null,
  current: T | null | undefined,
  opts: { liftable: boolean; drop: boolean }
): T | null {
  return saved && opts.liftable && opts.drop && !current ? saved : null;
}
