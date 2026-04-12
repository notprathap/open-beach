const { searchForSessions } = require('../server/services/searchAgent');
const cache = require('../server/services/cache');

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function defaultEndDate(type) {
  const d = new Date();
  if (type === 'tournaments') {
    d.setMonth(d.getMonth() + 3);
  } else {
    d.setDate(d.getDate() + 14);
  }
  return d.toISOString().split('T')[0];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { location, lat, lng, dateRange, type } = req.body;
    if (!location || lat == null || lng == null) {
      return res.status(400).json({ error: 'location, lat, and lng are required' });
    }

    const searchType = type === 'tournaments' ? 'tournaments' : 'openplay';
    const start = dateRange?.start || todayISO();
    const end = dateRange?.end || defaultEndDate(searchType);

    // Check cache
    const cacheKey = cache.key(searchType, location, start, end);
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ results: cached, cached: true });
    }

    const results = await searchForSessions(
      location, parseFloat(lat), parseFloat(lng),
      { start, end },
      null, // no SSE progress on serverless
      searchType
    );

    cache.set(cacheKey, results);
    res.json({ results, cached: false });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed: ' + err.message });
  }
};
