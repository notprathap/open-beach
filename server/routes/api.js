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

// Main search endpoint - find open play sessions or tournaments
router.post('/search', async (req, res) => {
  try {
    const { location, lat, lng, dateRange, type } = req.body;

    if (!location || lat == null || lng == null) {
      return res.status(400).json({ error: 'location, lat, and lng are required' });
    }

    const searchType = type === 'tournaments' ? 'tournaments' : 'openplay';
    const start = dateRange?.start || todayISO();
    const end = dateRange?.end || (searchType === 'tournaments' ? threeMonthsFromNowISO() : twoWeeksFromNowISO());

    // Check cache
    const cacheKey = cache.key(searchType, location, start, end);
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ results: cached, cached: true });
    }

    console.log(`Searching for ${searchType} near "${location}" (${lat}, ${lng}) from ${start} to ${end}`);

    const results = await searchForSessions(location, lat, lng, { start, end }, (progress) => {
      console.log(`[Agent] ${progress.message}`);
    }, searchType);

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

function twoWeeksFromNowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split('T')[0];
}

function threeMonthsFromNowISO() {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().split('T')[0];
}

module.exports = router;
