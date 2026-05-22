import React, { useRef, useState, useCallback } from 'react';
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
import { router, useFocusEffect } from 'expo-router';
import { useAnalyses, useDeleteAnalysis, useDeleteAnalysesBulk } from '../api/gardenApi';
import { useAnalysisEvents } from '../api/useAnalysisEvents';
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
  selectMode,
  selected,
  onToggleSelect,
}: {
  item: AnalysisSummary;
  onDelete: () => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const swipeableRef = useRef<Swipeable>(null);
  const date = new Date(item.timestamp).toLocaleDateString();
  const time = new Date(item.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (selectMode) {
    return (
      <TouchableOpacity
        style={[styles.item, selected && styles.itemSelected]}
        onPress={onToggleSelect}
      >
        <View style={styles.itemHeader}>
          <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
            {selected && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.species ?? 'Unknown'}
          </Text>
          <View style={[styles.healthBadge, healthBadgeColor(item.overallHealth)]}>
            <Text style={styles.healthBadgeText}>{item.overallHealth}</Text>
          </View>
        </View>
        {item.issueCount > 0 && (
          <Text style={styles.issueCount}>
            {item.issueCount} issue{item.issueCount !== 1 ? 's' : ''}
          </Text>
        )}
        <Text style={styles.itemDate}>{date} {time}</Text>
      </TouchableOpacity>
    );
  }

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

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={() => (
        <TouchableOpacity style={styles.deleteAction} onPress={handleDeletePress}>
          <Text style={styles.deleteActionText}>Delete</Text>
        </TouchableOpacity>
      )}
    >
      <TouchableOpacity
        style={styles.item}
        onPress={() =>
          router.push({ pathname: '/(app)/plant-analysis', params: { id: item.analysisId } })
        }
      >
        <View style={styles.itemHeader}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.species ?? 'Unknown'}
          </Text>
          <View style={[styles.healthBadge, healthBadgeColor(item.overallHealth)]}>
            <Text style={styles.healthBadgeText}>{item.overallHealth}</Text>
          </View>
        </View>
        {item.issueCount > 0 && (
          <Text style={styles.issueCount}>
            {item.issueCount} issue{item.issueCount !== 1 ? 's' : ''}
          </Text>
        )}
        <Text style={styles.itemDate}>{date} {time}</Text>
      </TouchableOpacity>
    </Swipeable>
  );
}

export default function PlantHistory() {
  const { data: analyses, isLoading, error, refetch } = useAnalyses(50);
  useAnalysisEvents();
  const deleteMutation = useDeleteAnalysis();
  const deleteBulkMutation = useDeleteAnalysesBulk();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected =
    analyses != null && analyses.length > 0 && selectedIds.size === analyses.length;

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleDeleteSelected = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    Alert.alert(
      'Delete Analyses',
      `Permanently delete ${ids.length} item${ids.length !== 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteBulkMutation.mutate(ids, { onSuccess: exitSelectMode }),
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerLeft}
          onPress={selectMode ? exitSelectMode : () => router.back()}
        >
          <Text style={selectMode ? styles.cancelText : styles.back}>
            {selectMode ? 'Cancel' : '←'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Plant History</Text>
        {!selectMode ? (
          <TouchableOpacity
            style={styles.headerRight}
            onPress={() => setSelectMode(true)}
            disabled={!analyses || analyses.length === 0}
          >
            <Text
              style={[
                styles.selectButton,
                (!analyses || analyses.length === 0) && styles.buttonDisabled,
              ]}
            >
              Select
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.headerRight, styles.selectActions]}>
            <TouchableOpacity
              onPress={
                allSelected
                  ? () => setSelectedIds(new Set())
                  : () => {
                      if (analyses) setSelectedIds(new Set(analyses.map((a) => a.analysisId)));
                    }
              }
            >
              <Text style={styles.selectButton}>{allSelected ? 'None' : 'All'}</Text>
            </TouchableOpacity>
            {selectedIds.size > 0 && (
              <TouchableOpacity
                onPress={handleDeleteSelected}
                disabled={deleteBulkMutation.isPending}
              >
                <Text
                  style={[
                    styles.deleteSelectedButton,
                    deleteBulkMutation.isPending && styles.buttonDisabled,
                  ]}
                >
                  Delete {selectedIds.size}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {isLoading && <ActivityIndicator style={styles.loader} color="#2d6a4f" />}

      {error != null && analyses == null && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Failed to load history</Text>
          <TouchableOpacity onPress={() => void refetch()}>
            <Text style={styles.link}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {error != null && analyses != null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>Refresh failed</Text>
          <TouchableOpacity onPress={() => void refetch()}>
            <Text style={styles.errorBannerRetry}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {analyses != null && (
        <FlatList
          data={analyses}
          keyExtractor={(a) => a.analysisId}
          renderItem={({ item }) => (
            <HistoryItem
              item={item}
              onDelete={() => deleteMutation.mutate(item.analysisId)}
              selectMode={selectMode}
              selected={selectedIds.has(item.analysisId)}
              onToggleSelect={() => toggleSelect(item.analysisId)}
            />
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
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerLeft: { minWidth: 48 },
  headerRight: { minWidth: 48, alignItems: 'flex-end' },
  selectActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  back: { fontSize: 24, color: '#2d6a4f' },
  cancelText: { fontSize: 15, color: '#6b7280', fontWeight: '500' },
  heading: { fontSize: 24, fontWeight: '700', color: '#1a1a1a' },
  selectButton: { fontSize: 15, color: '#2d6a4f', fontWeight: '600' },
  deleteSelectedButton: { fontSize: 15, color: '#dc2626', fontWeight: '600' },
  buttonDisabled: { opacity: 0.4 },
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
  itemSelected: { backgroundColor: '#ecfdf5', borderColor: '#6ee7b7' },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#d1d5db',
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: { backgroundColor: '#2d6a4f', borderColor: '#2d6a4f' },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', flex: 1, marginRight: 8 },
  itemSpecies: { fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginBottom: 4 },
  healthBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  healthBadgeText: { fontSize: 12, fontWeight: '600', color: '#111' },
  issueCount: { fontSize: 12, color: '#dc2626', marginTop: 2, fontWeight: '500' },
  itemDate: { fontSize: 11, color: '#9ca3af', marginTop: 6, textAlign: 'right' },
  deleteAction: {
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 12,
    marginBottom: 12,
  },
  deleteActionText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorBannerText: { fontSize: 13, color: '#dc2626' },
  errorBannerRetry: { fontSize: 13, color: '#dc2626', fontWeight: '700' },
});
