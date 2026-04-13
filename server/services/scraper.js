const fetch = require('node-fetch');
const cheerio = require('cheerio');

const MAX_CONTENT_LENGTH = 12000;

// Jina Reader-based fetcher (free JS rendering, 1000 req/day)
async function fetchWithJina(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const headers = {
      'Accept': 'text/markdown',
      'X-No-Cache': 'true',
    };

    // Optional: use API key for higher rate limits if available
    const jinaKey = process.env.JINA_API_KEY;
    if (jinaKey) {
      headers['Authorization'] = `Bearer ${jinaKey}`;
    }

    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      return null; // Fall back to cheerio
    }

    const text = await res.text();

    // Parse Jina's response format: Title, URL Source, then Markdown Content
    const titleMatch = text.match(/^Title:\s*(.+)/m);
    const contentMatch = text.match(/Markdown Content:\s*\n([\s\S]*)/);

    const title = titleMatch ? titleMatch[1].trim() : '';
    let content = contentMatch ? contentMatch[1].trim() : '';

    // If Jina returned no meaningful content, fall back
    if (content.length < 100) {
      return null;
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.substring(0, MAX_CONTENT_LENGTH) + '... [truncated]';
    }

    return { url, content: `Title: ${title}\n\n${content}`, error: null };
  } catch (err) {
    console.error(`Jina fetch failed for ${url}: ${err.message}`);
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

    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';

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

    text = text.replace(/\s+/g, ' ').trim();

    if (text.length > MAX_CONTENT_LENGTH) {
      text = text.substring(0, MAX_CONTENT_LENGTH) + '... [truncated]';
    }

    // Detect booking widget iframes and append their URLs
    const iframeSrcs = [];
    $('iframe').each((_, el) => {
      const src = $(el).attr('src') || '';
      if (src.includes('eversports') || src.includes('playtomic') || src.includes('matchi') || src.includes('mycourt')) {
        iframeSrcs.push(src);
      }
    });
    if (iframeSrcs.length > 0) {
      text += '\n\n[Booking widget iframes detected: ' + iframeSrcs.join(' , ') + ']';
    }

    return { url, content: `Title: ${title}\nDescription: ${metaDesc}\n\n${text}`, error: null };
  } catch (err) {
    return { url, error: err.message, content: '' };
  } finally {
    clearTimeout(timeout);
  }
}

// Quick raw HTML fetch to detect booking widget iframes
async function detectBookingIframes(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
      follow: 3,
      timeout: 8000,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const iframes = [];
    $('iframe').each((_, el) => {
      const src = $(el).attr('src') || '';
      if (src.includes('eversports') || src.includes('playtomic') || src.includes('matchi') || src.includes('mycourt')) {
        iframes.push(src);
      }
    });
    return iframes;
  } catch {
    return [];
  }
}

// Find booking/schedule page links on the same domain
function findBookingLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = [];
  const baseHost = new URL(baseUrl).hostname;
  const bookingTerms = /buch|book|schedule|kalender|calendar|sportangebote|angebote/i;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().toLowerCase();
    try {
      const fullUrl = new URL(href, baseUrl).toString();
      const linkHost = new URL(fullUrl).hostname;
      if (linkHost === baseHost && (bookingTerms.test(href) || bookingTerms.test(text)) && fullUrl !== baseUrl) {
        links.push(fullUrl);
      }
    } catch {}
  });

  // Deduplicate
  return [...new Set(links)];
}

// Fetch raw HTML once and extract iframes + booking links
async function fetchRawHtml(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
      follow: 3,
      timeout: 8000,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractBookingIframes(html) {
  const $ = cheerio.load(html);
  const iframes = [];
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src.includes('eversports') || src.includes('playtomic') || src.includes('matchi') || src.includes('mycourt')) {
      iframes.push(src);
    }
  });
  return iframes;
}

async function fetchPage(url) {
  // Try Jina Reader first (handles JavaScript), fall back to cheerio
  const jinaResult = await fetchWithJina(url);
  const result = jinaResult || await fetchWithCheerio(url);

  if (result && !result.error) {
    // Skip iframe detection for known platforms that won't have booking widgets
    const skipDomains = ['meetup.com', 'eventbrite', 'facebook.com', 'google.com', 'serpapi.com', 'hu-berlin.de'];
    const shouldCheckIframes = !skipDomains.some(d => url.includes(d));

    if (shouldCheckIframes) {
      const html = await fetchRawHtml(url);
      let iframes = html ? extractBookingIframes(html) : [];

      // If no iframes on this page, check linked booking pages on the same domain
      if (iframes.length === 0 && html) {
        const bookingLinks = findBookingLinks(html, url);
        for (const link of bookingLinks.slice(0, 2)) {
          const linkedHtml = await fetchRawHtml(link);
          if (linkedHtml) {
            const found = extractBookingIframes(linkedHtml);
            found.forEach(u => { if (!iframes.includes(u)) iframes.push(u); });
          }
        }
      }

      if (iframes.length > 0) {
        // Deduplicate — prefer URLs with ?list=schedule over bare URLs
        const uniqueIframes = [...new Set(iframes)].filter(u => {
          const bare = u.split('?')[0];
          return u.includes('?') || !iframes.some(other => other !== u && other.startsWith(bare + '?'));
        });
        result.bookingIframes = uniqueIframes;
      }
    }
  }

  return result;
}

module.exports = { fetchPage };
