import { Fragment } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MenuItem } from '../types';

// Default menu (AC-U1): an iOS-style context menu. A press runs the item,
// then closes (drops) with the item's restoreFocus.
export function Menu({
  items,
  close,
}: {
  items: readonly MenuItem[];
  close: (opts?: { restoreFocus?: boolean }) => void;
}) {
  return (
    <View testID="lift-menu-default" style={styles.menu}>
      {items.map((item, i) => (
        <Fragment key={item.key}>
          {i > 0 && <View style={styles.separator} />}
          <Pressable
            testID={`lift-menu-item-${item.key}`}
            accessibilityRole="menuitem"
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            onPress={() => {
              item.onPress();
              close({ restoreFocus: item.restoreFocus ?? true });
            }}
          >
            <Text
              style={[styles.title, item.destructive && styles.destructive]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {item.icon}
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    width: 250,
    borderRadius: 13,
    overflow: 'hidden',
    backgroundColor: 'rgba(249, 249, 249, 0.96)',
  },
  item: {
    minHeight: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pressed: { backgroundColor: 'rgba(0, 0, 0, 0.08)' },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60, 60, 67, 0.29)',
  },
  title: { flexShrink: 1, fontSize: 17, color: '#000' },
  destructive: { color: '#FF3B30' },
});
