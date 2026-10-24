import * as Haptics from 'expo-haptics';

// Recipe (AC-D5): the `haptics` adapter. Liftable calls it once, when a long
// press lifts the view; call it yourself when you lift with ref.lift().
export const liftHaptic = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
};
