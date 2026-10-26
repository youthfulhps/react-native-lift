import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Liftable, useLiftScrollLock } from 'react-native-lift';

// Regression check: alignSelf on a Liftable in a ScrollView once grew its
// slot to the scroll view's height. The red tint is the slot: in both modes
// it must hug the bubble. "row" aligns with an outer row View instead.
const MESSAGES = [
  { id: 1, text: 'Are we still on for tonight?', mine: false },
  { id: 2, text: 'Yes! 7 at the ramen place?', mine: true },
  { id: 3, text: 'Perfect', mine: false },
];
const MENU = [{ key: 'reply', title: 'Reply', onPress: () => {} }];

export function AlignSelfScreen() {
  const scrollEnabled = useLiftScrollLock();
  const [mode, setMode] = useState<'alignSelf' | 'row'>('alignSelf');
  return (
    <View style={styles.screen}>
      <Pressable
        testID="align-mode"
        style={styles.toggle}
        onPress={() =>
          setMode((m) => (m === 'alignSelf' ? 'row' : 'alignSelf'))
        }
      >
        <Text>
          {mode === 'alignSelf'
            ? 'alignSelf on Liftable — tap to switch'
            : 'outer row View — tap to switch'}
        </Text>
      </Pressable>
      <ScrollView
        scrollEnabled={scrollEnabled}
        contentContainerStyle={styles.list}
      >
        {MESSAGES.map((m) => {
          const bubble = (
            <View style={[styles.bubble, m.mine && styles.mine]}>
              <Text style={m.mine && styles.textMine}>{m.text}</Text>
            </View>
          );
          return mode === 'alignSelf' ? (
            <Liftable
              key={m.id}
              menu={MENU}
              style={[styles.slot, m.mine ? styles.end : styles.start]}
            >
              {bubble}
            </Liftable>
          ) : (
            <View
              key={m.id}
              style={[styles.row, m.mine ? styles.rowEnd : styles.rowStart]}
            >
              <Liftable menu={MENU} style={styles.slot}>
                {bubble}
              </Liftable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  toggle: { margin: 12, padding: 10, borderRadius: 8, backgroundColor: '#ddd' },
  list: { paddingHorizontal: 12, gap: 6 },
  slot: { maxWidth: '75%', backgroundColor: 'rgba(255, 0, 0, 0.15)' },
  start: { alignSelf: 'flex-start' },
  end: { alignSelf: 'flex-end' },
  row: { flexDirection: 'row' },
  rowStart: { justifyContent: 'flex-start' },
  rowEnd: { justifyContent: 'flex-end' },
  bubble: {
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 19,
    backgroundColor: '#e9e9eb',
  },
  mine: { backgroundColor: '#0a84ff' },
  textMine: { color: '#fff' },
});
