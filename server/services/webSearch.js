const fetch = require('node-fetch');

async function search(query, locale = null) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error('SERPAPI_API_KEY not configured');

  const params = new URLSearchParams({
    api_key: apiKey,
    engine: 'google',
    q: query,
  });

  if (locale) {
    if (locale.gl) params.set('gl', locale.gl);
    if (locale.hl) params.set('hl', locale.hl);
  }

  const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
    timeout: 15000,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SerpApi error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const results = [];

  if (data.organic_results) {
    for (const item of data.organic_results) {
      results.push({
        title: item.title || '',
        link: item.link || '',
        snippet: item.snippet || '',
      });
    }
  }

  return results;
}

module.exports = { search };
