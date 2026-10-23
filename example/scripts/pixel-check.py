#!/usr/bin/env python3
"""Track the #FF00FF PoC marker across a screen recording (AC-P2a).

Usage:
  pixel-check.py <video> --screen-width-dp W [--ref-frames N] [--tolerance 1.0]
                 [--min-fps HZ] [--ref-x DP --ref-y DP] [--dump] [--windows]
  pixel-check.py --self-test

Prints one line:
  PIXEL frames=<n> fps=<x> missing=<count> over_tolerance=<count>
With --windows, also one WINDOW line per cyan-gate window (one per PoC cycle,
in log order) and one FLAG line per bad frame inside a window:
  missing  marker not found
  jump     |d_i| > tol and |v_i| > tol + 2*max(|v_i-1|, |v_i+1|)
  spike    d_i . d_i+1 < 0 and min(|d_i|, |d_i+1|) > tol + 2*max(|v_i-1|, |v_i+2|)
d_i is the marker displacement into frame i (dp, max-abs norm), v_i the same
scaled to one 60Hz frame (VFR-safe; intervals under one frame count as one). Smooth motion (press, spring, scroll,
drop animation) changes velocity gradually and passes; a teleport or a
one-frame excursion does not.
Warnings go to stderr. Always exits 0: it reports numbers, people judge them.
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import tempfile

try:
    import numpy as np
except ImportError:
    np = None

MARKER = (255, 0, 255)
GATE = (0, 255, 255)
# Gate square is 16dp; a few dozen px survive any sane encode.
GATE_MIN_PX = 20
# Below this, codec smear blurs the marker's hard edges and shifts its centroid.
MIN_BITS_PER_PIXEL = 0.1


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True).stdout


def stream_info(video):
    info = json.loads(run([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,bit_rate:format=bit_rate',
        '-of', 'json', video,
    ]))
    s = info['streams'][0]
    bitrate = s.get('bit_rate') or info.get('format', {}).get('bit_rate')
    return int(s['width']), int(s['height']), int(bitrate) if bitrate else None


def frame_times(video):
    # Packet timestamps, no decode. VFR-aware (Android screenrecord is VFR).
    out = run([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', video,
    ]).decode()
    return sorted(float(t) for t in out.split() if t not in ('', 'N/A'))


def frames(video, w, h):
    proc = subprocess.Popen([
        'ffmpeg', '-v', 'error', '-i', video, '-fps_mode', 'passthrough',
        '-vf', f'scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ], stdout=subprocess.PIPE)
    size = w * h * 3
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        yield buf
    proc.wait()


def gate_on(buf, w, h, tol):
    a = np.frombuffer(buf, np.uint8).reshape(h, w, 3).astype(np.int32)
    return int((((a - np.array(GATE)) ** 2).sum(axis=2) <= tol * tol).sum()) \
        >= GATE_MIN_PX


def centroid(buf, w, h, tol):
    """Centroid (px) of pixels within `tol` RGB distance of MARKER, or None."""
    tol2 = tol * tol
    if np is not None:
        a = np.frombuffer(buf, np.uint8).reshape(h, w, 3).astype(np.int32)
        d2 = ((a - np.array(MARKER)) ** 2).sum(axis=2)
        ys, xs = np.nonzero(d2 <= tol2)
        if len(xs) == 0:
            return None
        return float(xs.mean()), float(ys.mean())
    sx = sy = n = 0
    r0, g0, b0 = MARKER
    for i in range(0, len(buf), 3):
        dr, dg, db = buf[i] - r0, buf[i + 1] - g0, buf[i + 2] - b0
        if dr * dr + dg * dg + db * db <= tol2:
            p = i // 3
            sx += p % w
            sy += p // w
            n += 1
    return (sx / n, sy / n) if n else None


def check(args):
    vw, vh, bitrate = stream_info(args.video)
    times = frame_times(args.video)
    dts = [b - a for a, b in zip(times, times[1:]) if b > a]
    # Median frame interval: the rate while things move, ignoring VFR idle gaps.
    fps = 1 / statistics.median(dts) if dts else 0.0
    # 1/median-interval lands at ~59.99 on a 60Hz capture; allow 1% quantization.
    if args.min_fps and fps < args.min_fps * 0.99:
        print(f'WARN fps={fps:.1f} below --min-fps {args.min_fps}; re-record '
              'with another capture method', file=sys.stderr)
    if bitrate and fps:
        bpp = bitrate / (vw * vh * fps)
        if bpp < MIN_BITS_PER_PIXEL:
            print(f'WARN bits/pixel/frame={bpp:.3f} < {MIN_BITS_PER_PIXEL}: '
                  'low bitrate smears the marker', file=sys.stderr)

    # Half size: 1dp is still >= 1.5px on a 3x screen and the centroid is
    # sub-pixel, at a quarter of the decode cost. Pure Python goes to 1/4.
    down = args.down if np is not None else max(args.down, 4)
    w, h = vw // down, vh // down
    px_per_dp = vw / args.screen_width_dp
    if args.windows and np is None:
        sys.exit('--windows needs numpy')
    points = []
    gates = []
    for buf in frames(args.video, w, h):
        if args.windows:
            gates.append(gate_on(buf, w, h, args.color_tol))
        c = centroid(buf, w, h, args.color_tol)
        points.append(None if c is None else
                      ((c[0] + 0.5) * down / px_per_dp,
                       (c[1] + 0.5) * down / px_per_dp))

    present = [p for p in points[:args.ref_frames] if p is not None]
    ref_x = args.ref_x if args.ref_x is not None else (
        statistics.median(p[0] for p in present) if present else None)
    ref_y = args.ref_y if args.ref_y is not None else (
        statistics.median(p[1] for p in present) if present else None)

    missing = over = 0
    for k, p in enumerate(points):
        if p is None:
            missing += 1
            delta = None
        elif ref_x is None or ref_y is None:
            delta = None
        else:
            delta = max(abs(p[0] - ref_x), abs(p[1] - ref_y))
            over += delta > args.tolerance
        if args.dump:
            t = times[k] if k < len(times) else float('nan')
            pos = 'none' if p is None else f'{p[0]:.2f},{p[1]:.2f}'
            d = 'none' if delta is None else f'{delta:.2f}'
            print(f'FRAME k={k} t={t:.4f} dp={pos} delta={d}')
    print(f'PIXEL frames={len(points)} fps={fps:.2f} missing={missing} '
          f'over_tolerance={over}')
    if args.windows:
        for line in windows(points, gates, times, args.tolerance):
            print(line)
    return points, ref_x, ref_y


def windows(points, gates, times, tol):
    """WINDOW/FLAG lines for each run of gate-on frames (see module doc)."""
    spans, start = [], None
    for k, g in enumerate(gates + [False]):
        if g and start is None:
            start = k
        elif not g and start is not None:
            spans.append((start, k))
            start = None
    out = []
    for n, (a, b) in enumerate(spans):
        inside = range(a, min(b, len(times)))
        # Context frames around the window (1 before, 2 after): VFR writes no
        # frames while the screen is static, so a spike's return frame can be
        # the gate-off frame. The harness holds still 10 frames after the gate.
        idx = list(range(max(a - 1, 0), min(b + 2, len(times))))
        flags = [(k, 'missing', 0.0) for k in inside if points[k] is None]
        d, v = {}, {}
        for i, k in enumerate(idx[1:], 1):
            p, q = points[idx[i - 1]], points[k]
            dt = times[k] - times[idx[i - 1]]
            if p is None or q is None or dt <= 0:
                continue
            d[k] = (q[0] - p[0], q[1] - p[1])
            # Floor at one display frame: two encoder frames stamped a few ms
            # apart are timestamp jitter, not motion faster than the display.
            v[k] = max(abs(c) for c in d[k]) * (1 / 60) / max(dt, 1 / 60)
        mag = {k: max(abs(c) for c in d[k]) for k in d}
        for i, k in enumerate(idx):
            prev = idx[i - 1] if i > 0 else None
            nxt = idx[i + 1] if i + 1 < len(idx) else None
            nxt2 = idx[i + 2] if i + 2 < len(idx) else None
            if k not in inside or k not in d or prev not in v or nxt not in v:
                continue
            if mag[k] > tol and v[k] > tol + 2 * max(v[prev], v[nxt]):
                flags.append((k, 'jump', mag[k]))
            if nxt2 in v and d[k][0] * d[nxt][0] + d[k][1] * d[nxt][1] < 0:
                size = min(mag[k], mag[nxt])
                if size > tol + 2 * max(v[prev], v[nxt2]):
                    flags.append((k, 'spike', size))
        flags.sort()
        out.append(f'WINDOW n={n} t0={times[a]:.4f} t1={times[inside[-1]]:.4f} '
                   f'frames={len(inside)} bad={len(flags)}')
        out += [f'FLAG window={n} k={k} t={times[k]:.4f} kind={kind} '
                f'size={size:.2f}' for k, kind, size in flags]
    return out


def self_test():
    """Synthetic 360x640 clip, marker 24px at (100,200): centroid 112,212 px."""
    with tempfile.TemporaryDirectory() as d:
        video = os.path.join(d, 't.mp4')
        run(['ffmpeg', '-v', 'error', '-f', 'lavfi',
             '-i', 'color=white:s=360x640:d=0.5:r=60',
             '-vf', 'drawbox=x=100:y=200:w=24:h=24:color=0xFF00FF:t=fill',
             '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv444p', video])
        args = parse([video, '--screen-width-dp', '360'])
        points, rx, ry = check(args)
        assert len(points) == 30 and all(points), points[:3]
        assert abs(rx - 112) <= 0.5 and abs(ry - 212) <= 0.5, (rx, ry)
    # Windows: a static marker passes; one displaced frame is a spike, a lasting
    # displacement a jump.
    t = [i / 60 for i in range(12)]
    still = [(10.0, 10.0)] * 12
    assert windows(still, [True] * 12, t, 1.0) == [
        'WINDOW n=0 t0=0.0000 t1=0.1833 frames=12 bad=0']
    blip = still[:5] + [(10.0, -134.0)] + still[6:]
    assert any('kind=spike size=144.00' in x
               for x in windows(blip, [True] * 12, t, 1.0)), blip
    step = still[:5] + [(10.0, 146.0)] * 7
    assert any('kind=jump' in x for x in windows(step, [True] * 12, t, 1.0))
    tail = still[:9] + [(10.0, -134.0)] + still[10:]
    assert any('kind=spike' in x for x in windows(
        tail, [True] * 10 + [False] * 2, t, 1.0)), 'spike at window edge'
    # Smooth motion with two frames stamped 3ms apart (encoder jitter) passes.
    jt = t[:6] + [t[5] + 0.003] + [x + 1 / 60 for x in t[6:11]]
    move = [(10.0, 10.0 + 10 * i) for i in range(12)]
    assert windows(move, [True] * 12, jt, 1.0)[0].endswith('bad=0'), 'jitter'
    ramp = [(10.0, 10.0 + 0.5 * i * i) for i in range(12)]
    assert windows(ramp, [True] * 12, t, 1.0)[0].endswith('bad=0'), ramp
    print('SELF-TEST ok')


def parse(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('video', nargs='?')
    ap.add_argument('--screen-width-dp', type=float)
    ap.add_argument('--ref-frames', type=int, default=10)
    ap.add_argument('--tolerance', type=float, default=1.0, help='dp')
    ap.add_argument('--min-fps', type=float, help='display refresh rate')
    ap.add_argument('--color-tol', type=float, default=60,
                    help='RGB distance to #FF00FF counted as marker')
    ap.add_argument('--ref-x', type=float, help='reference x in dp')
    ap.add_argument('--ref-y', type=float, help='reference y in dp')
    ap.add_argument('--down', type=int, default=2,
                    help='decode at 1/N size (default 2)')
    ap.add_argument('--dump', action='store_true', help='print every frame')
    ap.add_argument('--windows', action='store_true',
                    help='judge each cyan-gate window (needs numpy)')
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args(argv)
    if not args.self_test and (not args.video or not args.screen_width_dp):
        ap.error('<video> and --screen-width-dp are required')
    return args


if __name__ == '__main__':
    a = parse(sys.argv[1:])
    self_test() if a.self_test else check(a)
