import { useVideoPlayer, VideoView } from 'expo-video';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Liftable, useLiftScrollLock } from 'react-native-lift';
import { liftHaptic } from '../recipes/haptics';

// AC-D2: a video feed. The playing view itself is lifted: it keeps playing,
// where a copy would restart (see the compare tab).
const SOURCE = require('../../assets/poc-video.mp4');
const POSTS = Array.from({ length: 6 }, (_, i) => ({
  id: i,
  title: `Clip ${i + 1}`,
}));

export function Clip() {
  const player = useVideoPlayer(SOURCE, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  // pointerEvents none: on Android a long press that starts on the native
  // video view leaves the overlay's touches dead until the drop (it takes
  // the touch, then moves mid-gesture). These clips need no touches anyway.
  return (
    <View pointerEvents="none">
      <VideoView player={player} nativeControls={false} style={styles.video} />
    </View>
  );
}

export function VideoFeedScreen() {
  const scrollEnabled = useLiftScrollLock();
  return (
    <FlatList
      data={POSTS}
      keyExtractor={(p) => String(p.id)}
      scrollEnabled={scrollEnabled}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <View style={styles.post}>
          <Text style={styles.title}>{item.title}</Text>
          <Liftable
            haptics={liftHaptic}
            menu={[
              { key: 'save', title: 'Save', onPress: () => {} },
              { key: 'hide', title: 'Not interested', onPress: () => {} },
            ]}
          >
            <Clip />
          </Liftable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, gap: 16 },
  post: { gap: 6 },
  title: { fontWeight: '600' },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    backgroundColor: '#000',
  },
});
