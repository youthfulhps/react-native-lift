import { useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Liftable, useLiftScrollLock } from 'react-native-lift';
import { blurBackdrop } from '../recipes/blurBackdrop';
import { liftHaptic } from '../recipes/haptics';

// AC-D2: a photo grid, lifted over the blur recipe (iOS; a dim on Android).
const SIZE = Dimensions.get('window').width / 3;
const PHOTOS = Array.from({ length: 30 }, (_, i) => ({
  id: i + 10,
  uri: `https://picsum.photos/id/${i + 10}/400`,
}));

export function PhotoGridScreen() {
  const scrollEnabled = useLiftScrollLock();
  const [photos, setPhotos] = useState(PHOTOS);
  const [liked, setLiked] = useState<number[]>([]);
  return (
    <FlatList
      data={photos}
      numColumns={3}
      keyExtractor={(p) => String(p.id)}
      scrollEnabled={scrollEnabled}
      renderItem={({ item }) => (
        <Liftable
          haptics={liftHaptic}
          renderBackdrop={blurBackdrop}
          menu={[
            {
              key: 'like',
              title: liked.includes(item.id) ? 'Unlike' : 'Like',
              onPress: () =>
                setLiked((cur) =>
                  cur.includes(item.id)
                    ? cur.filter((id) => id !== item.id)
                    : [...cur, item.id]
                ),
            },
            { key: 'share', title: 'Share', onPress: () => {} },
            {
              key: 'delete',
              title: 'Delete',
              destructive: true,
              onPress: () =>
                setPhotos((cur) => cur.filter((p) => p.id !== item.id)),
            },
          ]}
        >
          <View style={styles.tile}>
            <Image source={{ uri: item.uri }} style={styles.image} />
            {liked.includes(item.id) && <Text style={styles.like}>♥</Text>}
          </View>
        </Liftable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  tile: { width: SIZE, height: SIZE, padding: 1 },
  image: { flex: 1, backgroundColor: '#ccd' },
  like: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    color: '#fff',
    fontSize: 18,
  },
});
