const fetch = require('node-fetch');

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'OpenBeach/1.0 (beach volleyball finder)';

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { q, lat, lng } = req.query;

    if (lat && lng) {
      const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
      const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 10000 });
      if (!r.ok) return res.status(502).json({ error: 'Reverse geocode failed' });
      const data = await r.json();
      return res.json({
        lat: parseFloat(data.lat),
        lng: parseFloat(data.lon),
        displayName: data.display_name,
        city: data.address?.city || data.address?.town || data.address?.village || '',
        country: data.address?.country || '',
      });
    }

    if (!q) return res.status(400).json({ error: 'Query parameter "q" or "lat"+"lng" required' });

    const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 10000 });
    if (!r.ok) return res.status(502).json({ error: 'Geocode failed' });
    const data = await r.json();
    if (!data.length) return res.status(404).json({ error: 'Location not found' });

    res.json({
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    });
  } catch (err) {
    res.status(500).json({ error: 'Geocoding failed: ' + err.message });
  }
};
