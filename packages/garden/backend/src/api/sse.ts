// Server-Sent Events registry — one persistent stream per authenticated user.
// The phone connects once; the backend pushes analysis_ready events so the
// plant history page updates without any polling.
//
// OWASP A01 — streams are keyed by internal userId; connection requires valid JWT.

import type { Response } from 'express';

const clients = new Map<string, Set<Response>>();

export function registerSseClient(userId: string, res: Response): () => void {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(res);
  return () => {
    clients.get(userId)?.delete(res);
  };
}

export function notifyAnalysisReady(userId: string, analysisId: string): void {
  const userClients = clients.get(userId);
  if (!userClients?.size) return;
  const payload = `data: ${JSON.stringify({ type: 'analysis_ready', analysisId })}\n\n`;
  for (const res of userClients) {
    try {
      res.write(payload);
    } catch {
      userClients.delete(res);
    }
  }
}
