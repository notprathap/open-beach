// HTTP client for backend API
const API = {
  async searchEvents(location, lat, lng, dateRange, type = 'openplay', onProgress = null) {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, lat, lng, dateRange, type }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Search failed (${res.status})`);
    }

    const contentType = res.headers.get('content-type') || '';

    // Cached responses come as plain JSON
    if (contentType.includes('application/json')) {
      return res.json();
    }

    // Streaming NDJSON response — read line by line
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete last line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'progress' && onProgress) {
            onProgress(event);
          } else if (event.type === 'result') {
            finalResult = event;
          } else if (event.type === 'error') {
            throw new Error(event.error);
          }
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        if (event.type === 'result') finalResult = event;
        if (event.type === 'error') throw new Error(event.error);
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }

    if (!finalResult) {
      throw new Error('Search completed but no results received');
    }

    return finalResult;
  },

  async geocode(query) {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Location not found');
    }

    return res.json();
  },

  async reverseGeocode(lat, lng) {
    const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Reverse geocode failed');
    }

    return res.json();
  },
};
