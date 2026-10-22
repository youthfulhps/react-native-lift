import { createRef, memo, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type HostInstance,
  type TextInputInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedRef,
  useSharedValue,
} from 'react-native-reanimated';
import { Liftable, useLiftRef } from 'react-native-lift';
import {
  cells,
  mounts,
  runAutoLoop,
  runMovedDrop,
  type CellEntry,
} from './autoLoop';
import { useProbe } from './probe';

const ROW_H = 72;
const DATA = Array.from({ length: 120 }, (_, i) => i);

type Kind = 'normal' | 'flex' | 'percent' | 'input';
const KINDS: Kind[] = ['normal', 'flex', 'percent'];
const kindOf = (i: number): Kind => (i === 3 ? 'input' : KINDS[i % 3]!);

const liftableStyle: Record<Kind, StyleProp<ViewStyle>> = {
  normal: undefined,
  input: undefined,
  flex: { flex: 1 },
  percent: { width: '60%' },
};

const Cell = memo(function CellView({
  index,
  active,
}: {
  index: number;
  active: boolean;
}) {
  const kind = kindOf(index);
  const handle = useLiftRef();
  const cellRef = useRef<HostInstance>(null);
  const contentRef = useRef<HostInstance>(null);
  const scale = useSharedValue(1);
  const marker = useAnimatedRef<View>();
  const fill = useAnimatedRef<View>();
  const probe = useProbe(marker, fill);
  const [entry] = useState<CellEntry>(() => ({
    index,
    handle,
    scale,
    probe,
    // Content fills container fills wrapper (when not lifted), so this is the
    // wrapper's rect: catches a collapsed wrapper or leftover translate.
    rect: () => contentRef.current?.getBoundingClientRect(),
    cellRect: () => cellRef.current?.getBoundingClientRect(),
    layout: { width: 0, height: 0 },
  }));

  useEffect(() => {
    mounts.set(index, (mounts.get(index) ?? 0) + 1);
  }, [index]);

  useEffect(() => {
    entry.index = index;
    cells.set(index, entry);
    return () => {
      if (cells.get(index) === entry) {
        cells.delete(index);
      }
    };
  }, [entry, index]);

  return (
    <View
      ref={cellRef}
      collapsable={false}
      style={[styles.cell, kind === 'flex' && styles.row]}
    >
      <Liftable
        ref={handle}
        scale={scale}
        style={liftableStyle[kind]}
        onLiftStart={() => {
          if (entry.ctx) {
            probe.mark('lift', entry.ctx);
          }
          entry.onLiftStart?.();
        }}
        onLiftEnd={() => {
          if (entry.ctx) {
            probe.mark('drop', entry.ctx);
          }
          entry.onLiftEnd?.();
        }}
      >
        <View ref={contentRef} collapsable={false} style={styles.content}>
          <Animated.View
            ref={fill}
            collapsable={false}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            onLayout={(e) => {
              entry.layout = e.nativeEvent.layout;
            }}
          />
          <Text style={styles.label}>
            #{index} {kind}
          </Text>
          {kind === 'input' && (
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="type, then lift"
            />
          )}
          {/* Only the autoLoop target is #FF00FF, so pixel-check sees one marker. */}
          <Animated.View
            ref={marker}
            collapsable={false}
            style={[styles.marker, active && styles.markerActive]}
          />
        </View>
      </Liftable>
    </View>
  );
});

const inputRef = createRef<TextInputInstance>();

type Scenario = 'autoLoop' | 'momentum' | 'settled';
// Cell 21 is a 'normal' row; start it mid-screen and scroll 2 rows while lifted.
const MOVED = { target: 21, base: 21 * ROW_H - 300, shift: 2 * ROW_H };

export function FlatListScreen() {
  const list = useRef<FlatList<number>>(null);
  const [clipped, setClipped] = useState(false);
  const [inverted, setInverted] = useState(false);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(0);
  // Also shown on screen: iOS release builds don't surface console.log.
  const [status, setStatus] = useState('idle');

  const run = async (scenario: Scenario = 'autoLoop') => {
    setRunning(true);
    setStatus(`${scenario}…`);
    try {
      setStatus(
        scenario === 'autoLoop'
          ? await runAutoLoop(list, setActive)
          : await runMovedDrop(list, setActive, scenario, MOVED)
      );
    } finally {
      setRunning(false);
    }
  };

  // No tap tooling on the iOS simulator: `EXPO_PUBLIC_POC_AUTORUN=1 expo start` runs the loop on mount.
  useEffect(() => {
    const auto = process.env.EXPO_PUBLIC_POC_AUTORUN;
    if (auto) {
      // Native-only text (not in React props): a remount would lose it, so the
      // final screenshot shows whether the TextInput survived lift/drop.
      inputRef.current?.setNativeProps({ text: 'kept-native-text' });
      const scenario = auto === '1' ? 'autoLoop' : (auto as Scenario);
      const t = setTimeout(() => run(scenario), 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <Button
          title={`clip:${clipped}`}
          onPress={() => setClipped((v) => !v)}
        />
        <Button
          title={`inverted:${inverted}`}
          onPress={() => setInverted((v) => !v)}
        />
        {(['autoLoop', 'momentum', 'settled'] as const).map((scenario) => (
          <Button
            key={scenario}
            title={scenario}
            onPress={running ? undefined : () => run(scenario)}
          />
        ))}
        <Text>{status}</Text>
      </View>
      <FlatList
        ref={list}
        data={DATA}
        extraData={active}
        keyExtractor={String}
        removeClippedSubviews={clipped}
        inverted={inverted}
        getItemLayout={(_, i) => ({
          length: ROW_H,
          offset: ROW_H * i,
          index: i,
        })}
        renderItem={({ item }) => (
          <Cell index={item} active={item === active} />
        )}
      />
    </View>
  );
}

function Button({ title, onPress }: { title: string; onPress?: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 60 },
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    padding: 8,
  },
  button: { padding: 8, backgroundColor: '#ddd', borderRadius: 6 },
  cell: { height: ROW_H },
  row: { flexDirection: 'row' },
  content: {
    height: ROW_H,
    paddingLeft: 32,
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 14 },
  input: { borderWidth: 1, padding: 4, marginRight: 8 },
  marker: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 24,
    height: 24,
    backgroundColor: '#888',
  },
  markerActive: { backgroundColor: '#FF00FF' },
});
