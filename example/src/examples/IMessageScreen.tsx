import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Liftable, useLiftScrollLock } from 'react-native-lift';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { blurBackdrop } from '../recipes/blurBackdrop';
import { liftHaptic } from '../recipes/haptics';

// README demo: an iMessage-style thread. Long press a bubble for tapbacks
// and the menu; the picked tapback sits on the bubble's top corner.
type Message = { id: number; text: string; mine: boolean; tapback?: string };
const TAPBACKS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
const BLUE = '#0a84ff';
const GRAY = '#e9e9eb';
const SEED: Message[] = [
  { id: 1, text: 'Are we still on for tonight? 🍜', mine: false },
  { id: 2, text: 'Yes! 7 at the ramen place?', mine: true },
  { id: 3, text: 'Perfect. I’ll grab a table', mine: false },
  { id: 4, text: 'Also… did you finish the slides?', mine: false },
  { id: 5, text: 'Just sent them over', mine: true },
  {
    id: 6,
    text: 'Took me all weekend but I think they’re good',
    mine: true,
    tapback: '❤️',
  },
  { id: 7, text: 'Just looked. They’re SO good 😮', mine: false },
  { id: 8, text: 'The animation on slide 4 is unreal', mine: false },
  { id: 9, text: 'Haha thank you!! See you at 7', mine: true },
];

export function IMessageScreen() {
  const insets = useSafeAreaInsets();
  const scrollEnabled = useLiftScrollLock();
  const [messages, setMessages] = useState(SEED);
  const setTapback = (id: number, tapback: string) =>
    setMessages((cur) =>
      cur.map((m) =>
        m.id === id
          ? { ...m, tapback: m.tapback === tapback ? undefined : tapback }
          : m
      )
    );
  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Text style={styles.back}>‹ 12</Text>
        <View style={styles.contact}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>MK</Text>
          </View>
          <Text style={styles.name}>Mina ›</Text>
        </View>
        <View style={styles.video}>
          <View style={styles.videoBody} />
          <View style={styles.videoLens} />
        </View>
      </View>
      <ScrollView
        scrollEnabled={scrollEnabled}
        contentContainerStyle={styles.thread}
      >
        <Text style={styles.stamp}>
          <Text style={styles.stampDay}>Today</Text> 9:41 AM
        </Text>
        {messages.map((m, i) => {
          const first = messages[i - 1]?.mine !== m.mine;
          return (
            <Liftable
              key={m.id}
              haptics={liftHaptic}
              renderBackdrop={blurBackdrop}
              style={[
                styles.row,
                m.mine ? styles.rowMine : styles.rowTheirs,
                first && i > 0 && styles.groupGap,
                m.tapback && styles.tapbackGap,
              ]}
              menu={[
                { key: 'reply', title: 'Reply', onPress: () => {} },
                { key: 'copy', title: 'Copy', onPress: () => {} },
                { key: 'translate', title: 'Translate', onPress: () => {} },
              ]}
              renderAccessory={(close) => (
                <View style={styles.tapbacks}>
                  {TAPBACKS.map((t) => (
                    <Pressable
                      key={t}
                      testID={`tapback-${t}`}
                      hitSlop={4}
                      style={[
                        styles.tapbackChoice,
                        m.tapback === t && styles.tapbackChosen,
                      ]}
                      onPress={() => {
                        setTapback(m.id, t);
                        close();
                      }}
                    >
                      <Text style={styles.tapbackChoiceText}>{t}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            >
              <View
                style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}
              >
                <Text style={[styles.text, m.mine && styles.textMine]}>
                  {m.text}
                </Text>
                {m.tapback && (
                  <Animated.View
                    entering={ZoomIn.springify()}
                    style={[
                      styles.badge,
                      m.mine ? styles.badgeMine : styles.badgeTheirs,
                    ]}
                  >
                    <Text style={styles.badgeText}>{m.tapback}</Text>
                  </Animated.View>
                )}
              </View>
            </Liftable>
          );
        })}
        <Text style={styles.read}>
          <Text style={styles.readBold}>Read</Text> 9:43 AM
        </Text>
      </ScrollView>
      <View style={[styles.composer, { paddingBottom: insets.bottom + 6 }]}>
        <View style={styles.plus}>
          <Text style={styles.plusText}>+</Text>
        </View>
        <View style={styles.input}>
          <Text style={styles.placeholder}>iMessage</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: '#f6f6f6',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#c8c8cc',
  },
  back: { width: 60, marginBottom: 18, fontSize: 20, color: BLUE },
  contact: { alignItems: 'center', gap: 4 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a5abb6',
  },
  initials: { fontSize: 22, fontWeight: '500', color: '#fff' },
  name: { fontSize: 12, color: '#1c1c1e' },
  video: {
    width: 60,
    marginBottom: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  videoBody: { width: 20, height: 14, borderRadius: 3, backgroundColor: BLUE },
  videoLens: {
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderRightWidth: 7,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: BLUE,
    marginLeft: 1,
  },
  thread: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 },
  stamp: {
    alignSelf: 'center',
    marginBottom: 10,
    fontSize: 12,
    color: '#8e8e93',
  },
  stampDay: { fontWeight: '600' },
  row: { maxWidth: '75%', marginTop: 2 },
  rowMine: { alignSelf: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start' },
  groupGap: { marginTop: 10 },
  tapbackGap: { marginTop: 22 },
  bubble: { paddingVertical: 8, paddingHorizontal: 13, borderRadius: 19 },
  mine: { backgroundColor: BLUE },
  theirs: { backgroundColor: GRAY },
  text: { fontSize: 17, lineHeight: 22, color: '#000' },
  textMine: { color: '#fff' },
  badge: {
    position: 'absolute',
    top: -18,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A tapback I put on their bubble is blue; theirs on mine is gray.
  badgeTheirs: { right: -14, backgroundColor: BLUE },
  badgeMine: { left: -14, backgroundColor: GRAY },
  badgeText: { fontSize: 15 },
  tapbacks: {
    flexDirection: 'row',
    gap: 2,
    padding: 5,
    borderRadius: 26,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  tapbackChoice: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tapbackChosen: { backgroundColor: BLUE },
  tapbackChoiceText: { fontSize: 22 },
  read: {
    alignSelf: 'flex-end',
    marginTop: 4,
    marginRight: 4,
    fontSize: 11,
    color: '#8e8e93',
  },
  readBold: { fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingTop: 6,
    backgroundColor: '#fff',
  },
  plus: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e9e9eb',
  },
  plusText: { fontSize: 24, lineHeight: 26, color: '#8e8e93' },
  input: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d1d1d6',
  },
  placeholder: { fontSize: 17, color: '#c7c7cc' },
});
