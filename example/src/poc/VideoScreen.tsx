import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Video, { ViewType } from 'react-native-video';
import { Liftable, useLiftRef } from 'react-native-lift';

// P4: re-parent a playing video (expo-video, react-native-video). Pass: the
// playhead keeps advancing through 5 lift/drop cycles and no pause event
// fires. Android runs once per surface (SurfaceView / TextureView).
// Driven by example/.maestro/poc/p4-video.yaml.
const SOURCE = require('../../assets/poc-video.mp4');
const CYCLES = 5;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Stats = { time: () => number; pauses: number };

async function cycle(
  lib: string,
  handle: ReturnType<typeof useLiftRef>,
  s: Stats
) {
  const times = [s.time()];
  const pausesBefore = s.pauses;
  for (let i = 0; i < CYCLES; i++) {
    handle.current?.lift();
    await sleep(1000);
    times.push(s.time());
    handle.current?.drop({ immediate: false });
    await sleep(1000);
    times.push(s.time());
  }
  // Each 1s step must advance; a drop of > 20s is the 30s clip looping.
  const steps = times.slice(1).map((t, i) => t - times[i]!);
  const stalled = steps.filter((d) => d < 0.5 && d > -20).length;
  const pauses = s.pauses - pausesBefore;
  const ok = stalled === 0 && pauses === 0;
  console.log(
    `P4 lib=${lib} surface=${Platform.OS === 'android' ? surfaceName : 'n/a'} ` +
      `ok=${ok} stalled=${stalled} pauses=${pauses} times=${times
        .map((t) => t.toFixed(2))
        .join(',')}`
  );
  return ok;
}

let surfaceName = 'surfaceView';

// Step 5.2 item 9: a view too tall for the menu is cut (layout rule 4), which
// re-parents its native children twice more while shown. The video sits in
// the middle so it stays visible whichever side is cut. Pass: as P4.
const LINES = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');

function ClipVideo({ surface }: { surface: 'surfaceView' | 'textureView' }) {
  const [result, setResult] = useState('idle');
  const handle = useLiftRef();
  const player = useVideoPlayer(SOURCE, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', {
    isPlaying: player.playing,
  });
  const stats = useRef<Stats>({ time: () => player.currentTime, pauses: 0 });
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (wasPlaying.current && !isPlaying) {
      stats.current.pauses++;
    }
    wasPlaying.current = isPlaying;
  }, [isPlaying]);
  const run = async () => {
    setResult('running');
    const ok = await cycle('expo-video-clip', handle, stats.current);
    setResult(`P9 done ${ok ? 'ok' : 'FAIL'}`);
  };
  return (
    <>
      <Pressable testID="run-p9" style={styles.button} onPress={run}>
        <Text>{`run P9 ${result}`}</Text>
      </Pressable>
      <Liftable
        ref={handle}
        longPress={false}
        menu={[{ key: 'close', title: 'Close', onPress: () => {} }]}
      >
        <View style={styles.tall}>
          <Text>{LINES}</Text>
          <VideoView
            key={surface}
            player={player}
            surfaceType={surface}
            nativeControls={false}
            style={styles.video}
          />
          <Text>{LINES}</Text>
        </View>
      </Liftable>
    </>
  );
}

export function VideoScreen() {
  const [surface, setSurface] = useState<'surfaceView' | 'textureView'>(
    'surfaceView'
  );
  surfaceName = surface;
  const [result, setResult] = useState('idle');
  const [clip, setClip] = useState(false);
  const expoHandle = useLiftRef();
  const rnvHandle = useLiftRef();
  const player = useVideoPlayer(SOURCE, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', {
    isPlaying: player.playing,
  });
  const expo = useRef<Stats>({ time: () => player.currentTime, pauses: 0 });
  const rnvTime = useRef(0);
  const rnv = useRef<Stats>({ time: () => rnvTime.current, pauses: 0 });
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (wasPlaying.current && !isPlaying) {
      expo.current.pauses++;
    }
    wasPlaying.current = isPlaying;
  }, [isPlaying]);

  const run = async () => {
    setResult('running');
    const e = await cycle('expo-video', expoHandle, expo.current);
    const r = await cycle('react-native-video', rnvHandle, rnv.current);
    setResult(`P4 done expo:${e ? 'ok' : 'FAIL'} rnv:${r ? 'ok' : 'FAIL'}`);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <Pressable testID="run-p4" style={styles.button} onPress={run}>
          <Text>run P4</Text>
        </Pressable>
        {Platform.OS === 'android' && (
          <Pressable
            testID="surface-toggle"
            style={styles.button}
            onPress={() =>
              setSurface((v) =>
                v === 'surfaceView' ? 'textureView' : 'surfaceView'
              )
            }
          >
            <Text>{`surface:${surface}`}</Text>
          </Pressable>
        )}
        <Pressable
          testID="clip-toggle"
          style={styles.button}
          onPress={() => setClip((v) => !v)}
        >
          <Text>{`clip:${clip ? 'on' : 'off'}`}</Text>
        </Pressable>
      </View>
      {clip ? (
        <ClipVideo surface={surface} />
      ) : (
        <>
          <Text testID="p4-result">{result}</Text>
          <Liftable ref={expoHandle} longPress={false}>
            <VideoView
              key={surface}
              player={player}
              surfaceType={surface}
              nativeControls={false}
              style={styles.video}
            />
          </Liftable>
          <Liftable ref={rnvHandle} longPress={false}>
            <Video
              key={surface}
              source={SOURCE}
              repeat
              muted
              viewType={
                surface === 'surfaceView' ? ViewType.SURFACE : ViewType.TEXTURE
              }
              onProgress={(ev) => {
                rnvTime.current = ev.currentTime;
              }}
              onPlaybackStateChanged={(ev) => {
                if (!ev.isPlaying) {
                  rnv.current.pauses++;
                }
              }}
              style={styles.video}
            />
          </Liftable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12 },
  bar: { flexDirection: 'row', gap: 8 },
  button: { padding: 8, backgroundColor: '#ddd', borderRadius: 6 },
  video: { width: 320, height: 180, backgroundColor: '#000' },
  tall: { gap: 8 },
});
