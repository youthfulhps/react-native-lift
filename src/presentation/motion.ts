import type {
  WithSpringConfig,
  WithTimingConfig,
} from 'react-native-reanimated';

// Every motion value, one set for both platforms (AC-M1). The defaults are
// what the PoC measured (Reanimated 4's default spring and timing);
// tune them by eye against the iOS system menu, never per platform.
export const defaultMotion = {
  // Shrink while the long press is pending.
  press: { scale: 0.95, duration: 150 },
  // Back to scale 1 once lifted, or when the press is cancelled.
  release: { mass: 4, damping: 120, stiffness: 900 } as WithSpringConfig,
  // The animated drop back into the slot.
  drop: { duration: 300 } as WithTimingConfig,
  // The default dim backdrop.
  backdrop: { opacity: 0.25, duration: 200 },
};

export type Motion = typeof defaultMotion;
export type MotionOverride = {
  press?: Partial<Motion['press']>;
  // A spring is either physics- or duration-based, so it is replaced whole.
  release?: WithSpringConfig;
  drop?: WithTimingConfig;
  backdrop?: Partial<Motion['backdrop']>;
};

// `motion` prop: override any value, keep the rest.
export function mergeMotion(override?: MotionOverride): Motion {
  if (!override) {
    return defaultMotion;
  }
  return {
    press: { ...defaultMotion.press, ...override.press },
    release: override.release ?? defaultMotion.release,
    drop: { ...defaultMotion.drop, ...override.drop },
    backdrop: { ...defaultMotion.backdrop, ...override.backdrop },
  };
}
