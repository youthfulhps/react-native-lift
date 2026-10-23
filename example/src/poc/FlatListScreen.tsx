import {
  createRef,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Dimensions,
  FlatList,
  Linking,
  Platform,
  Pressable,
  Settings,
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
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { Liftable, useLiftRef, useLiftScrollLock } from 'react-native-lift';
import {
  cells,
  frames,
  gate,
  lock,
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
const kindOf = (i: number): Kind =>
  i === 3 ? 'input' : KINDS[Math.abs(i) % 3]!;

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
  const marker = useAnimatedRef();
  const fill = useAnimatedRef();
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
    shownOther: 0,
  }));

  // After LiftSlot's own layout effects: an itemKey drop has already run
  // onLiftEnd by now, so only an overlay still showing this cell counts.
  useLayoutEffect(() => {
    if (entry.liftedIndex !== undefined && entry.liftedIndex !== index) {
      entry.shownOther++;
    }
  }, [entry, index]);

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
        itemKey={index}
        onLiftStart={() => {
          entry.liftedIndex = index;
          if (entry.ctx) {
            probe.mark('lift', entry.ctx);
          }
          entry.onLiftStart?.();
        }}
        onLiftEnd={() => {
          entry.liftedIndex = undefined;
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

type Scenario =
  'autoLoop' | 'momentum' | 'settled' | 'update' | 'rebind' | 'scroll';
type Job = {
  run: string;
  scenario: Scenario;
  clip: boolean;
  inverted: boolean;
  flash: boolean;
};

// tag=<id>&jobs=c0i0-autoLoop,c1i0-settled,…  (c<clip>i<inverted>-<scenario>)
// Delivered by example/scripts/poc-auto.py as `liftexample://poc?<spec>`, the
// iOS launch argument `-pocSuite <spec>`, or EXPO_PUBLIC_POC_SUITE at bundle time.
const SUITE_URL = 'liftexample://poc?';
function parseSuite(spec: unknown): Job[] {
  const q = Object.fromEntries(
    String(spec ?? '')
      .split('&')
      .map((kv) => kv.split('=').map(decodeURIComponent))
  ) as Record<string, string | undefined>;
  return (q.jobs ?? '')
    .split(',')
    .filter(Boolean)
    .map((job) => {
      const [combo = '', scenario] = job.split('-');
      return {
        run: `${q.tag ?? 'suite'}-${job}`,
        scenario: scenario as Scenario,
        clip: combo[1] === '1',
        inverted: combo[3] === '1',
        // c0i0f1: FlashList v2 instead of FlatList (P3).
        flash: combo[5] === '1',
      };
    });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Cell 21 is a 'normal' row; start it mid-screen and scroll 2 rows while lifted.
const MOVED = { target: 21, base: 21 * ROW_H - 300, shift: 2 * ROW_H };

export function FlatListScreen() {
  const list = useRef<FlatList<number>>(null);
  const flashList = useRef<React.ComponentRef<typeof FlashList<number>>>(null);
  const [clipped, setClipped] = useState(false);
  const [inverted, setInverted] = useState(false);
  const [flash, setFlash] = useState(false);
  // Items inserted above the list while lifted ('update' scenario).
  const [extra, setExtra] = useState(0);
  const scrollEnabled = useLiftScrollLock();
  lock.scrollEnabled = scrollEnabled;
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(0);
  // Also shown on screen: iOS release builds don't surface console.log.
  const [status, setStatus] = useState('idle');

  const run = async (job: Job) => {
    setRunning(true);
    setStatus(`${job.scenario}…`);
    setClipped(job.clip);
    setInverted(job.inverted);
    setFlash(job.flash);
    let result = 'error';
    try {
      // Let a toggled list re-render and settle before the first cycle.
      await frames(30);
      const win = Dimensions.get('window');
      // First line of every run: ties logs/recordings to a commit and build.
      console.log(
        `POC START run=${job.run} scenario=${job.scenario} clip=${+job.clip} ` +
          `inverted=${+job.inverted} flash=${+job.flash} sha=${
            process.env.EXPO_PUBLIC_GIT_SHA ?? 'unknown'
          } os=${Platform.OS} dev=${__DEV__} win=${win.width}x${win.height}`
      );
      const ref = job.flash ? flashList : list;
      result =
        job.scenario === 'autoLoop' || job.scenario === 'scroll'
          ? await runAutoLoop(ref, setActive, job.scenario === 'autoLoop')
          : await runMovedDrop(ref, setActive, job.scenario, MOVED, setExtra);
    } finally {
      console.log(`POC END run=${job.run} result=${result}`);
      setStatus(result);
      setRunning(false);
    }
  };
  const busy = useRef(false);
  const runSuite = async (jobs: Job[]) => {
    if (busy.current || jobs.length === 0) {
      return;
    }
    busy.current = true;
    for (const job of jobs) {
      // READY gives poc-auto.py time to start a recording for this job.
      console.log(`POC READY run=${job.run}`);
      await sleep(5000);
      await run(job);
      await sleep(1500);
    }
    console.log('POC SUITE DONE');
    busy.current = false;
  };
  const runSuiteRef = useRef(runSuite);
  runSuiteRef.current = runSuite;

  useEffect(() => {
    // Native-only text (not in React props): a remount would lose it, so the
    // final screenshot shows whether the TextInput survived lift/drop.
    inputRef.current?.setNativeProps({ text: 'kept-native-text' });
    const start = (spec: unknown) => runSuiteRef.current(parseSuite(spec));
    const fromUrl = (url: string | null | undefined) => {
      if (url?.startsWith(SUITE_URL)) {
        start(url.slice(SUITE_URL.length));
      }
    };
    start(process.env.EXPO_PUBLIC_POC_SUITE);
    if (Platform.OS === 'ios') {
      start(Settings.get('pocSuite'));
    }
    Linking.getInitialURL().then(fromUrl);
    const sub = Linking.addEventListener('url', (e) => fromUrl(e.url));
    return () => sub.remove();
  }, []);

  const data = useMemo(
    () => [...Array.from({ length: extra }, (_, i) => i - extra), ...DATA],
    [extra]
  );
  const renderItem = ({ item }: { item: number }) => (
    <Cell index={item} active={item === active} />
  );

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
            onPress={
              running
                ? undefined
                : () =>
                    runSuite([
                      {
                        run: 'manual',
                        scenario,
                        clip: clipped,
                        inverted,
                        flash,
                      },
                    ])
            }
          />
        ))}
        <Text>{status}</Text>
        <Gate />
      </View>
      {flash ? (
        <FlashList
          ref={flashList}
          data={data}
          extraData={active}
          keyExtractor={String}
          inverted={inverted}
          scrollEnabled={scrollEnabled}
          renderItem={renderItem}
        />
      ) : (
        <FlatList
          ref={list}
          data={data}
          extraData={active}
          keyExtractor={String}
          removeClippedSubviews={clipped}
          inverted={inverted}
          scrollEnabled={scrollEnabled}
          getItemLayout={(_, i) => ({
            length: ROW_H,
            offset: ROW_H * i,
            index: i,
          })}
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

// Cyan square shown while a measurement window is open (see autoLoop `gate`).
function Gate() {
  const style = useAnimatedStyle(() => ({ opacity: gate.value }));
  return <Animated.View style={[styles.gate, style]} pointerEvents="none" />;
}

function Button({ title, onPress }: { title: string; onPress?: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  gate: {
    // In the toolbar: a lifted cell (drawn above everything) never reaches it.
    width: 16,
    height: 16,
    backgroundColor: '#00FFFF',
  },
});
