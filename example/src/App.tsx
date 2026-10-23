import { useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LiftProvider } from 'react-native-lift';
import { FlatListScreen } from './poc/FlatListScreen';
import { GesturesScreen } from './poc/GesturesScreen';
import { KeyboardChatScreen } from './poc/KeyboardChatScreen';
import { ScrollConflictScreen } from './poc/ScrollConflictScreen';
import { SystemScreen } from './poc/SystemScreen';
import { VideoScreen } from './poc/VideoScreen';

// PoC screens; the Maestro flows in example/.maestro/poc tap these tabs.
const SCREENS = {
  harness: FlatListScreen,
  gestures: GesturesScreen,
  chat: KeyboardChatScreen,
  video: VideoScreen,
  scroll: ScrollConflictScreen,
  system: SystemScreen,
};

export default function App() {
  const [screen, setScreen] = useState<keyof typeof SCREENS>('harness');
  const Screen = SCREENS[screen];
  return (
    <GestureHandlerRootView style={styles.root}>
      <LiftProvider>
        <View style={styles.tabs}>
          {(Object.keys(SCREENS) as (keyof typeof SCREENS)[]).map((key) => (
            <Pressable
              key={key}
              testID={`tab-${key}`}
              style={[styles.tab, key === screen && styles.tabOn]}
              onPress={() => {
                // poc-auto.py --maestro reads the window width (dp) from this.
                const win = Dimensions.get('window');
                console.log(
                  `POC SCREEN name=${key} win=${win.width}x${win.height}`
                );
                setScreen(key);
              }}
            >
              <Text>{key}</Text>
            </Pressable>
          ))}
        </View>
        <Screen />
      </LiftProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: { flexDirection: 'row', gap: 4, paddingTop: 54, paddingHorizontal: 8 },
  tab: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6 },
  tabOn: { backgroundColor: '#cde' },
});
