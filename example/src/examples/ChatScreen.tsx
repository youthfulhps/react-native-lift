import { FlashList } from '@shopify/flash-list';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Liftable, useLiftScrollLock } from 'react-native-lift';
import { liftHaptic } from '../recipes/haptics';

// AC-D1: a chat on FlashList (inverted) with a Telegram-style reaction bar
// above the lifted message. itemKey is required on a recycling list.
type Message = { id: number; text: string; mine: boolean; reaction?: string };
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const SEED: Message[] = Array.from({ length: 40 }, (_, i) => ({
  id: 40 - i,
  text:
    i % 3 === 0 ? `Message ${40 - i}, a longer one that wraps` : `Hi ${40 - i}`,
  mine: i % 2 === 0,
}));
// Too tall even at minScale: lifted, the side opposite the menu is clipped.
SEED.splice(1, 0, {
  id: 100,
  text: Array.from(
    { length: 90 },
    (_, i) => `Long message, line ${i + 1}`
  ).join('\n'),
  mine: false,
});

export function ChatScreen() {
  const scrollEnabled = useLiftScrollLock();
  const [messages, setMessages] = useState(SEED);
  const [draft, setDraft] = useState('');
  const update = (id: number, patch: Partial<Message> | null) =>
    setMessages((cur) =>
      patch
        ? cur.map((m) => (m.id === id ? { ...m, ...patch } : m))
        : cur.filter((m) => m.id !== id)
    );
  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <FlashList
        inverted
        data={messages}
        keyExtractor={(m) => String(m.id)}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Liftable
            itemKey={item.id}
            haptics={liftHaptic}
            style={[styles.row, item.mine ? styles.mine : styles.theirs]}
            menu={[
              {
                key: 'reply',
                title: 'Reply',
                onPress: () => setDraft(`> ${item.text}\n`),
              },
              {
                key: 'copy',
                title: 'Copy',
                onPress: () => {},
              },
              {
                key: 'delete',
                title: 'Delete',
                destructive: true,
                onPress: () => update(item.id, null),
              },
            ]}
            renderAccessory={(close) => (
              <View style={styles.reactions}>
                {REACTIONS.map((r) => (
                  <Pressable
                    key={r}
                    hitSlop={4}
                    onPress={() => {
                      update(item.id, {
                        reaction: item.reaction === r ? undefined : r,
                      });
                      close();
                    }}
                  >
                    <Text style={styles.reaction}>{r}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          >
            <View
              style={[
                styles.bubble,
                item.mine ? styles.bubbleMine : styles.bubbleTheirs,
              ]}
            >
              <Text style={item.mine && styles.textMine}>{item.text}</Text>
              {item.reaction && (
                <Text style={styles.badge}>{item.reaction}</Text>
              )}
            </View>
          </Liftable>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Message"
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable
          style={styles.send}
          onPress={() => {
            if (draft.trim()) {
              setMessages((cur) => [
                { id: Date.now(), text: draft.trim(), mine: true },
                ...cur,
              ]);
              setDraft('');
            }
          }}
        >
          <Text style={styles.textMine}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#dfe7ee' },
  row: { maxWidth: '80%', marginHorizontal: 8, marginVertical: 3 },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  bubble: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16 },
  bubbleMine: { backgroundColor: '#2f7cf6' },
  bubbleTheirs: { backgroundColor: '#fff' },
  textMine: { color: '#fff' },
  badge: { marginTop: 4, fontSize: 14 },
  reactions: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 24,
    backgroundColor: '#fff',
  },
  reaction: { fontSize: 26 },
  composer: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    paddingBottom: 28,
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#f0f2f5',
  },
  send: {
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#2f7cf6',
  },
});
