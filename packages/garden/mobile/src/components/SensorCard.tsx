import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const LABELS: Record<string, string | undefined> = {
  soilMoisture: 'Soil Moisture',
  temperature: 'Temperature',
  humidity: 'Humidity',
  lightLevel: 'Light',
  pH: 'pH',
  npk: 'NPK',
  rain: 'Rain',
  waterValve: 'Water Valve',
  growLight: 'Grow Light',
  fan: 'Fan',
  heater: 'Heater',
};

interface SensorCardProps {
  label: string;
  value?: string;
  unit?: string;
  isActuator?: boolean;
}

export default function SensorCard({ label, value, unit, isActuator = false }: SensorCardProps) {
  const display = LABELS[label] ?? label;
  return (
    <View style={[styles.chip, isActuator ? styles.actuatorChip : styles.sensorChip]}>
      <Text style={[styles.chipText, isActuator ? styles.actuatorText : styles.sensorText]}>
        {display}
        {value !== undefined ? `: ${value}${unit !== undefined ? ' ' + unit : ''}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  sensorChip: { backgroundColor: '#d1fae5' },
  actuatorChip: { backgroundColor: '#dbeafe' },
  chipText: { fontSize: 12, fontWeight: '500' },
  sensorText: { color: '#065f46' },
  actuatorText: { color: '#1e40af' },
});
