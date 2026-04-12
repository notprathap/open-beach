// HTTP client for backend API
const API = {
  async searchEvents(location, lat, lng, dateRange, type = 'openplay') {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, lat, lng, dateRange, type }),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Search failed (${res.status})`);
    }

    return res.json();
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
