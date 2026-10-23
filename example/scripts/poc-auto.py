#!/usr/bin/env python3
"""Automated Step 1.2 PoC measurement on a booted iOS simulator / Android device.

The app runs a suite of jobs (spec `tag=<id>&jobs=c0i0-autoLoop,...`) and logs
`POC READY run=<id>` 5s before each job and `POC END run=<id>` after it. This
script starts the suite, records each job between those two lines, then judges
it with pixel-check.py --windows (P2a) and the log (P1, P2b, P9).

Release builds are started here (iOS: relaunch with `-pocSuite <spec>`;
Android: relaunch with `liftexample://poc?<spec>`). Debug builds load JS from
Metro, so with --external the script only prints the spec and listens: start
Metro with EXPO_PUBLIC_POC_SUITE=<spec> and open the dev client yourself.

Usage:
  poc-auto.py --platform ios|android --build release|debug --out DIR
              [--combos c0i0,c0i1] [--scenarios autoLoop,momentum,settled]
              [--external]
Writes DIR/<job>/{video.mp4,log.txt,pixel.txt,verdict.json} and DIR/summary.md.
"""
import argparse
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
TIMEOUT = 300


class Log:
    """Tails the device log into memory (and a file) on a background thread."""

    def __init__(self, platform, path):
        if platform == 'ios':
            cmd = ['xcrun', 'simctl', 'spawn', 'booted', 'log', 'stream',
                   '--style', 'compact', '--level', 'debug', '--predicate',
                   'subsystem == "com.facebook.react.log"']
        else:
            subprocess.run(['adb', 'logcat', '-c'], check=True)
            cmd = ['adb', 'logcat', '-v', 'raw', '-s', 'ReactNativeJS:V']
        self.lines = []
        self.file = open(path, 'w')
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True,
                                     bufsize=1)
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        for line in self.proc.stdout:
            # Keep only the PoC payload (drops the os_log / logcat prefix).
            m = re.search(r'(POC |AUTOLOOP |MOVED |PROBE|P4 |REBIND )', line)
            if m:
                payload = line[m.start():].rstrip()
                self.lines.append(payload)
                self.file.write(payload + '\n')
                self.file.flush()

    def wait(self, needle, since, timeout):
        """Index of the first line at/after `since` containing needle, or None."""
        end = time.time() + timeout
        while time.time() < end:
            for i in range(since, len(self.lines)):
                if needle in self.lines[i]:
                    return i
            time.sleep(0.25)
        return None

    def close(self):
        self.proc.terminate()
        self.file.close()


class Recorder:
    def __init__(self, platform, path):
        self.platform, self.path = platform, path
        if platform == 'ios':
            self.proc = subprocess.Popen(
                ['xcrun', 'simctl', 'io', 'booted', 'recordVideo',
                 '--codec=h264', '--force', path],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            self.proc = subprocess.Popen(
                ['adb', 'shell', 'screenrecord', '--bit-rate', '20000000',
                 '--time-limit', '180', '/sdcard/poc.mp4'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)

    def stop(self):
        if self.platform == 'ios':
            self.proc.send_signal(signal.SIGINT)
            self.proc.wait(30)
        else:
            subprocess.run(['adb', 'shell', 'pkill', '-INT', 'screenrecord'])
            self.proc.wait(30)
            time.sleep(1)
            subprocess.run(['adb', 'pull', '/sdcard/poc.mp4', self.path],
                           check=True, capture_output=True)


def trigger(platform, spec):
    if platform == 'ios':
        subprocess.run(['xcrun', 'simctl', 'terminate', 'booted', 'lift.example'],
                       capture_output=True)
        subprocess.run(['xcrun', 'simctl', 'launch', 'booted', 'lift.example',
                        '-pocSuite', spec], check=True, capture_output=True)
    else:
        subprocess.run(['adb', 'shell', 'am', 'force-stop', 'lift.example'])
        subprocess.run(['adb', 'shell', "am start -a android.intent.action.VIEW"
                        f" -d 'liftexample://poc?{spec}' lift.example"],
                       check=True, capture_output=True)


def device(platform):
    if platform == 'ios':
        out = json.loads(subprocess.run(
            ['xcrun', 'simctl', 'list', 'devices', 'booted', '-j'],
            capture_output=True, text=True, check=True).stdout)
        for runtime, devs in out['devices'].items():
            for d in devs:
                return f"{d['name']} (simulator)", runtime.split('.')[-1]
    prop = lambda k: subprocess.run(['adb', 'shell', 'getprop', k],
                                    capture_output=True, text=True).stdout.strip()
    kind = 'emulator' if prop('ro.kernel.qemu') == '1' else 'device'
    return f"{prop('ro.product.model')} ({kind})", \
        f"Android {prop('ro.build.version.release')}"


def judge(job, lines, pixel_lines, dev):
    """Verdict dict for one run. Window n <-> the n-th cycle in log order."""
    cyc_re = re.compile(r'^(AUTOLOOP|MOVED).* cycle=(\d+) ok=(\w+) reason=(.*)$')
    cycles = [m.groups() for m in map(cyc_re.match, lines) if m]
    done = [x for x in lines if ' DONE ' in x]
    windows = [x for x in pixel_lines if x.startswith('WINDOW')]
    flags = [x for x in pixel_lines if x.startswith('FLAG')]
    if job['scenario'] == 'rebind':
        # Its drop commits immediately to an off-screen slot: allowed jump.
        flags = [f for f in flags
                 if int(re.search(r'window=(\d+)', f).group(1)) % 2 == 0]
    # Two windows per cycle (lift, drop): cycle n = windows 2n, 2n+1.
    bad_window = {int(re.search(r'window=(\d+)', f).group(1)) // 2
                  for f in flags}
    expected = 20 if job['scenario'] == 'autoLoop' else 10
    v = {
        'run': job['run'], 'scenario': job['scenario'],
        'clip': job['clip'], 'inverted': job['inverted'],
        'ended': any(x.startswith(f"POC END run={job['run']}") for x in lines),
        'cycles': len(cycles),
        'assert_fail': [c[1] for c in cycles if c[2] != 'true'],
        'windows': len(windows),
        'pixel_bad_cycles': sorted(bad_window),
        'pixel_flags': flags,
        'fps': next((re.search(r'fps=([\d.]+)', x).group(1)
                     for x in pixel_lines if x.startswith('PIXEL')), None),
    }
    v['valid'] = v['ended'] and v['cycles'] == expected and \
        v['windows'] == 2 * expected and bool(done)
    v['assert_ok'] = v['valid'] and not v['assert_fail']
    v['pixel_ok'] = v['valid'] and not bad_window
    if dev and job['scenario'] == 'autoLoop':
        probe_re = re.compile(
            r'^PROBE cycle=(\d+) kind=(\w+) frame=(-?\d+) delta=([\d.]+) '
            r'settle=(\w+)')
        probes = [m.groups() for m in map(probe_re.match, lines) if m]
        # Pre-window frames before the settled tail (the probe's reference)
        # are the list's own motion, not the handoff: judge from k = -2.
        over = [p for p in probes if float(p[3]) > 1 and p[4] != 'true'
                and int(p[2]) >= -2]
        settle = [p for p in probes if p[4] == 'true']
        # Settle condition 4: the same cycle's P2(a) window must be clean.
        settle_bad = [p for p in settle if int(p[0]) in bad_window]
        v.update({
            'probe_lines': len(probes),
            'probe_expected': expected * 2 * 20,
            'settle_frames': len(settle),
            'probe_over': [' '.join(p) for p in over + settle_bad],
            'transform_included': sorted({
                m.group(1) for m in (re.search(r'transformIncluded=(\w+)', x)
                                     for x in lines) if m}),
        })
        v['probe_ok'] = v['probe_lines'] == v['probe_expected'] and \
            not v['probe_over']
    return v


def device_id(platform):
    if platform == 'ios':
        out = json.loads(subprocess.run(
            ['xcrun', 'simctl', 'list', 'devices', 'booted', '-j'],
            capture_output=True, text=True, check=True).stdout)
        return next(d['udid'] for devs in out['devices'].values() for d in devs)
    return subprocess.run(['adb', 'get-serialno'], capture_output=True,
                          text=True, check=True).stdout.strip()


def run_maestro(a):
    """One Maestro flow with the device log (and optionally the screen)
    captured; judged on the flow result, pixel windows and PROBE lines."""
    os.makedirs(a.out, exist_ok=True)
    if a.dev_url:
        # Debug build: fresh JS state per flow (flows expect a fresh app).
        if a.platform == 'ios':
            subprocess.run(['xcrun', 'simctl', 'terminate', 'booted',
                            'lift.example'], capture_output=True)
            subprocess.run(['xcrun', 'simctl', 'openurl', 'booted', a.dev_url])
        else:
            subprocess.run(['adb', 'shell', 'am', 'force-stop', 'lift.example'])
            subprocess.run(['adb', 'shell', "am start -a android.intent.action"
                            f".VIEW -d '{a.dev_url}'"], capture_output=True)
        time.sleep(12)
    log = Log(a.platform, os.path.join(a.out, 'device-log.txt'))
    video = os.path.join(a.out, 'video.mp4')
    rec = Recorder(a.platform, video) if a.record else None
    cmd = ['maestro', '--device', device_id(a.platform), 'test']
    for e in a.env:
        cmd += ['-e', e]
    started = time.time()
    try:
        r = subprocess.run(cmd + [a.maestro], capture_output=True, text=True,
                           timeout=1800, env={
                               **os.environ, 'MAESTRO_CLI_NO_ANALYTICS': '1',
                               'MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED': 'true'})
    finally:
        time.sleep(1)
        if rec:
            rec.stop()
        log.close()
    open(os.path.join(a.out, 'maestro.txt'), 'w').write(r.stdout + r.stderr)
    lines = log.lines
    v = {'flow': os.path.basename(a.maestro), 'env': a.env,
         'maestro_ok': r.returncode == 0,
         'seconds': round(time.time() - started)}
    bad_cycles = set()
    if rec:
        win = next((re.search(r'win=([\d.]+)x', x).group(1) for x in lines
                    if x.startswith('POC SCREEN')), None)
        pixel = subprocess.run(
            [sys.executable, os.path.join(HERE, 'pixel-check.py'), video,
             '--screen-width-dp', win or '0', '--min-fps', '60', '--windows'],
            capture_output=True, text=True)
        pl = (pixel.stdout + pixel.stderr).splitlines()
        open(os.path.join(a.out, 'pixel.txt'), 'w').write('\n'.join(pl))
        flags = [x for x in pl if x.startswith('FLAG')]
        if a.pixel_lift_only:
            # Drop windows hold an allowed jump (target pushed off screen).
            flags = [f for f in flags
                     if int(re.search(r'window=(\d+)', f).group(1)) % 2 == 0]
        bad_cycles = {int(re.search(r'window=(\d+)', f).group(1)) // 2
                      for f in flags}
        v.update({'windows': sum(x.startswith('WINDOW') for x in pl),
                  'pixel_flags': flags,
                  'fps': next((re.search(r'fps=([\d.]+)', x).group(1)
                               for x in pl if x.startswith('PIXEL')), None)})
    probe_re = re.compile(r'^PROBE cycle=(\d+) kind=(\w+) frame=(-?\d+) '
                          r'delta=([\d.]+) settle=(\w+)')
    probes = [m.groups() for m in map(probe_re.match, lines) if m]
    # P6: focus restore reopens the keyboard 2 frames after a drop commit, so
    # drop frames past --probe-drop-frames are app layout, not handoff (0 =
    # judge lift only, e.g. when the target moved while lifted).
    # Pre-window frames before the settled tail are the app's own motion
    # (the keyboard closing), not the handoff: judge from k = -2.
    probes = [p for p in probes if int(p[2]) >= -2]
    probes = [p for p in probes if p[1] == 'lift' or
              (a.probe_drop_frames is None or
               (a.probe_drop_frames > 0 and int(p[2]) <= a.probe_drop_frames))]
    if probes:
        over = [p for p in probes if float(p[3]) > 1 and p[4] != 'true']
        settle_bad = [p for p in probes if p[4] == 'true' and
                      int(p[0]) in bad_cycles]
        v.update({'probe_lines': len(probes),
                  'settle_frames': sum(p[4] == 'true' for p in probes),
                  'probe_over': [' '.join(p) for p in over + settle_bad]})
    v['other'] = [x for x in lines if x.startswith(('P4 ', 'REBIND '))]
    json.dump(v, open(os.path.join(a.out, 'verdict.json'), 'w'), indent=2)
    print(f"{v['flow']} {' '.join(a.env)}: maestro_ok={v['maestro_ok']} "
          f"windows={v.get('windows', '-')} flags={len(v.get('pixel_flags', []))} "
          f"probe_over={len(v.get('probe_over', [])) if probes else '-'} "
          f"{v['seconds']}s", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--platform', choices=['ios', 'android'], required=True)
    ap.add_argument('--build', choices=['release', 'debug'], required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--combos', default=None)
    ap.add_argument('--scenarios', default=None)
    ap.add_argument('--rejudge', action='store_true',
                    help='only re-run the judgment on recordings in --out')
    ap.add_argument('--one-process', action='store_true',
                    help='run every combination in one app process (triage)')
    ap.add_argument('--external', action='store_true',
                    help='do not launch; print the spec and listen (debug)')
    ap.add_argument('--maestro', help='run this Maestro flow instead')
    ap.add_argument('--env', action='append', default=[],
                    help='K=V passed to the flow (repeatable)')
    ap.add_argument('--dev-url', help='debug: relaunch the dev client at '
                    'this URL before the flow')
    ap.add_argument('--pixel-lift-only', action='store_true',
                    help='judge only lift windows (immediate-drop scenarios)')
    ap.add_argument('--probe-drop-frames', type=int, default=None,
                    help='judge drop PROBE frames only up to this k')
    ap.add_argument('--record', action='store_true',
                    help='record the screen during the flow (pixel windows)')
    a = ap.parse_args()
    if a.maestro:
        return run_maestro(a)
    combos = (a.combos or ('c0i0,c0i1' if a.platform == 'ios'
                           else 'c0i0,c1i0,c0i1,c1i1')).split(',')
    scenarios = (a.scenarios or ('autoLoop' if a.build == 'debug'
                                 else 'autoLoop,momentum,settled')).split(',')
    os.makedirs(a.out, exist_ok=True)
    if a.rejudge:
        # Re-run pixel-check + judge on recordings already in --out.
        captured = []
        for job in sorted(os.listdir(a.out)):
            d = os.path.join(a.out, job)
            if not os.path.exists(os.path.join(d, 'log.txt')):
                continue
            lines = open(os.path.join(d, 'log.txt')).read().splitlines()
            run = next((x.split('run=')[1].split()[0] for x in lines
                        if x.startswith('POC START')), job)
            captured.append((job, run, d, os.path.join(d, 'video.mp4'), lines,
                             any(x.startswith('POC END') for x in lines)))
        return report(a, captured)
    log = Log(a.platform, os.path.join(a.out, 'device-log.txt'))
    dev_name, os_name = device(a.platform)
    tag = time.strftime('%Y%m%d-%H%M%S')
    # One fresh app process per toggle combination: flipping
    # removeClippedSubviews/inverted at runtime is not what an app does and
    # crashed the Android mounting layer once (see poc-report).
    groups = [[f'{c}-{s}' for s in scenarios] for c in combos]
    if a.external or a.one_process:
        groups = [sum(groups, [])]
    captured = []
    try:
        for jobs in groups:
            spec = f"tag={tag}&jobs={','.join(jobs)}"
            if a.external:
                print(f'SPEC {spec}', flush=True)
            else:
                trigger(a.platform, spec)
            since = len(log.lines)
            for n, job in enumerate(jobs):
                run = f'{tag}-{job}'
                d = os.path.join(a.out, job)
                os.makedirs(d, exist_ok=True)
                video = os.path.join(d, 'video.mp4')
                ready = log.wait(f'POC READY run={run}', since,
                                 600 if n == 0 else 120)
                if ready is None:
                    print(f'{job}: no READY (crash?), next combination',
                          flush=True)
                    break
                rec = Recorder(a.platform, video)
                end = log.wait(f'POC END run={run}', ready, TIMEOUT)
                time.sleep(1)
                rec.stop()
                stop = end + 1 if end is not None else len(log.lines)
                lines = log.lines[ready:stop]
                open(os.path.join(d, 'log.txt'), 'w').write('\n'.join(lines))
                captured.append((job, run, d, video, lines, end is not None))
                print(f'{job}: captured ended={end is not None}', flush=True)
    finally:
        log.close()
    with open(os.path.join(a.out, 'env.txt'), 'w') as f:
        f.write(f"device: {dev_name}\nos: {os_name}\nbuild: {a.build}\n"
                f"recorder: {'simctl recordVideo h264' if a.platform == 'ios' else 'screenrecord 20M'}\n")
    report(a, captured)


def pixel_check(video, lines, run):
    start = next((x for x in lines if x.startswith(f'POC START run={run}')), '')
    win = re.search(r'win=([\d.]+)x', start)
    return start, subprocess.run(
        [sys.executable, os.path.join(HERE, 'pixel-check.py'), video,
         '--screen-width-dp', win.group(1), '--min-fps', '60', '--windows'],
        capture_output=True, text=True) if win else None


def report(a, captured):
    with ThreadPoolExecutor(os.cpu_count()) as pool:
        checks = list(pool.map(lambda c: pixel_check(c[3], c[4], c[1]),
                               captured))
    verdicts = []
    for (job, run, d, video, lines, ended), (start, pixel) in zip(captured,
                                                                 checks):
        pixel_lines = (pixel.stdout + pixel.stderr).splitlines() \
            if pixel else ['no POC START line']
        open(os.path.join(d, 'pixel.txt'), 'w').write('\n'.join(pixel_lines))
        combo, scenario = job.split('-')
        v = judge({'run': run, 'scenario': scenario, 'clip': combo[1] == '1',
                   'inverted': combo[3] == '1'},
                  lines, pixel_lines, a.build == 'debug')
        v['ended'] = v['ended'] and ended
        v['sha'] = (re.search(r'sha=(\S+)', start) or [None, None])[1]
        json.dump(v, open(os.path.join(d, 'verdict.json'), 'w'), indent=2)
        verdicts.append(v)
        print(f"{job}: valid={v['valid']} assert_ok={v['assert_ok']} "
              f"pixel_ok={v['pixel_ok']} probe_ok={v.get('probe_ok', '-')} "
              f"bad_cycles={v['pixel_bad_cycles']}", flush=True)
    with open(os.path.join(a.out, 'summary.md'), 'w') as f:
        f.write('| run | valid | P1 assert | P2(a) bad cycles | P2(b) | fps |\n'
                '|---|---|---|---|---|---|\n')
        for v in verdicts:
            f.write(f"| {v['run']} | {v['valid']} | {v['assert_ok']} | "
                    f"{v['pixel_bad_cycles'] or 0} | {v.get('probe_ok', '—')} | "
                    f"{v['fps']} |\n")


if __name__ == '__main__':
    main()
