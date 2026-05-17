// Empty event handlers for the base glasses session.
//
// CLAUDE.md §6 lists the four flows the AppServer dispatches:
//   transcription → sanitize → intent parser → command router
//   button press  → trigger photo capture
//   photo         → validate → encrypt → store → send to Claude Vision
//   location      → update user context (zone detection)
//
// At this step (CLAUDE.md §16 step 3) every handler is a no-op that audit
// logs the event. Forks (the garden app and other future apps) override
// onSession() in their own AppServer subclass to wire real flow logic.
//
// OWASP A09 — every event is audit-logged. Sensitive fields (raw GPS,
// transcription text) are deliberately omitted from the audit metadata at
// this layer; subclasses may log them with care if needed for debugging.

import type {
  AppSession,
  TranscriptionData,
  ButtonPress,
  PhotoTaken,
  LocationUpdate,
} from '@mentra/sdk';
import { auditLog } from '../audit/logger';
import { sanitizeUserText } from '../security/sanitize';

export interface GlassesEventContext {
  session: AppSession;
  sessionId: string;
  userId: string;
}

export function onTranscriptionEvent(ctx: GlassesEventContext, data: TranscriptionData): void {
  // Interim partial transcriptions arrive frequently — only act on final.
  if (!data.isFinal) return;

  // OWASP A03 — sanitize before any downstream use (intent parser / Claude).
  const text = sanitizeUserText(data.text);

  auditLog({
    action: 'glasses.transcription',
    userId: ctx.userId,
    result: 'success',
    metadata: {
      sessionId: ctx.sessionId,
      length: text.length,
      // Text itself intentionally omitted from base-layer audit — subclasses
      // may include it after additional sanitisation.
    },
  });
}

export function onButtonPressEvent(ctx: GlassesEventContext, data: ButtonPress): void {
  auditLog({
    action: 'glasses.button',
    userId: ctx.userId,
    result: 'success',
    metadata: {
      sessionId: ctx.sessionId,
      buttonId: data.buttonId,
      pressType: data.pressType,
    },
  });
}

export function onPhotoEvent(ctx: GlassesEventContext, data: PhotoTaken): void {
  // PhotoTaken carries the photo bytes inline (photoData: ArrayBuffer).
  // Never log the bytes — only structural metadata.
  auditLog({
    action: 'glasses.photo',
    userId: ctx.userId,
    result: 'success',
    metadata: {
      sessionId: ctx.sessionId,
      mimeType: data.mimeType,
      bytes: data.photoData.byteLength,
    },
  });
}

export function onLocationEvent(ctx: GlassesEventContext, data: LocationUpdate): void {
  // Raw lat/lng is PII — do not put it in the audit log at the base layer.
  // Accuracy alone confirms the stream is alive without leaking position.
  auditLog({
    action: 'glasses.location',
    userId: ctx.userId,
    result: 'success',
    metadata: {
      sessionId: ctx.sessionId,
      accuracy: data.accuracy ?? null,
    },
  });
}
