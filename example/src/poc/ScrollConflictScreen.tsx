import { FlashList } from '@shopify/flash-list';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSharedValue, withSpring } from 'react-native-reanimated';
import { Liftable, useLiftScrollLock } from 'react-native-lift';

// P10 config (i): plain RN lists + long press (maxDistance) + scroll lock.
// Driven by example/.maestro/poc/p10-scroll-*.yaml.
const ROWS = Array.from({ length: 40 }, (_, i) => i);
const KINDS = ['ScrollView', 'FlatList', 'FlashList'] as const;

function Row({
  index,
  onLift,
}: {
  index: number;
  onLift: (on: boolean) => void;
}) {
  const scale = useSharedValue(1);
  return (
    <Liftable
      scale={scale}
      onLiftStart={() => {
        onLift(true);
        scale.value = withSpring(1);
      }}
      onLiftEnd={() => onLift(false)}
    >
      <View style={styles.row}>
        <Text>{`row ${index}`}</Text>
      </View>
    </Liftable>
  );
}

export function ScrollConflictScreen() {
  const [kind, setKind] = useState<(typeof KINDS)[number]>('ScrollView');
  const [lifts, setLifts] = useState(0);
  const [lifted, setLifted] = useState(false);
  const [y, setY] = useState(0);
  const scrollEnabled = useLiftScrollLock();
  const onLift = (on: boolean) => {
    setLifted(on);
    if (on) {
      setLifts((n) => n + 1);
    }
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setY(Math.round(e.nativeEvent.contentOffset.y));
  const list = {
    scrollEnabled,
    onScroll,
    scrollEventThrottle: 16,
    testID: 'conflict-list',
  };
  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        {KINDS.map((k) => (
          <Pressable
            key={k}
            testID={`kind-${k}`}
            style={[styles.kind, k === kind && styles.kindOn]}
            onPress={() => {
              setKind(k);
              setY(0);
              setLifts(0);
            }}
          >
            <Text>{k}</Text>
          </Pressable>
        ))}
      </View>
      <Text testID="conflict-status">{`lifts:${lifts} lifted:${+lifted}`}</Text>
      <Text testID="conflict-y">{`y:${y}`}</Text>
      {kind === 'ScrollView' ? (
        <ScrollView {...list}>
          {ROWS.map((i) => (
            <Row key={i} index={i} onLift={onLift} />
          ))}
        </ScrollView>
      ) : kind === 'FlatList' ? (
        <FlatList
          {...list}
          data={ROWS}
          keyExtractor={String}
          renderItem={({ item }) => <Row index={item} onLift={onLift} />}
        />
      ) : (
        <FlashList
          {...list}
          data={ROWS}
          keyExtractor={String}
          renderItem={({ item }) => <Row index={item} onLift={onLift} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: 'row', gap: 8, padding: 8 },
  kind: { padding: 8, backgroundColor: '#ddd', borderRadius: 6 },
  kindOn: { backgroundColor: '#9bd' },
  row: {
    height: 64,
    paddingLeft: 16,
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
