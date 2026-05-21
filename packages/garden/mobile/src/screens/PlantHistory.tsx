import React, { useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { router } from 'expo-router';
import { useAnalyses, useDeleteAnalysis } from '../api/gardenApi';
import type { AnalysisSummary } from '../api/gardenApi';

function healthBadgeColor(health: string): { backgroundColor: string } {
  const h = health.toLowerCase();
  if (h.includes('good') || h.includes('healthy') || h.includes('excellent')) {
    return { backgroundColor: '#d1fae5' };
  }
  if (h.includes('poor') || h.includes('critical') || h.includes('severe')) {
    return { backgroundColor: '#fee2e2' };
  }
  return { backgroundColor: '#fef3c7' };
}

function HistoryItem({
  item,
  onDelete,
}: {
  item: AnalysisSummary;
  onDelete: () => void;
}) {
  const swipeableRef = useRef<Swipeable>(null);
  const date = new Date(item.timestamp).toLocaleDateString();
  const time = new Date(item.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleDeletePress = () => {
    swipeableRef.current?.close();
    Alert.alert(
      'Delete Analysis',
      'This will permanently delete the photo and analysis.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ],
    );
  };

  const renderRightActions = () => (
    <TouchableOpacity style={styles.deleteAction} onPress={handleDeletePress}>
      <Text style={styles.deleteActionText}>Delete</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable ref={swipeableRef} renderRightActions={renderRightActions}>
      <TouchableOpacity
        style={styles.item}
        onPress={() =>
          router.push({ pathname: '/(app)/plant-analysis', params: { id: item.analysisId } })
        }
      >
        <View style={styles.itemHeader}>
          <Text style={styles.itemDate}>
            {date} {time}
          </Text>
          <View style={[styles.healthBadge, healthBadgeColor(item.overallHealth)]}>
            <Text style={styles.healthBadgeText}>{item.overallHealth}</Text>
          </View>
        </View>
        <Text style={styles.itemSummary} numberOfLines={2}>
          {item.spokenSummary}
        </Text>
        {item.issueCount > 0 && (
          <Text style={styles.issueCount}>
            {item.issueCount} issue{item.issueCount !== 1 ? 's' : ''}
          </Text>
        )}
      </TouchableOpacity>
    </Swipeable>
  );
}

export default function PlantHistory() {
  const { data: analyses, isLoading, error, refetch } = useAnalyses(50);
  const deleteMutation = useDeleteAnalysis();

  const handleDelete = (analysisId: string) => {
    deleteMutation.mutate(analysisId);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Plant History</Text>
      </View>

      {isLoading && <ActivityIndicator style={styles.loader} color="#2d6a4f" />}

      {error != null && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Failed to load history</Text>
          <TouchableOpacity onPress={() => void refetch()}>
            <Text style={styles.link}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {analyses != null && (
        <FlatList
          data={analyses}
          keyExtractor={(a) => a.analysisId}
          renderItem={({ item }) => (
            <HistoryItem item={item} onDelete={() => handleDelete(item.analysisId)} />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No analyses yet. Use the glasses button to capture a photo.
            </Text>
          }
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText: { color: '#dc2626', fontSize: 15 },
  link: { color: '#2d6a4f', fontSize: 14 },
  empty: { textAlign: 'center', color: '#6b7280', fontSize: 14, padding: 40, lineHeight: 22 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  item: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemDate: { fontSize: 13, color: '#6b7280' },
  healthBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  healthBadgeText: { fontSize: 12, fontWeight: '600', color: '#111' },
  itemSummary: { fontSize: 14, color: '#374151', lineHeight: 20 },
  issueCount: { fontSize: 12, color: '#dc2626', marginTop: 6, fontWeight: '500' },
  deleteAction: {
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 12,
    marginBottom: 12,
  },
  deleteActionText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
