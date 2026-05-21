import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../base/mobile/src/api/client';

export interface ZoneSummary {
  id: string;
  name: string;
  configuredSensors: string[];
  configuredActuators: string[];
}

export interface AnalysisSummary {
  analysisId: string;
  photoId: string;
  timestamp: string;
  overallHealth: string;
  title: string;
  species: string | null;
  spokenSummary: string;
  issueCount: number;
}

export interface Issue {
  severity: string;
  description: string;
  affectedArea: string;
}

export interface Recommendation {
  priority: string;
  action: string;
  reasoning: string;
}

export interface AnnotationPoint {
  x: number;
  y: number;
  label: string;
  color: string;
}

export interface AnalysisDetail {
  analysisId: string;
  photoId: string;
  photoBase64: string | null;
  photoMimeType: string;
  timestamp: string;
  title: string;
  species: string | null;
  diagnosis: {
    overallHealth: string;
    issues: Issue[];
    confidence: number;
  };
  recommendations: Recommendation[];
  annotationPoints: AnnotationPoint[];
  trimming: { needed: boolean; areas: string[] };
  wateringNeeds: { status: string; recommendation: string };
  spokenSummary: string;
}

export function useZones() {
  return useQuery({
    queryKey: ['garden', 'zones'],
    queryFn: () =>
      apiClient.get<{ zones: ZoneSummary[] }>('/api/garden/zones').then((r) => r.zones),
  });
}

export function useAnalyses(limit = 20) {
  return useQuery({
    queryKey: ['garden', 'analyses', limit],
    queryFn: () =>
      apiClient
        .get<{ analyses: AnalysisSummary[] }>(`/api/garden/analyses?limit=${limit}`)
        .then((r) => r.analyses),
  });
}

export function useAnalysis(analysisId: string) {
  return useQuery({
    queryKey: ['garden', 'analysis', analysisId],
    queryFn: () => apiClient.get<AnalysisDetail>(`/api/garden/analyses/${analysisId}`),
    enabled: !!analysisId,
  });
}

export function useDeleteAnalysis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (analysisId: string) =>
      apiClient.del<void>(`/api/garden/analyses/${analysisId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['garden', 'analyses'] });
    },
  });
}

export function useHaAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ command, zoneId }: { command: string; zoneId: string }) =>
      apiClient.post<{ status: string }>('/api/garden/ha-action', { command, zoneId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['garden'] });
    },
  });
}
