// Formats a PlantAnalysisResponse into the payload sent to the phone app.
//
// The phone's AnnotatedImage component expects normalised 0–1 coordinates and
// hex colours — both already enforced by the zod schema in plantAnalysis.ts.
// This module is the single place that shapes the backend→phone contract.

import type { PlantAnalysisResponse } from './plantAnalysis';

// Matches AnnotatedImageProps in the mobile spec (CLAUDE.md §10).
export interface AnnotationPoint {
  x: number;
  y: number;
  label: string;
  color: string; // 6-digit hex
}

// Full payload pushed to the phone after a successful analysis.
export interface PhoneAnalysisPayload {
  spokenSummary: string;
  annotationPoints: AnnotationPoint[];
  diagnosis: PlantAnalysisResponse['diagnosis'];
  recommendations: PlantAnalysisResponse['recommendations'];
  trimming: PlantAnalysisResponse['trimming'];
  wateringNeeds: PlantAnalysisResponse['wateringNeeds'];
}

export function formatForPhone(analysis: PlantAnalysisResponse): PhoneAnalysisPayload {
  return {
    spokenSummary: analysis.spokenSummary,
    // annotationPoints already match AnnotationPoint — pass through directly.
    annotationPoints: analysis.annotationPoints,
    diagnosis: analysis.diagnosis,
    recommendations: analysis.recommendations,
    trimming: analysis.trimming,
    wateringNeeds: analysis.wateringNeeds,
  };
}
