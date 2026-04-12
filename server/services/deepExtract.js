const fetch = require('node-fetch');
const fs = require('fs');

const MAX_PAGES = 5;
const TIMEOUT_MS = 30000;

let chromium;
try {
  chromium = require('playwright').chromium;
} catch {
  chromium = null;
}

// Launch a stealth browser page
async function launchPage() {
  if (!chromium) throw new Error('Playwright not installed');
  const browser = await chromium.launch({
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
    locale: 'de-DE',
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return { browser, page };
}

// Take a screenshot and return as base64
async function screenshotPage(page) {
  const buffer = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 70 });
  return buffer.toString('base64');
}

// Ask Gemini Flash Lite to analyze a screenshot
async function askGemini(imageBase64, prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ],
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
      timeout: 15000,
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

const EXTRACT_PROMPT = `Look at this webpage screenshot. Find any beach volleyball open play / pickup / drop-in session schedules.

Respond with JSON in one of these formats:

If you can see schedule data (dates, times, session names):
{"action": "extract", "data": [{"date": "2026-04-15", "startTime": "18:00", "endTime": "20:00", "title": "Open Play", "price": "€10"}]}
If you see a recurring pattern (e.g., "every Friday"), list a maximum of 4 upcoming dates. Keep data concise.

If the schedule is not visible but you can see a link/button that would lead to it (e.g., "Book now", "Schedule", "Open Play", "Buchen"):
{"action": "click", "selector": "text=Book Now", "reason": "clicking booking button to find schedule"}
Use a Playwright-compatible selector (text=..., or a CSS selector).

If there is no schedule info and no useful links:
{"action": "not_found", "reason": "brief explanation"}`;

async function deepExtract(url, goal, locale) {
  if (!chromium) {
    return { scheduleData: [], pagesVisited: [url], error: 'Playwright not available (required for deep extraction)' };
  }

  const startTime = Date.now();
  const pagesVisited = [];
  let browser;

  try {
    const launched = await launchPage();
    browser = launched.browser;
    const page = launched.page;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Dismiss cookie dialogs
    try { await page.click('text=OK', { timeout: 2000 }); } catch {}
    try { await page.click('text=Accept', { timeout: 1000 }); } catch {}

    await page.waitForTimeout(3000);
    pagesVisited.push(url);

    for (let i = 0; i < MAX_PAGES; i++) {
      if (Date.now() - startTime > TIMEOUT_MS) break;

      const screenshot = await screenshotPage(page);
      const prompt = i === 0
        ? `${EXTRACT_PROMPT}\n\nGoal: ${goal}\nCurrent URL: ${page.url()}`
        : `${EXTRACT_PROMPT}\n\nGoal: ${goal}\nI navigated to: ${page.url()}`;

      const decision = await askGemini(screenshot, prompt);

      if (decision.action === 'extract') {
        return { scheduleData: decision.data || [], pagesVisited, error: null };
      }

      if (decision.action === 'click' && decision.selector) {
        try {
          await page.click(decision.selector, { timeout: 5000 });
          await page.waitForTimeout(3000);
          pagesVisited.push(page.url());
        } catch (e) {
          return { scheduleData: [], pagesVisited, error: `Could not click "${decision.selector}": ${e.message}` };
        }
        continue;
      }

      // not_found
      break;
    }

    return {
      scheduleData: [],
      pagesVisited,
      error: 'No schedule data found after navigating the site',
    };
  } catch (err) {
    return { scheduleData: [], pagesVisited, error: err.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { deepExtract };
