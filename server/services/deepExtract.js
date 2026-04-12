const fetch = require('node-fetch');

const MAX_PAGES = 5;
const TIMEOUT_MS = 25000;
const MAX_CONTENT_LENGTH = 10000;

// Fetch a page via Jina Reader (free JS rendering)
async function jinaFetch(url) {
  const headers = {
    'Accept': 'text/markdown',
    'X-No-Cache': 'true',
  };
  const jinaKey = process.env.JINA_API_KEY;
  if (jinaKey) {
    headers['Authorization'] = `Bearer ${jinaKey}`;
  }

  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers,
    timeout: 12000,
  });

  if (!res.ok) {
    throw new Error(`Jina error ${res.status}`);
  }

  const text = await res.text();
  const titleMatch = text.match(/^Title:\s*(.+)/m);
  const contentMatch = text.match(/Markdown Content:\s*\n([\s\S]*)/);

  let content = contentMatch ? contentMatch[1].trim() : '';
  if (!content) {
    throw new Error('Jina returned no content for this page');
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.substring(0, MAX_CONTENT_LENGTH) + '... [truncated]';
  }

  return {
    title: titleMatch ? titleMatch[1].trim() : '',
    content,
  };
}

// Ask Gemini Flash Lite to analyze a page and decide next action
async function askGemini(messages) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      }),
      timeout: 10000,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error ${res.status}: ${text.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');

  return JSON.parse(text);
}

const SYSTEM_INSTRUCTION = `You are a website navigator extracting sports session schedules.
You will be shown a web page's content in Markdown format. Your job is to find volleyball open play / pickup / drop-in session schedules.

Respond with JSON in one of these formats:

If you can see schedule data on this page:
{"action": "extract", "data": [{"date": "2026-04-15", "startTime": "18:00", "endTime": "20:00", "title": "Open Play", "price": "€10"}]}
Use actual dates if visible. If only a recurring pattern is shown (e.g., "every Tuesday"), set date to "recurring" and add a "pattern" field.

If you need to follow a link to find schedules (e.g., a "Book now", "Schedule", "Open play", or "Sessions" link):
{"action": "follow", "url": "https://full-url-to-follow"}
Pick the most promising link. Only follow links that likely lead to session schedules.

If there is no schedule info and no useful links to follow:
{"action": "not_found", "reason": "brief explanation"}`;

async function deepExtract(url, goal, locale) {
  const startTime = Date.now();
  const pagesVisited = [];

  try {
    let currentUrl = url;
    const geminiMessages = [];

    for (let i = 0; i < MAX_PAGES; i++) {
      // Check timeout
      if (Date.now() - startTime > TIMEOUT_MS) {
        break;
      }

      // Fetch page
      const page = await jinaFetch(currentUrl);
      pagesVisited.push(currentUrl);

      // Build message for Gemini
      const userMessage = i === 0
        ? `Goal: ${goal}\nStarting URL: ${currentUrl}\nPage title: ${page.title}\n\nPage content:\n${page.content}`
        : `I followed the link to: ${currentUrl}\nPage title: ${page.title}\n\nPage content:\n${page.content}`;

      geminiMessages.push({ role: 'user', parts: [{ text: userMessage }] });

      // Ask Gemini what to do
      const decision = await askGemini([
        { role: 'user', parts: [{ text: SYSTEM_INSTRUCTION }] },
        { role: 'model', parts: [{ text: 'Understood. Show me the page content and I will analyze it.' }] },
        ...geminiMessages,
      ]);

      if (decision.action === 'extract') {
        return {
          scheduleData: decision.data || [],
          pagesVisited,
          error: null,
        };
      }

      if (decision.action === 'follow' && decision.url) {
        // Prevent visiting the same page twice
        if (pagesVisited.includes(decision.url)) {
          break;
        }
        currentUrl = decision.url;
        geminiMessages.push({
          role: 'model',
          parts: [{ text: JSON.stringify(decision) }],
        });
        continue;
      }

      // not_found or unknown action
      break;
    }

    return {
      scheduleData: [],
      pagesVisited,
      error: pagesVisited.length >= MAX_PAGES ? 'Max pages reached without finding schedule' : 'No schedule data found',
    };
  } catch (err) {
    return {
      scheduleData: [],
      pagesVisited,
      error: err.message,
    };
  }
}

module.exports = { deepExtract };
