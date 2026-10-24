import type { ReactNode } from 'react';

export type LiftHandle = {
  lift(): void;
  drop(opts?: { immediate?: boolean }): void;
};

// A menu entry (AC-U1). restoreFocus: false skips the focus restore after
// this item's drop (e.g. it navigates); default true.
export type MenuItem = {
  key: string;
  title: string;
  icon?: ReactNode;
  destructive?: boolean;
  onPress: () => void;
  restoreFocus?: boolean;
};
