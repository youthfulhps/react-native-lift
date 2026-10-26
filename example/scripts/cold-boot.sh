#!/bin/bash
# Cold boot the booted simulator/emulator before a measurement set (measurement procedure, section 1).
# Usage: cold-boot.sh ios|android
set -eu
if [ "$1" = ios ]; then
  U=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)
  xcrun simctl shutdown "$U"
  xcrun simctl boot "$U"
  xcrun simctl bootstatus "$U" -b > /dev/null
  echo "ios $U booted"
else
  AVD=$(adb emu avd name | head -1 | tr -d '\r')
  # Other sessions may share the emulator: put their port reverses back.
  REV=$(adb reverse --list | awk '{print $2}')
  adb emu kill > /dev/null
  while adb devices | grep -q emulator; do sleep 1; done
  nohup "${ANDROID_HOME:-$HOME/Library/Android/sdk}/emulator/emulator" -avd "$AVD" -no-snapshot-load -no-snapshot-save -no-audio \
    > /dev/null 2>&1 &
  adb wait-for-device
  until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
  for r in $REV; do adb reverse "$r" "$r" > /dev/null; done
  echo "android $AVD booted, reverses: $(echo $REV)"
fi
