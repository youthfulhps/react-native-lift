import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CompareScreen } from '../clone/CompareScreen';
import { MenuScreen } from '../poc/MenuScreen';
import { ChatScreen } from './ChatScreen';
import { PhotoGridScreen } from './PhotoGridScreen';
import { VideoFeedScreen } from './VideoFeedScreen';

// Step 4.1 examples behind one PoC tab, so the PoC tab bar keeps its layout.
const SCREENS = {
  chat: ChatScreen,
  photos: PhotoGridScreen,
  videos: VideoFeedScreen,
  compare: CompareScreen,
  menu: MenuScreen,
};

export function ExamplesScreen() {
  const [screen, setScreen] = useState<keyof typeof SCREENS>('chat');
  const Screen = SCREENS[screen];
  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {(Object.keys(SCREENS) as (keyof typeof SCREENS)[]).map((key) => (
          <Pressable
            key={key}
            testID={`ex-${key}`}
            style={[styles.tab, key === screen && styles.tabOn]}
            onPress={() => setScreen(key)}
          >
            <Text>{key}</Text>
          </Pressable>
        ))}
      </View>
      <Screen />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  tab: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6 },
  tabOn: { backgroundColor: '#fde3c8' },
});
