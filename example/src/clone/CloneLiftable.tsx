import { useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type HostInstance,
} from 'react-native';

// AC-D3: the clone approach, written here on its own (nothing from the
// library): a long press measures the view and renders a second copy of its
// children in a modal over it. The copy is a new mount: a video restarts,
// typed text and focus are gone. That is why the library lifts the real view.
export function CloneLiftable({ children }: { children: ReactNode }) {
  const ref = useRef<HostInstance>(null);
  const [rect, setRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  return (
    <>
      <Pressable
        ref={ref}
        delayLongPress={400}
        onLongPress={() =>
          ref.current?.measureInWindow((x, y, width, height) =>
            setRect({ x, y, width, height })
          )
        }
        style={rect && styles.hidden}
      >
        {children}
      </Pressable>
      <Modal transparent visible={rect !== null} animationType="fade">
        <Pressable
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          onPress={() => setRect(null)}
        />
        {rect && (
          <View
            style={[
              styles.copy,
              { left: rect.x, top: rect.y, width: rect.width },
            ]}
          >
            {children}
          </View>
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.25)' },
  copy: { position: 'absolute' },
});
