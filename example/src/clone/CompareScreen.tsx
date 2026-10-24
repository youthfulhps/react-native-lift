import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Liftable } from 'react-native-lift';
import { Clip } from '../examples/VideoFeedScreen';
import { CloneLiftable } from './CloneLiftable';

// AC-D3: the same video + text field cell, lifted (teleport) or copied
// (clone). Type something, let the video run, then long press it.
function Cell() {
  return (
    <View style={styles.cell}>
      <Clip />
      <TextInput
        style={styles.input}
        placeholder="Type here, then long press"
      />
    </View>
  );
}

export function CompareScreen() {
  const [mode, setMode] = useState<'teleport' | 'clone'>('teleport');
  return (
    <View style={styles.screen}>
      <Pressable
        testID="compare-mode"
        style={styles.toggle}
        onPress={() =>
          setMode((m) => (m === 'teleport' ? 'clone' : 'teleport'))
        }
      >
        <Text>{`mode: ${mode} (tap to switch)`}</Text>
      </Pressable>
      {mode === 'teleport' ? (
        <Liftable menu={[{ key: 'close', title: 'Close', onPress: () => {} }]}>
          <Cell />
        </Liftable>
      ) : (
        <CloneLiftable>
          <Cell />
        </CloneLiftable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12 },
  toggle: { padding: 10, borderRadius: 8, backgroundColor: '#ddd' },
  cell: { gap: 8, padding: 8, borderRadius: 12, backgroundColor: '#fff' },
  input: { padding: 8, borderRadius: 8, backgroundColor: '#f0f2f5' },
});
