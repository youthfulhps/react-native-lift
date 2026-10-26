import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Liftable, useLiftScrollLock, type MenuItem } from 'react-native-lift';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Step 3.2 smoke: menu, accessory and layout around the lifted view. Rows at
// the top, middle and bottom, plus one too tall for the menu (it shrinks).
const ROWS = [
  { id: 'top', height: 64, accessory: true },
  { id: 'a', height: 64, accessory: false },
  { id: 'tall', height: 700, accessory: false },
  { id: 'b', height: 64, accessory: true },
  { id: 'bottom', height: 64, accessory: false },
];
const REACTIONS = ['👍', '❤️', '😂', '😮'];

export function MenuScreen() {
  const scrollEnabled = useLiftScrollLock();
  const [last, setLast] = useState('-');
  // Android 15 draws behind a 3-button nav bar: keep the last row above it.
  const { bottom } = useSafeAreaInsets();
  const items = (id: string): MenuItem[] => [
    { key: 'reply', title: 'Reply', onPress: () => setLast(`reply ${id}`) },
    { key: 'copy', title: 'Copy', onPress: () => setLast(`copy ${id}`) },
    {
      key: 'delete',
      title: 'Delete',
      destructive: true,
      onPress: () => setLast(`delete ${id}`),
    },
  ];
  return (
    <View style={styles.screen}>
      <Text testID="menu-last">{`last:${last}`}</Text>
      <ScrollView
        scrollEnabled={scrollEnabled}
        contentContainerStyle={{ paddingBottom: bottom }}
      >
        {ROWS.map((row) => (
          <Liftable
            key={row.id}
            menu={items(row.id)}
            renderAccessory={
              row.accessory
                ? (close) => (
                    <View style={styles.reactions}>
                      {REACTIONS.map((r) => (
                        <Pressable
                          key={r}
                          testID={`reaction-${r}`}
                          onPress={() => {
                            setLast(`${r} ${row.id}`);
                            close();
                          }}
                        >
                          <Text style={styles.reaction}>{r}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )
                : undefined
            }
            accessoryPosition={row.id === 'b' ? 'bottom' : 'top'}
          >
            <View
              testID={`menu-row-${row.id}`}
              style={[styles.row, { height: row.height }]}
            >
              <Text>{`row ${row.id}`}</Text>
            </View>
          </Liftable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: {
    margin: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#e7f0ff',
    justifyContent: 'center',
  },
  reactions: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    borderRadius: 24,
    backgroundColor: '#fff',
  },
  reaction: { fontSize: 28 },
});
