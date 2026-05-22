import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAnalysis, useZones, useHaAction, useDeleteAnalysis, useReanalyze } from '../api/gardenApi';
import AnnotatedImage from '../components/AnnotatedImage';
import CropZoomView, { type CropRect } from '../components/CropZoomView';

export default function PlantAnalysis() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const analysisId = typeof id === 'string' ? id : '';

  const { data: analysis, isLoading, error } = useAnalysis(analysisId);
  const { data: zones } = useZones();
  const haAction = useHaAction();
  const deleteMutation = useDeleteAnalysis();
  const reanalyzeMutation = useReanalyze();
  const [cropMode, setCropMode] = useState(false);
  const [speciesInput, setSpeciesInput] = useState('');

  const handleCrop = (rect: CropRect) => {
    setCropMode(false);
    if (!analysis?.photoBase64) return;
    reanalyzeMutation.mutate(
      { imageBase64: analysis.photoBase64, cropRect: rect, zoneId: zones?.[0]?.id },
      {
        onSuccess: ({ analysisId: newId }) => {
          setSpeciesInput('');
          router.push({ pathname: '/(app)/plant-analysis', params: { id: newId } });
        },
        onError: () => {
          Alert.alert('Analysis failed', 'Could not analyse the cropped area. Please try again.');
        },
      },
    );
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
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.navigate('/(app)/plant-history')}>
            <Text style={styles.backText}>← History</Text>
          </TouchableOpacity>
          <View style={styles.topBarActions}>
            {analysis.photoBase64 != null && (
              <TouchableOpacity onPress={() => setCropMode(true)}>
                <Text style={styles.cropText}>Inspect</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() =>
                Alert.alert(
                  'Delete Analysis',
                  'This will permanently delete the photo and analysis.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () =>
                        deleteMutation.mutate(analysisId, { onSuccess: () => router.back() }),
                    },
                  ],
                )
              }
            >
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>

        {reanalyzeMutation.isPending && (
          <View style={styles.reanalyzeBar}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.reanalyzeText}>Analysing crop…</Text>
          </View>
        )}

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
            <>
              <Text style={styles.species}>{analysis.species}</Text>
              {analysis.speciesConfidence !== 'high' && (
                <Text style={styles.speciesConfidenceWarning}>
                  {analysis.speciesConfidence === 'low'
                    ? 'Low confidence identification — verify species'
                    : 'Moderate confidence — identification may vary'}
                </Text>
              )}
            </>
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

        {analysis.photoBase64 != null && (
          <View style={styles.card}>
            <Text style={styles.correctTitle}>Wrong plant?</Text>
            <Text style={styles.correctSubtitle}>Type the correct name and re-analyze with the same photo.</Text>
            <TextInput
              style={styles.speciesInput}
              placeholder="e.g. Rose, Basil, Spider Plant…"
              placeholderTextColor="#9ca3af"
              value={speciesInput}
              onChangeText={setSpeciesInput}
              returnKeyType="done"
              autoCorrect={false}
            />
            {speciesInput.trim().length > 0 && (
              <TouchableOpacity
                style={[styles.speciesReanalyzeBtn, reanalyzeMutation.isPending && styles.btnDisabled]}
                disabled={reanalyzeMutation.isPending}
                onPress={() =>
                  reanalyzeMutation.mutate(
                    { imageBase64: analysis.photoBase64!, zoneId: zones?.[0]?.id, speciesHint: speciesInput.trim() },
                    {
                      onSuccess: ({ analysisId: newId }) => {
                        setSpeciesInput('');
                        deleteMutation.mutate(analysisId);
                        router.push({ pathname: '/(app)/plant-analysis', params: { id: newId } });
                      },
                      onError: () => Alert.alert('Failed', 'Could not re-analyze. Please try again.'),
                    },
                  )
                }
              >
                {reanalyzeMutation.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.speciesReanalyzeText}>Re-analyze as {speciesInput.trim()}</Text>
                }
              </TouchableOpacity>
            )}
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
              <Text key={i} style={styles.trimArea}>{'• ' + area.description}</Text>
            ))}
          </View>
        )}

        <Text style={styles.timestamp}>
          {new Date(analysis.timestamp).toLocaleString()}
        </Text>
      </ScrollView>

      {/* Full-screen crop modal — GestureHandlerRootView required inside Modal */}
      <Modal visible={cropMode} animationType="slide" statusBarTranslucent>
        <GestureHandlerRootView style={{ flex: 1 }}>
          {analysis.photoBase64 != null && (
            <CropZoomView
              imageBase64={analysis.photoBase64}
              mimeType={analysis.photoMimeType}
              onCrop={handleCrop}
              onCancel={() => setCropMode(false)}
            />
          )}
        </GestureHandlerRootView>
      </Modal>
    </>
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
  topBarActions: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  backText: { fontSize: 16, color: '#2d6a4f', fontWeight: '600' },
  cropText: { fontSize: 15, color: '#2563eb', fontWeight: '600' },
  deleteText: { fontSize: 16, color: '#dc2626', fontWeight: '600' },
  correctTitle: { fontSize: 15, fontWeight: '700', color: '#374151', marginBottom: 4 },
  correctSubtitle: { fontSize: 13, color: '#6b7280', marginBottom: 10, lineHeight: 18 },
  speciesInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#fff',
  },
  speciesReanalyzeBtn: {
    marginTop: 10,
    backgroundColor: '#2d6a4f',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  speciesReanalyzeText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.4 },
  reanalyzeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#2d6a4f',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  reanalyzeText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  species: { fontSize: 13, color: '#6b7280', fontStyle: 'italic', marginBottom: 2 },
  speciesConfidenceWarning: { fontSize: 11, color: '#d97706', marginBottom: 6 },
  imageContainer: { width: '100%', aspectRatio: 1, overflow: 'hidden' },
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
