import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../../../base/mobile/src/store/authStore';
import { useZones } from '../api/gardenApi';
import type { ZoneSummary } from '../api/gardenApi';
import SensorCard from '../components/SensorCard';

function ZoneCard({ zone }: { zone: ZoneSummary }) {
  return (
    <View style={styles.zoneCard}>
      <Text style={styles.zoneName}>{zone.name}</Text>
      <View style={styles.chips}>
        {zone.configuredSensors.map((s) => (
          <SensorCard key={s} label={s} />
        ))}
        {zone.configuredActuators.map((a) => (
          <SensorCard key={a} label={a} isActuator />
        ))}
        {zone.configuredSensors.length === 0 && zone.configuredActuators.length === 0 && (
          <Text style={styles.empty}>No devices configured</Text>
        )}
      </View>
    </View>
  );
}

export default function GardenDashboard() {
  const logout = useAuthStore((s) => s.logout);
  const { data: zones, isLoading, error } = useZones();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Garden</Text>
        <TouchableOpacity onPress={() => void logout()}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.navRow}>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => router.push('/(app)/plant-history')}
        >
          <Text style={styles.navButtonText}>Plant History</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => router.push('/(app)/zone-map')}
        >
          <Text style={styles.navButtonText}>Zone Map</Text>
        </TouchableOpacity>
      </View>

      {isLoading && <ActivityIndicator style={styles.loader} color="#2d6a4f" />}
      {error != null && <Text style={styles.errorText}>Failed to load zones</Text>}

      {zones != null && (
        <FlatList
          data={zones}
          keyExtractor={(z) => z.id}
          renderItem={({ item }) => <ZoneCard zone={item} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyList}>No zones configured yet.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 56 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  heading: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  signOut: { fontSize: 14, color: '#6b7280' },
  navRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginBottom: 20 },
  navButton: {
    flex: 1,
    backgroundColor: '#2d6a4f',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  navButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  loader: { marginTop: 40 },
  errorText: { color: '#dc2626', textAlign: 'center', marginTop: 20 },
  list: { paddingHorizontal: 20, gap: 16, paddingBottom: 40 },
  zoneCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  zoneName: { fontSize: 18, fontWeight: '600', color: '#111827', marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  empty: { color: '#9ca3af', fontSize: 13 },
  emptyList: { textAlign: 'center', color: '#6b7280', fontSize: 14, padding: 40 },
});
