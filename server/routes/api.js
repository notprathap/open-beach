const express = require('express');
const router = express.Router();
const { searchForSessions } = require('../services/searchAgent');
const { geocodeForward, geocodeReverse } = require('../utils/geocode');
const cache = require('../services/cache');

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Geocode a location string to coordinates
router.get('/geocode', async (req, res) => {
  try {
    const { q, lat, lng } = req.query;

    if (lat && lng) {
      const result = await geocodeReverse(parseFloat(lat), parseFloat(lng));
      return res.json(result);
    }

    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" or "lat"+"lng" required' });
    }

    const result = await geocodeForward(q);
    if (!result) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json(result);
  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

// Main search endpoint - find open play sessions
router.post('/search', async (req, res) => {
  try {
    const { location, lat, lng, dateRange } = req.body;

    if (!location || lat == null || lng == null) {
      return res.status(400).json({ error: 'location, lat, and lng are required' });
    }

    const start = dateRange?.start || todayISO();
    const end = dateRange?.end || weekFromNowISO();

    // Check cache
    const cacheKey = cache.key(location, start, end);
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ results: cached, cached: true });
    }

    console.log(`Searching for sessions near "${location}" (${lat}, ${lng}) from ${start} to ${end}`);

    const results = await searchForSessions(location, lat, lng, { start, end }, (progress) => {
      console.log(`[Agent] ${progress.message}`);
    });

    // Cache results for 1 hour
    cache.set(cacheKey, results);

    res.json({ results, cached: false });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed. Please try again.' });
  }
});

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function weekFromNowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

module.exports = router;
