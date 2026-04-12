const fetch = require('node-fetch');
const cheerio = require('cheerio');

const MAX_CONTENT_LENGTH = 12000;

// Firecrawl-based fetcher (handles JavaScript rendering)
async function fetchWithFirecrawl(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null; // Fall back to cheerio

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        waitFor: 3000,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Firecrawl error ${res.status}: ${text.substring(0, 200)}`);
      return null; // Fall back to cheerio
    }

    const data = await res.json();

    if (!data.success || !data.data) {
      return null; // Fall back to cheerio
    }

    let content = data.data.markdown || '';
    const title = data.data.metadata?.title || '';
    const description = data.data.metadata?.description || '';

    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.substring(0, MAX_CONTENT_LENGTH) + '... [truncated]';
    }

    const fullContent = `Title: ${title}\nDescription: ${description}\n\n${content}`;
    return { url, content: fullContent, error: null };
  } catch (err) {
    console.error(`Firecrawl fetch failed for ${url}: ${err.message}`);
    return null; // Fall back to cheerio
  } finally {
    clearTimeout(timeout);
  }
}

// Cheerio-based fetcher (fallback for static HTML)
async function fetchWithCheerio(url) {
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

    if (!res.ok) {
      return { url, error: `HTTP ${res.status}`, content: '' };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return { url, error: 'Not HTML content', content: '' };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Remove non-content elements
    $('script, style, noscript, iframe, svg, nav, footer, header').remove();
    $('[role="navigation"], [role="banner"], [aria-hidden="true"]').remove();

    // Extract page title
    const title = $('title').text().trim();

    // Extract meta description
    const metaDesc = $('meta[name="description"]').attr('content') || '';

    // Get main content areas first, fall back to body
    let text = '';
    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.main'];
    for (const sel of mainSelectors) {
      const el = $(sel);
      if (el.length && el.text().trim().length > 200) {
        text = el.text();
        break;
      }
    }
    if (!text) {
      text = $('body').text();
    }

    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();

    // Truncate
    if (text.length > MAX_CONTENT_LENGTH) {
      text = text.substring(0, MAX_CONTENT_LENGTH) + '... [truncated]';
    }

    const fullContent = `Title: ${title}\nDescription: ${metaDesc}\n\n${text}`;

    return { url, content: fullContent, error: null };
  } catch (err) {
    return { url, error: err.message, content: '' };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPage(url) {
  // Try Firecrawl first (handles JavaScript), fall back to cheerio
  const firecrawlResult = await fetchWithFirecrawl(url);
  if (firecrawlResult) return firecrawlResult;
  return fetchWithCheerio(url);
}

module.exports = { fetchPage };
