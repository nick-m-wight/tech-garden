// Claude Vision plant analysis.
//
// OWASP A08 — all Claude API responses validated through zod before being used.
// OWASP A09 — audit log every call with prompt hash + response hash; never full
//             prompt/response content in prod (gated by verboseClaudeLogging flag).
// OWASP A03 — image media type detected from magic bytes, not from caller assertion.

import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { loadEnv } from '../../../../base/backend/src/config/env';
import { auditLog, getLogger } from '../../../../base/backend/src/audit/logger';
import { features } from '../../../../base/backend/src/config/features';
import { GARDEN_EXPERT_SYSTEM_PROMPT, buildSensorContext } from './gardenExpert';
import type { SensorReadings } from './gardenExpert';

// ---- Response schema (OWASP A08) ----

export const PlantAnalysisResponseSchema = z.object({
  title: z.string().min(1).max(80),
  species: z.string().min(1).max(120),
  spokenSummary: z.string().min(1).max(500),
  diagnosis: z.object({
    overallHealth: z.enum(['excellent', 'good', 'fair', 'poor', 'critical']),
    issues: z.array(
      z.object({
        type: z.string().min(1),
        severity: z.enum(['low', 'medium', 'high']),
        description: z.string().min(1),
      }),
    ),
  }),
  recommendations: z.array(
    z.object({
      action: z.string().min(1),
      priority: z.enum(['immediate', 'soon', 'routine']),
      detail: z.string().min(1),
    }),
  ),
  annotationPoints: z.array(
    z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      label: z.string().min(1),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex color'),
    }),
  ),
  trimming: z.object({
    needed: z.boolean(),
    areas: z.array(z.object({ description: z.string().min(1) })),
  }),
  wateringNeeds: z.object({
    status: z.enum(['overwatered', 'optimal', 'underwatered', 'unknown']),
    recommendation: z.string().min(1),
  }),
  sensorContext: z.string().optional(),
});

export type PlantAnalysisResponse = z.infer<typeof PlantAnalysisResponseSchema>;

// ---- Helpers ----

// OWASP A03 — detect format from actual bytes, not from a caller-supplied label.
export function detectMediaType(base64: string): 'image/jpeg' | 'image/png' {
  const header = Buffer.from(base64.slice(0, 8), 'base64');
  // JPEG: FF D8 FF
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
    return 'image/png';
  }
  throw new Error('Unsupported image format: must be JPEG or PNG');
}

function stripCodeFences(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return match?.[1] ?? text.trim();
}

// OWASP A08 — parse + validate Claude's raw text response.
export function parsePlantAnalysisResponse(rawText: string): PlantAnalysisResponse {
  const jsonStr = stripCodeFences(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Claude response is not valid JSON (first 120 chars): ${jsonStr.slice(0, 120)}`);
  }
  return PlantAnalysisResponseSchema.parse(parsed);
}

function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

// ---- Main entry point ----

export interface AnalysePlantParams {
  imageBase64: string;
  userId: string;
  zoneId: string;
  zoneName: string;
  sensors: SensorReadings;
}

export async function analysePlant(
  params: AnalysePlantParams,
): Promise<PlantAnalysisResponse> {
  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY must be set to use plant analysis');
  }

  const mediaType = detectMediaType(params.imageBase64); // OWASP A03
  const sensorContext = buildSensorContext(params.zoneName, params.sensors);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let rawResponse: string;
  try {
    // beta.promptCaching caches the static system prompt across calls,
    // avoiding re-billing the same tokens on every photo analysis.
    const message = await client.beta.promptCaching.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: GARDEN_EXPERT_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: params.imageBase64,
              },
            },
            { type: 'text', text: sensorContext },
          ],
        },
      ],
    });

    const rawBlock = message.content.find((b) => b.type === 'text');
    if (!rawBlock || rawBlock.type !== 'text') {
      throw new Error('Claude response contained no text block');
    }
    rawResponse = rawBlock.text;
  } catch (err) {
    auditLog({
      action: 'claude.plant_analysis',
      userId: params.userId,
      result: 'failure',
      metadata: {
        zoneId: params.zoneId,
        reason: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }

  // OWASP A08 — validate before acting on the response
  const analysis = parsePlantAnalysisResponse(rawResponse);

  // OWASP A09 — hashes always logged; full content only in dev
  const promptHash = sha256hex(GARDEN_EXPERT_SYSTEM_PROMPT + sensorContext);
  const responseHash = sha256hex(rawResponse);

  if (features.verboseClaudeLogging) {
    getLogger().info({
      msg: 'claude.plant_analysis.verbose',
      userId: params.userId,
      zoneId: params.zoneId,
      sensorContext,
      rawResponse,
    });
  }

  auditLog({
    action: 'claude.plant_analysis',
    userId: params.userId,
    result: 'success',
    metadata: {
      zoneId: params.zoneId,
      promptHash,
      responseHash,
      overallHealth: analysis.diagnosis.overallHealth,
      issueCount: analysis.diagnosis.issues.length,
    },
  });

  return analysis;
}
