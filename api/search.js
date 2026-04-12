const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

// ---- In-memory cache (persists across warm invocations on Vercel) ----
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCacheKey(location, start, end) {
  return `${location.toLowerCase().trim()}|${start}|${end}`;
}

// ---- Web search via Serper ----
async function webSearch(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('SERPER_API_KEY not configured');

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 10 }),
    timeout: 15000,
  });

  if (!res.ok) throw new Error(`Serper error ${res.status}`);
  const data = await res.json();
  return (data.organic || []).map(item => ({
    title: item.title || '',
    link: item.link || '',
    snippet: item.snippet || '',
  }));
}

// ---- Webpage scraper ----
async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,de;q=0.8,es;q=0.7',
      },
      follow: 3,
    });

    if (!res.ok) return `Error: HTTP ${res.status}`;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return 'Error: Not HTML content';
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, noscript, iframe, svg, nav, footer, header').remove();

    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';

    let text = '';
    for (const sel of ['main', 'article', '[role="main"]', '.content', '#content']) {
      const el = $(sel);
      if (el.length && el.text().trim().length > 200) { text = el.text(); break; }
    }
    if (!text) text = $('body').text();

    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > 12000) text = text.substring(0, 12000) + '... [truncated]';

    return `Title: ${title}\nDescription: ${metaDesc}\n\n${text}`;
  } catch (err) {
    return `Error: ${err.message}`;
  } finally {
    clearTimeout(timeout);
  }
}

// ---- System prompt ----
const SYSTEM_PROMPT = `You are an expert research agent specialized in finding beach volleyball open play sessions and pickup games. Your job is to exhaustively search the web to find ALL available open play / drop-in beach volleyball sessions near a given location for a given date range.

## Your Search Strategy

1. **Initial broad search**: Search for beach volleyball open play, pickup, and drop-in sessions in the target city/area.
2. **Venue-specific searches**: Search for known and discovered beach volleyball venues/courts individually to check their schedules and calendars.
3. **Platform searches**: Search on popular booking and event platforms: meetup.com, sportplaner.de, playtomic.io, courtbooking.com, Facebook events, Eventbrite, and local sports booking platforms.
4. **Multilingual searches**: If the location is in a non-English-speaking area, ALSO search in the local language:
   - German: "Beach Volleyball offenes Spiel", "Beachvolleyball mitspielen", "Beach Volleyball open play"
   - Spanish: "voley playa juego abierto", "voley playa pickup"
   - French: "beach volley jeu libre", "beach volley session ouverte"
   - Portuguese: "vôlei de praia jogo aberto"
   - Italian: "beach volley gioco libero"
   - Dutch: "beachvolleybal open spel"
   Adapt to the local language of the city.
5. **Follow promising links**: Fetch venue/event pages to extract detailed schedule information.

## What to Look For

Open play sessions go by many names: Open play, Pickup play, Drop-in, All you can play, Free play / Freies Spiel, Social volleyball, Recreational play, Mixed levels, Pay-and-play, Walk-in sessions.

## Rules

- Make AT LEAST 5 different web searches with varied queries
- Fetch AT LEAST 3-5 venue/event pages to extract detailed information
- ALWAYS search in the local language in addition to English
- Extract SPECIFIC dates, times, and prices when available
- Include the booking/registration URL
- If a venue has a calendar or schedule page, fetch that specific page

## Output Format

Return ONLY a JSON array:
\`\`\`json
[
  {
    "venueName": "Beach Arena Name",
    "address": "Full street address",
    "lat": 52.5200,
    "lng": 13.4050,
    "events": [
      { "date": "2024-03-15", "startTime": "18:00", "endTime": "20:00", "title": "Open Play Session" }
    ],
    "priceInfo": "€10 per person",
    "bookingUrl": "https://venue-website.com/booking",
    "source": "https://where-you-found-this.com",
    "description": "Brief description",
    "notes": "Any additional relevant info"
  }
]
\`\`\`

If you cannot determine exact coordinates, estimate from the address. If you cannot determine exact event dates, include the venue with its regular schedule pattern in the notes field. Return ONLY the JSON array.`;

// ---- Claude tools ----
const tools = [
  {
    name: 'web_search',
    description: 'Search the web using Google. Use varied, specific queries for best results.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search query' } },
      required: ['query'],
    },
  },
  {
    name: 'fetch_webpage',
    description: 'Fetch and read webpage text content. Works with any language.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The URL to fetch' } },
      required: ['url'],
    },
  },
];

// ---- Agent loop ----
async function runSearchAgent(location, lat, lng, dateRange) {
  const client = new Anthropic();
  const MAX_TOOL_CALLS = 20;

  const userMessage = `Find all beach volleyball open play / pickup / drop-in sessions near ${location} (coordinates: ${lat}, ${lng}).
Date range: ${dateRange.start} to ${dateRange.end}
Today's date is ${new Date().toISOString().split('T')[0]}.
Be exhaustive. Search venue websites, booking platforms, and local event listings. Search in the local language as well as English.`;

  const messages = [{ role: 'user', content: userMessage }];
  let toolCallCount = 0;

  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      return textBlock ? parseResponse(textBlock.text) : [];
    }

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find(b => b.type === 'text');
      return textBlock ? parseResponse(textBlock.text) : [];
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const tu of toolUseBlocks) {
      toolCallCount++;
      let result;
      try {
        result = tu.name === 'web_search'
          ? JSON.stringify(await webSearch(tu.input.query), null, 2)
          : await fetchPage(tu.input.url);
      } catch (err) {
        result = `Error: ${err.message}`;
      }
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Hit max calls - force final answer
  messages.push({
    role: 'user',
    content: [{ type: 'text', text: 'Maximum tool calls reached. Provide your final JSON response now.' }],
  });

  const final = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages,
  });

  const textBlock = final.content.find(b => b.type === 'text');
  return textBlock ? parseResponse(textBlock.text) : [];
}

function parseResponse(text) {
  let jsonStr = text;
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) jsonStr = codeBlock[1];
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (arrayMatch) jsonStr = arrayMatch[0];

  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) return parsed.map(normalize);
    return [];
  } catch {
    console.error('Failed to parse agent response');
    return [];
  }
}

function normalize(item) {
  return {
    venueName: item.venueName || item.venue_name || item.name || 'Unknown Venue',
    address: item.address || '',
    lat: parseFloat(item.lat) || 0,
    lng: parseFloat(item.lng || item.lon) || 0,
    events: (item.events || []).map(e => ({
      date: e.date || '',
      startTime: e.startTime || e.start_time || '',
      endTime: e.endTime || e.end_time || '',
      title: e.title || 'Open Play',
    })),
    priceInfo: item.priceInfo || item.price_info || item.price || 'Check website',
    bookingUrl: item.bookingUrl || item.booking_url || item.url || '',
    source: item.source || '',
    description: item.description || '',
    notes: item.notes || '',
  };
}

// ---- Vercel handler ----
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { location, lat, lng, dateRange } = req.body;
    if (!location || lat == null || lng == null) {
      return res.status(400).json({ error: 'location, lat, and lng are required' });
    }

    const start = dateRange?.start || new Date().toISOString().split('T')[0];
    const end = dateRange?.end || (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0]; })();

    // Check cache
    const cacheKey = getCacheKey(location, start, end);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json({ results: cached.value, cached: true });
    }

    const results = await runSearchAgent(location, lat, lng, { start, end });
    cache.set(cacheKey, { value: results, expiresAt: Date.now() + CACHE_TTL });

    res.json({ results, cached: false });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed: ' + err.message });
  }
};
