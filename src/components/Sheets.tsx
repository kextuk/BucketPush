import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export type SheetOption = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

/** Menu d'actions qui glisse depuis le bas. Fermable au tap hors zone et au bouton retour. */
export function ActionSheet({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title?: string;
  options: SheetOption[];
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.card} onPress={() => {}}>
          {title ? <Text style={s.title}>{title}</Text> : null}
          {options.map((o, i) => (
            <Pressable
              key={i}
              style={s.opt}
              onPress={() => {
                onClose();
                o.onPress();
              }}>
              <Text style={[s.optText, o.destructive && s.destructive]}>{o.label}</Text>
            </Pressable>
          ))}
          <Pressable style={s.opt} onPress={onClose}>
            <Text style={[s.optText, s.cancel]}>Annuler</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Boîte de saisie d'une ligne (Android n'a pas Alert.prompt). */
export function PromptModal({
  visible,
  title,
  initial,
  placeholder,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  initial: string;
  placeholder: string;
  onCancel: () => void;
  onSubmit: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    if (visible) setV(initial);
  }, [visible, initial]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={s.promptBackdrop} onPress={onCancel}>
          <Pressable style={s.promptCard} onPress={() => {}}>
            <Text style={s.title}>{title}</Text>
            <TextInput
              style={s.input}
              value={v}
              onChangeText={setV}
              placeholder={placeholder}
              placeholderTextColor="#888"
              autoFocus
              autoCapitalize="none"
              onSubmitEditing={() => v.trim() && onSubmit(v.trim())}
              returnKeyType="done"
            />
            <View style={s.promptActions}>
              <Pressable onPress={onCancel} hitSlop={8}>
                <Text style={s.cancelBtn}>Annuler</Text>
              </Pressable>
              <Pressable onPress={() => onSubmit(v.trim())} disabled={!v.trim()} hitSlop={8}>
                <Text style={[s.okBtn, !v.trim() && s.okDisabled]}>OK</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' },
  card: {
    backgroundColor: '#1c1c1e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingVertical: 8,
    paddingBottom: 28,
  },
  title: { color: '#fff', fontSize: 14, fontWeight: '700', padding: 16, opacity: 0.8 },
  opt: { paddingVertical: 15, paddingHorizontal: 20 },
  optText: { color: '#0a84ff', fontSize: 16, fontWeight: '600' },
  destructive: { color: '#ff5a5a' },
  cancel: { color: '#8e8e93' },

  flex: { flex: 1 },
  promptBackdrop: {
    flex: 1,
    backgroundColor: '#0009',
    justifyContent: 'flex-end',
  },
  promptCard: {
    margin: 12,
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    padding: 20,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#fff',
    marginTop: 12,
  },
  promptActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 16 },
  cancelBtn: { color: '#8e8e93', fontSize: 15 },
  okBtn: { color: '#0a84ff', fontSize: 15, fontWeight: '700' },
  okDisabled: { opacity: 0.4 },
});
