// Subscribes to the backend SSE stream and invalidates the analyses cache
// the moment a new analysis_ready event arrives — no polling needed.
//
// Uses XMLHttpRequest (not fetch) because XHR's onprogress fires incrementally
// in all React Native versions; ReadableStream support varies across RN builds.

import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '../../../../base/mobile/src/auth/tokenStore';
import { env } from '../../../../base/mobile/src/config/env';

const RECONNECT_DELAY_MS = 3_000;

export function useAnalysisEvents(): void {
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['garden', 'analyses'] });
  }, [queryClient]);

  useEffect(() => {
    let xhr: XMLHttpRequest | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function connect() {
      if (cancelled) return;

      const token = await getAccessToken();
      if (!token || cancelled) return;

      xhr = new XMLHttpRequest();
      let lastIndex = 0;

      xhr.open('GET', `${env.apiBaseUrl}/api/garden/events`, true);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.onprogress = () => {
        if (!xhr) return;
        // Slice only the newly arrived bytes to avoid re-processing old events.
        const chunk = xhr.responseText.slice(lastIndex);
        lastIndex = xhr.responseText.length;
        if (chunk.includes('"analysis_ready"')) {
          invalidate();
        }
      };

      xhr.onloadend = () => {
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      xhr.onerror = () => {
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      xhr.send();
    }

    void connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      xhr?.abort();
    };
  }, [invalidate]);
}
