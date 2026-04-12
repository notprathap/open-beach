const fetch = require('node-fetch');

async function search(query, locale = null) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('SERPER_API_KEY not configured');

  const body = { q: query, num: 20 };
  if (locale) {
    if (locale.gl) body.gl = locale.gl;
    if (locale.hl) body.hl = locale.hl;
  }

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    timeout: 15000,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Serper API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const results = [];

  if (data.organic) {
    for (const item of data.organic) {
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
