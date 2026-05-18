import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useZones, useHaAction } from '../api/gardenApi';
import type { ZoneSummary } from '../api/gardenApi';

const ACTUATOR_ACTIONS: Record<
  string,
  { on: string; off: string; label: string } | undefined
> = {
  waterValve: { on: 'turn_on_water', off: 'turn_off_water', label: 'Water' },
  growLight: { on: 'turn_on_light', off: 'turn_off_light', label: 'Grow Light' },
  fan: { on: 'turn_on_fan', off: 'turn_off_fan', label: 'Fan' },
  heater: { on: 'turn_on_heater', off: 'turn_off_heater', label: 'Heater' },
};

function ActuatorButtons({
  zone,
  onCommand,
  isPending,
}: {
  zone: ZoneSummary;
  onCommand: (cmd: string, zoneId: string) => void;
  isPending: boolean;
}) {
  const actions = zone.configuredActuators.flatMap((key) => {
    const a = ACTUATOR_ACTIONS[key];
    return a != null ? [{ key, ...a }] : [];
  });

  if (actions.length === 0) {
    return <Text style={styles.noActuators}>No actuators configured</Text>;
  }

  return (
    <View style={styles.actRow}>
      {actions.map((a) => (
        <View key={a.key} style={styles.actGroup}>
          <Text style={styles.actLabel}>{a.label}</Text>
          <View style={styles.actButtons}>
            <TouchableOpacity
              style={[styles.actBtn, styles.actBtnOn, isPending && styles.actBtnDisabled]}
              disabled={isPending}
              onPress={() => onCommand(a.on, zone.id)}
            >
              <Text style={styles.actBtnText}>On</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actBtn, styles.actBtnOff, isPending && styles.actBtnDisabled]}
              disabled={isPending}
              onPress={() => onCommand(a.off, zone.id)}
            >
              <Text style={styles.actBtnText}>Off</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function ZoneMap() {
  const { data: zones, isLoading, error } = useZones();
  const haAction = useHaAction();

  const handleCommand = (command: string, zoneId: string) => {
    Alert.alert('Confirm', `Send "${command}" to zone?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => haAction.mutate({ command, zoneId }) },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Zone Map</Text>
      </View>

      {isLoading && <ActivityIndicator style={styles.loader} color="#2d6a4f" />}
      {error != null && <Text style={styles.errorText}>Failed to load zones</Text>}
      {haAction.isError && <Text style={styles.errorText}>Command failed — check HA connection</Text>}
      {haAction.isSuccess && <Text style={styles.successText}>Command sent</Text>}

      {zones != null && (
        <FlatList
          data={zones}
          keyExtractor={(z) => z.id}
          renderItem={({ item }) => (
            <View style={styles.zoneCard}>
              <Text style={styles.zoneName}>{item.name}</Text>
              <ActuatorButtons
                zone={item}
                onCommand={handleCommand}
                isPending={haAction.isPending}
              />
            </View>
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No zones configured.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 16,
  },
  back: { fontSize: 24, color: '#2d6a4f' },
  heading: { fontSize: 24, fontWeight: '700', color: '#1a1a1a' },
  loader: { marginTop: 40 },
  errorText: { color: '#dc2626', textAlign: 'center', paddingVertical: 8, fontSize: 14 },
  successText: { color: '#16a34a', textAlign: 'center', paddingVertical: 8, fontSize: 14 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  zoneCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  zoneName: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 12 },
  noActuators: { color: '#9ca3af', fontSize: 13 },
  actRow: { gap: 12 },
  actGroup: { gap: 6 },
  actLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  actButtons: { flexDirection: 'row', gap: 8 },
  actBtn: { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  actBtnOn: { backgroundColor: '#2d6a4f' },
  actBtnOff: { backgroundColor: '#6b7280' },
  actBtnDisabled: { opacity: 0.5 },
  actBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  empty: { textAlign: 'center', color: '#6b7280', fontSize: 14, padding: 40 },
});
