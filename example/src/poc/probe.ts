import { useMemo } from 'react';
import type { View } from 'react-native';
import {
  measure,
  useFrameCallback,
  useSharedValue,
  type AnimatedRef,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

const N = 10;

type Point = [number, number];

export type ProbeCtx = {
  cycle: number;
  // Window origin of the cell wrapper before lift. The host origin is taken
  // as (0,0): LiftProvider wraps the whole app root.
  origin: { x: number; y: number };
  // Untransformed layout size of the container content (onLayout).
  layout: { width: number; height: number };
};

type Job = {
  kind: 'lift' | 'drop';
  ctx: ProbeCtx;
  pre: Point[];
  post: Point[];
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
};

function report(job: Job, container: number[] | null) {
  // Median of the pre-window, so one stale frame that raced ahead of mark()
  // (see ponytail note below) can't become the reference.
  const base: Point = [
    median(job.pre.map((p) => p[0])),
    median(job.pre.map((p) => p[1])),
  ];
  const { cycle, origin, layout } = job.ctx;
  const delta = ([x, y]: Point): Point => [x - base[0], y - base[1]];
  const size = ([dx, dy]: Point) => Math.max(Math.abs(dx), Math.abs(dy));
  // Settle (P2(b) rule, lift only): at most 2 consecutive frames starting at
  // the commit (k=-1 or k=1) whose delta each equals the unapplied teleport
  // offset (wrapperOrigin - hostOrigin) within 1dp. If either frame in the
  // run fails the match, none is exempt. P2(a) for the same cycle is judged
  // separately from the recording.
  const frames: [number, Point][] = [
    ...job.pre.map((p, n): [number, Point] => [n - job.pre.length, p]),
    ...job.post.map((p, n): [number, Point] => [n + 1, p]),
  ];
  const around = frames.filter(([k]) => k >= -1);
  const start = around.findIndex(([, p]) => size(delta(p)) > 1);
  const settle = new Set<number>();
  if (job.kind === 'lift' && Math.abs(around[start]?.[0] ?? 0) === 1) {
    for (const [k, p] of around.slice(start, start + 2)) {
      const [dx, dy] = delta(p);
      if (size([dx, dy]) <= 1) {
        break;
      }
      if (size([dx - origin.x, dy - origin.y]) > 1) {
        settle.clear();
        break;
      }
      settle.add(k);
    }
  }
  for (const [k, p] of frames) {
    console.log(
      `PROBE cycle=${cycle} kind=${job.kind} frame=${k} delta=${size(
        delta(p)
      ).toFixed(2)} settle=${settle.has(k)}`
    );
  }
  if (container) {
    const [x, y, w, h] = container as [number, number, number, number];
    console.log(
      `PROBE_CONTAINER cycle=${cycle} x=${x.toFixed(2)} y=${y.toFixed(
        2
      )} w=${w.toFixed(2)} h=${h.toFixed(2)} layoutW=${layout.width.toFixed(
        2
      )} layoutH=${layout.height.toFixed(2)} transformIncluded=${
        Math.abs(w - layout.width) > 0.5
      }`
    );
  }
}

/**
 * Debug-only (__DEV__) shadow-tree probe of the marker's window rect.
 * `container` is an absoluteFill child of the lifted container; its measure
 * equals the container's own and is logged once per lift for P9.
 */
export function useProbe(
  marker: AnimatedRef<View>,
  container: AnimatedRef<View>
) {
  const ring = useSharedValue<Point[]>([]);
  const job = useSharedValue<Job | null>(null);

  const frame = useFrameCallback(() => {
    'worklet';
    const m = measure(marker);
    const p: Point = m ? [m.pageX, m.pageY] : [NaN, NaN];
    const j = job.value;
    if (!j) {
      ring.value = [...ring.value, p].slice(-N);
      return;
    }
    const post = [...j.post, p];
    if (post.length < N) {
      job.value = { ...j, post };
      return;
    }
    job.value = null;
    ring.value = post;
    const c = j.kind === 'lift' ? measure(container) : null;
    scheduleOnRN(
      report,
      { ...j, post },
      c ? [c.pageX, c.pageY, c.width, c.height] : null
    );
  }, false);

  return useMemo(
    () => ({
      setActive(active: boolean) {
        if (__DEV__) {
          frame.setActive(active);
        }
      },
      // Called after the commit (onLiftStart/onLiftEnd). ponytail: a UI frame
      // that lands between the JS commit and this hop is counted as "pre";
      // it shows up as a nonzero pre-frame delta in the log.
      mark(kind: Job['kind'], ctx: ProbeCtx) {
        if (!__DEV__) {
          return;
        }
        scheduleOnUI(() => {
          'worklet';
          job.value = { kind, ctx, pre: ring.value, post: [] };
        });
      },
    }),
    [frame, job, ring]
  );
}

export type Probe = ReturnType<typeof useProbe>;
