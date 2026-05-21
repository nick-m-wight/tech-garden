import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
  StyleSheet,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, router } from 'expo-router';
import { useAnalysis, useZones, useHaAction, useDeleteAnalysis } from '../api/gardenApi';
import AnnotatedImage from '../components/AnnotatedImage';

export default function PlantAnalysis() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const analysisId = typeof id === 'string' ? id : '';

  const { data: analysis, isLoading, error } = useAnalysis(analysisId);
  const { data: zones } = useZones();
  const haAction = useHaAction();
  const deleteMutation = useDeleteAnalysis();

  const handleShare = async () => {
    if (!analysis) return;

    const lines = [
      analysis.title,
      analysis.species ? `Species: ${analysis.species}` : null,
      `Health: ${analysis.diagnosis.overallHealth}`,
      '',
      analysis.spokenSummary,
    ].filter(Boolean).join('\n');

    if (analysis.photoBase64 && (await Sharing.isAvailableAsync())) {
      const ext = analysis.photoMimeType === 'image/png' ? 'png' : 'jpg';
      const fileUri = `${FileSystem.cacheDirectory}plant-analysis-${analysisId}.${ext}`;
      await FileSystem.writeAsStringAsync(fileUri, analysis.photoBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Sharing.shareAsync(fileUri, {
        mimeType: analysis.photoMimeType,
        dialogTitle: analysis.title,
      });
    } else {
      await Share.share({ message: lines });
    }
  };

  const confirmHaAction = (command: string, zoneId: string) => {
    Alert.alert('Confirm', `Send "${command}" to zone?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => haAction.mutate({ command, zoneId }) },
    ]);
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2d6a4f" />
      </View>
    );
  }

  if (error != null || analysis == null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Could not load analysis.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.topBarActions}>
          <TouchableOpacity onPress={() => void handleShare()}>
            <Text style={styles.shareText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              Alert.alert('Delete Analysis', 'This will permanently delete the photo and analysis.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () =>
                    deleteMutation.mutate(analysisId, { onSuccess: () => router.back() }),
                },
              ])
            }
          >
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>

      {analysis.photoBase64 != null ? (
        <View style={styles.imageContainer}>
          <AnnotatedImage
            imageBase64={analysis.photoBase64}
            annotations={analysis.annotationPoints}
          />
        </View>
      ) : (
        <View style={[styles.imageContainer, styles.noPhoto]}>
          <Text style={styles.noPhotoText}>Photo not available</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Diagnosis</Text>
        {analysis.species != null && (
          <Text style={styles.species}>{analysis.species}</Text>
        )}
        <Text style={styles.health}>
          {'Overall health: '}
          <Text style={styles.healthValue}>{analysis.diagnosis.overallHealth}</Text>
        </Text>
        <Text style={styles.summary}>{analysis.spokenSummary}</Text>

        {analysis.diagnosis.issues.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              Issues ({analysis.diagnosis.issues.length})
            </Text>
            {analysis.diagnosis.issues.map((issue, i) => (
              <View key={i} style={styles.issue}>
                <Text style={styles.issueSeverity}>{issue.severity.toUpperCase()}</Text>
                <Text style={styles.issueDesc}>{issue.description}</Text>
              </View>
            ))}
          </>
        )}
      </View>

      {analysis.recommendations.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recommendations</Text>
          {analysis.recommendations.map((rec, i) => (
            <View key={i} style={styles.rec}>
              <Text style={styles.recPriority}>{rec.priority.toUpperCase()}</Text>
              <Text style={styles.recAction}>{rec.action}</Text>
            </View>
          ))}
        </View>
      )}

      {analysis.wateringNeeds.status !== 'unknown' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Watering</Text>
          <Text style={styles.waterStatus}>{analysis.wateringNeeds.status}</Text>
          <Text style={styles.waterRec}>{analysis.wateringNeeds.recommendation}</Text>
          {zones != null && zones.length > 0 && (
            <TouchableOpacity
              style={[styles.haButton, haAction.isPending && styles.haButtonDisabled]}
              disabled={haAction.isPending}
              onPress={() => {
                const zone = zones[0];
                if (zone != null) confirmHaAction('turn_on_water', zone.id);
              }}
            >
              <Text style={styles.haButtonText}>
                {haAction.isPending ? 'Sending…' : 'Send to HA — Water Now'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {analysis.trimming.needed && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Trimming Needed</Text>
          {analysis.trimming.areas.map((area, i) => (
            <Text key={i} style={styles.trimArea}>{'• ' + area}</Text>
          ))}
        </View>
      )}

      <Text style={styles.timestamp}>
        {new Date(analysis.timestamp).toLocaleString()}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  topBarActions: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  backText: { fontSize: 16, color: '#2d6a4f', fontWeight: '600' },
  shareText: { fontSize: 16, color: '#2563eb', fontWeight: '600' },
  deleteText: { fontSize: 16, color: '#dc2626', fontWeight: '600' },
  species: { fontSize: 13, color: '#6b7280', fontStyle: 'italic', marginBottom: 6 },
  imageContainer: { width: '100%', height: 300 },
  noPhoto: { backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  noPhotoText: { color: '#9ca3af', fontSize: 14 },
  card: {
    margin: 16,
    padding: 16,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 10 },
  health: { fontSize: 15, color: '#374151' },
  healthValue: { fontWeight: '600', color: '#2d6a4f' },
  summary: { fontSize: 14, color: '#6b7280', marginTop: 8, lineHeight: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#374151', marginTop: 12, marginBottom: 6 },
  issue: { marginBottom: 8 },
  issueSeverity: { fontSize: 11, fontWeight: '700', color: '#dc2626', letterSpacing: 1 },
  issueDesc: { fontSize: 14, color: '#374151', marginTop: 2 },
  rec: { marginBottom: 10 },
  recPriority: { fontSize: 11, fontWeight: '700', color: '#d97706', letterSpacing: 1 },
  recAction: { fontSize: 14, color: '#374151', marginTop: 2 },
  waterStatus: { fontSize: 15, fontWeight: '600', color: '#1d4ed8', marginBottom: 4 },
  waterRec: { fontSize: 14, color: '#374151', lineHeight: 20 },
  haButton: {
    marginTop: 12,
    backgroundColor: '#2d6a4f',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  haButtonDisabled: { backgroundColor: '#9ca3af' },
  haButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  trimArea: { fontSize: 14, color: '#374151', marginTop: 4 },
  timestamp: { textAlign: 'center', color: '#9ca3af', fontSize: 12, paddingVertical: 16 },
  errorText: { color: '#dc2626', fontSize: 16 },
  link: { color: '#2d6a4f', fontSize: 14 },
});
