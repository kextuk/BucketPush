import React from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { useThemeColors } from '../theme';

/** Champ vertical : libellé au-dessus, contenu, puis indice optionnel. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const c = useThemeColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      {children}
      {hint ? <Text style={[styles.hint, { color: c.dim }]}>{hint}</Text> : null}
    </View>
  );
}

/** Ligne horizontale : libellé (+ indice) à gauche, contrôle à droite. */
export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const c = useThemeColors();
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchLabel}>
        <Text style={[styles.label, { color: c.text }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: c.dim }]}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** TextInput entier borné (vide autorisé → `undefined`). */
export function IntInput({
  value,
  onChange,
  min,
  max,
  placeholder,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  placeholder?: string;
}) {
  const c = useThemeColors();
  return (
    <TextInput
      style={[styles.input, { color: c.text, backgroundColor: c.inputBg, borderColor: c.line }]}
      keyboardType="number-pad"
      placeholder={placeholder}
      placeholderTextColor={c.placeholder}
      value={value != null ? String(value) : ''}
      onChangeText={txt => {
        const s = txt.replace(/[^0-9]/g, '');
        if (!s) return onChange(undefined);
        onChange(Math.min(max, Math.max(min, parseInt(s, 10))));
      }}
    />
  );
}

/** Style de base d'un champ texte ; fusionner avec `{ color, backgroundColor, borderColor }`
 *  via `useThemeColors()` côté appelant (ex. `[controlStyles.input, { color: c.text, ... }]`). */
export const controlStyles = StyleSheet.create({
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15,
  },
});

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  hint: { fontSize: 11, marginTop: 4 },
  input: controlStyles.input,
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  switchLabel: { flex: 1 },
});
