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

    // Check cache — return as plain JSON (no streaming needed)
    const cacheKey = cache.key(searchType, location, start, end);
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ results: cached, cached: true });
    }

    // Stream progress as NDJSON
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const onProgress = (progress) => {
      res.write(JSON.stringify({ type: 'progress', ...progress }) + '\n');
    };

    const results = await searchForSessions(
      location, parseFloat(lat), parseFloat(lng),
      { start, end },
      onProgress,
      searchType
    );

    cache.set(cacheKey, results);
    res.write(JSON.stringify({ type: 'result', results, cached: false }) + '\n');
    res.end();
  } catch (err) {
    console.error('Search error:', err);
    // If headers already sent (streaming), send error as NDJSON line
    if (res.headersSent) {
      res.write(JSON.stringify({ type: 'error', error: 'Search failed: ' + err.message }) + '\n');
      res.end();
    } else {
      res.status(500).json({ error: 'Search failed: ' + err.message });
    }
  }
};
