// Plant and analysis history — CRUD for plants and analyses tables.
//
// OWASP A01 — every query scoped to userId; no direct object reference.
// OWASP A03 — all inputs go through parameterised queries only.
// OWASP A09 — writes and deletes audit-logged.

import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { auditLog } from '../../../../base/backend/src/audit/logger';
import type { PlantAnalysisResponse } from '../ai/plantAnalysis';

// ---- DB row types ----

interface PlantRow {
  id: string;
  user_id: string;
  name: string;
  species: string | null;
  zone_id: string | null;
  created_at: number;
  notes: string | null;
}

export interface PlantRecord {
  plantId: string;
  userId: string;
  name: string;
  species: string | null;
  zoneId: string | null;
  createdAt: Date;
  notes: string | null;
}

interface AnalysisRow {
  id: string;
  photo_id: string;
  user_id: string;
  diagnosis: string;
  recommendations: string;
  spoken_summary: string;
  raw_response: string;
  created_at: number;
}

export interface AnalysisRecord {
  analysisId: string;
  photoId: string;
  userId: string;
  diagnosis: PlantAnalysisResponse['diagnosis'];
  recommendations: PlantAnalysisResponse['recommendations'];
  spokenSummary: string;
  rawResponse: string;
  createdAt: Date;
}

function rowToPlant(row: PlantRow): PlantRecord {
  return {
    plantId: row.id,
    userId: row.user_id,
    name: row.name,
    species: row.species,
    zoneId: row.zone_id,
    createdAt: new Date(row.created_at * 1000),
    notes: row.notes,
  };
}

function rowToAnalysis(row: AnalysisRow): AnalysisRecord {
  return {
    analysisId: row.id,
    photoId: row.photo_id,
    userId: row.user_id,
    diagnosis: JSON.parse(row.diagnosis) as PlantAnalysisResponse['diagnosis'],
    recommendations: JSON.parse(row.recommendations) as PlantAnalysisResponse['recommendations'],
    spokenSummary: row.spoken_summary,
    rawResponse: row.raw_response,
    createdAt: new Date(row.created_at * 1000),
  };
}

// ---- Plants CRUD ----

export interface CreatePlantParams {
  userId: string;
  name: string;
  species?: string;
  zoneId?: string;
  notes?: string;
}

export function createPlant(db: Database, params: CreatePlantParams): PlantRecord {
  const plantId = crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO plants (id, user_id, name, species, zone_id, created_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    plantId,
    params.userId,
    params.name,
    params.species ?? null,
    params.zoneId ?? null,
    ts,
    params.notes ?? null,
  );

  auditLog({
    action: 'plant.create',
    userId: params.userId,
    result: 'success',
    metadata: { plantId, name: params.name, zoneId: params.zoneId },
  });

  return {
    plantId,
    userId: params.userId,
    name: params.name,
    species: params.species ?? null,
    zoneId: params.zoneId ?? null,
    createdAt: new Date(ts * 1000),
    notes: params.notes ?? null,
  };
}

export function getPlantById(
  db: Database,
  plantId: string,
  userId: string,
): PlantRecord | null {
  const row = db
    .prepare('SELECT * FROM plants WHERE id = ? AND user_id = ?')
    .get(plantId, userId) as PlantRow | undefined;
  return row !== undefined ? rowToPlant(row) : null;
}

export function getPlantsByUser(db: Database, userId: string): PlantRecord[] {
  const rows = db
    .prepare('SELECT * FROM plants WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as PlantRow[];
  return rows.map(rowToPlant);
}

export interface UpdatePlantParams {
  name?: string;
  species?: string | null;
  zoneId?: string | null;
  notes?: string | null;
}

export function updatePlant(
  db: Database,
  plantId: string,
  userId: string,
  params: UpdatePlantParams,
): PlantRecord | null {
  const existing = getPlantById(db, plantId, userId);
  if (!existing) return null;

  db.prepare(
    `UPDATE plants
     SET name = ?, species = ?, zone_id = ?, notes = ?
     WHERE id = ? AND user_id = ?`,
  ).run(
    params.name ?? existing.name,
    'species' in params ? params.species : existing.species,
    'zoneId' in params ? params.zoneId : existing.zoneId,
    'notes' in params ? params.notes : existing.notes,
    plantId,
    userId,
  );

  auditLog({
    action: 'plant.update',
    userId,
    result: 'success',
    metadata: { plantId },
  });

  return getPlantById(db, plantId, userId);
}

export function deletePlant(db: Database, plantId: string, userId: string): void {
  const row = db
    .prepare('SELECT id FROM plants WHERE id = ? AND user_id = ?')
    .get(plantId, userId) as { id: string } | undefined;

  if (!row) {
    auditLog({
      action: 'plant.delete',
      userId,
      result: 'denied',
      metadata: { plantId, reason: 'not_found_or_wrong_user' },
    });
    return;
  }

  db.prepare('DELETE FROM plants WHERE id = ? AND user_id = ?').run(plantId, userId);

  auditLog({ action: 'plant.delete', userId, result: 'success', metadata: { plantId } });
}

// ---- Analyses CRUD ----

export interface SaveAnalysisParams {
  photoId: string;
  userId: string;
  analysis: PlantAnalysisResponse;
  rawResponse: string;
}

export function saveAnalysis(db: Database, params: SaveAnalysisParams): AnalysisRecord {
  const analysisId = crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO analyses
       (id, photo_id, user_id, diagnosis, recommendations, spoken_summary, raw_response, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    analysisId,
    params.photoId,
    params.userId,
    JSON.stringify(params.analysis.diagnosis),
    JSON.stringify(params.analysis.recommendations),
    params.analysis.spokenSummary,
    params.rawResponse,
    ts,
  );

  auditLog({
    action: 'analysis.save',
    userId: params.userId,
    result: 'success',
    metadata: {
      analysisId,
      photoId: params.photoId,
      overallHealth: params.analysis.diagnosis.overallHealth,
    },
  });

  return {
    analysisId,
    photoId: params.photoId,
    userId: params.userId,
    diagnosis: params.analysis.diagnosis,
    recommendations: params.analysis.recommendations,
    spokenSummary: params.analysis.spokenSummary,
    rawResponse: params.rawResponse,
    createdAt: new Date(ts * 1000),
  };
}

export function getAnalysisById(
  db: Database,
  analysisId: string,
  userId: string,
): AnalysisRecord | null {
  const row = db
    .prepare('SELECT * FROM analyses WHERE id = ? AND user_id = ?')
    .get(analysisId, userId) as AnalysisRow | undefined;
  return row !== undefined ? rowToAnalysis(row) : null;
}

export function getAnalysesByPhoto(
  db: Database,
  photoId: string,
  userId: string,
): AnalysisRecord[] {
  const rows = db
    .prepare(
      'SELECT * FROM analyses WHERE photo_id = ? AND user_id = ? ORDER BY created_at DESC',
    )
    .all(photoId, userId) as AnalysisRow[];
  return rows.map(rowToAnalysis);
}

export function getAnalysesByUser(db: Database, userId: string): AnalysisRecord[] {
  const rows = db
    .prepare('SELECT * FROM analyses WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as AnalysisRow[];
  return rows.map(rowToAnalysis);
}

export function deleteAnalysis(db: Database, analysisId: string, userId: string): boolean {
  const row = db
    .prepare('SELECT id FROM analyses WHERE id = ? AND user_id = ?')
    .get(analysisId, userId) as { id: string } | undefined;

  if (!row) {
    auditLog({
      action: 'analysis.delete',
      userId,
      result: 'denied',
      metadata: { analysisId, reason: 'not_found_or_wrong_user' },
    });
    return false;
  }

  db.prepare('DELETE FROM analyses WHERE id = ? AND user_id = ?').run(analysisId, userId);

  auditLog({ action: 'analysis.delete', userId, result: 'success', metadata: { analysisId } });
  return true;
}
