// Follow-up conversation after photo analysis.
//
// OWASP A08 — response length-capped before being passed to audio.
// OWASP A09 — every Claude call audit-logged with question hash + response hash; never
//             raw question/response content in prod (gated by verboseClaudeLogging).

import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from '../../../../base/backend/src/config/env';
import { auditLog, getLogger } from '../../../../base/backend/src/audit/logger';
import { features } from '../../../../base/backend/src/config/features';

const FOLLOW_UP_SYSTEM = `
You are an expert botanist and horticulturalist AI assistant helping a gardener through smart glasses.
Answer follow-up questions about a recent plant analysis concisely.
Respond in plain spoken English only — no JSON, no markdown, no bullet points.
Keep responses under 40 words, suitable for text-to-speech delivery.
Speak in a calm, knowledgeable, British-accented style.
`.trim();

export interface FollowUpParams {
  question: string;
  previousAnalysis: string;
  zoneName: string;
  userId: string;
}

export async function askFollowUp(params: FollowUpParams): Promise<string> {
  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY must be set');
  }

  const userMessage =
    `The recent analysis of ${params.zoneName} said: "${params.previousAnalysis}"\n\n` +
    `Follow-up question: ${params.question}`;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let rawResponse: string;
  try {
    const message = await client.beta.promptCaching.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 100,
      system: [
        {
          type: 'text',
          text: FOLLOW_UP_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = message.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      throw new Error('Claude response contained no text block');
    }
    rawResponse = block.text.trim();
  } catch (err) {
    auditLog({
      action: 'claude.follow_up',
      userId: params.userId,
      result: 'failure',
      metadata: {
        reason: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }

  // OWASP A08 — cap length before passing to audio
  const spoken = rawResponse.slice(0, 300);

  if (features.verboseClaudeLogging) {
    getLogger().info({
      msg: 'claude.follow_up.verbose',
      userId: params.userId,
      question: params.question,
      rawResponse,
    });
  }

  auditLog({
    action: 'claude.follow_up',
    userId: params.userId,
    result: 'success',
    metadata: {
      questionHash: sha256hex(params.question),
      responseHash: sha256hex(rawResponse),
    },
  });

  return spoken;
}

function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
