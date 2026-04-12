const Anthropic = require('@anthropic-ai/sdk');
const { search: webSearch } = require('./webSearch');
const { fetchPage } = require('./scraper');
const { deepExtract } = require('./deepExtract');
const { getPromptForType } = require('../utils/prompts');
const { localeFromCoords, getLocalQueries } = require('../utils/locale');

const MAX_TOOL_CALLS = 35;

const tools = [
  {
    name: 'web_search',
    description: 'Search the web using Google. Use this to find beach volleyball venues, open play sessions, events, and booking platforms. Use varied and specific queries for best results.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to execute',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_webpage',
    description: 'Fetch and read the text content of a webpage. Use this to read venue websites, event calendars, booking pages, and schedule pages. The content may be in any language - you can read and understand it regardless.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL of the webpage to fetch',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'deep_extract',
    description: 'Deep-extract schedule data from a JavaScript-heavy venue website that requires multi-step navigation (e.g., SPA booking systems, sites with "Book Now" flows). This tool automatically navigates through the site following booking/schedule links and extracts structured session data. Use this INSTEAD of fetch_webpage when: (1) fetch_webpage returned empty or boilerplate content, (2) the site appears to use a modern booking platform, or (3) search snippets suggest schedule data requires clicking through multiple pages.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The venue homepage or starting URL',
        },
        goal: {
          type: 'string',
          description: 'What to find, e.g., "beach volleyball open play session schedule and booking links"',
        },
      },
      required: ['url', 'goal'],
    },
  },
];

function makeExecuteTool(locale) {
  return async function executeTool(toolName, toolInput) {
    switch (toolName) {
      case 'web_search': {
        const results = await webSearch(toolInput.query, locale);
        return JSON.stringify(results, null, 2);
      }
      case 'fetch_webpage': {
        const result = await fetchPage(toolInput.url);
        if (result.error) {
          return `Error fetching ${result.url}: ${result.error}`;
        }
        return result.content;
      }
      case 'deep_extract': {
        const result = await deepExtract(toolInput.url, toolInput.goal, locale);
        if (result.error && result.scheduleData.length === 0) {
          return `Deep extraction from ${toolInput.url} failed: ${result.error}. Pages visited: ${result.pagesVisited.join(', ')}`;
        }
        return JSON.stringify(result.scheduleData, null, 2);
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  };
}

async function searchForSessions(location, lat, lng, dateRange, onProgress, type = 'openplay') {
  const client = new Anthropic();
  const locale = localeFromCoords(lat, lng);
  const executeTool = makeExecuteTool(locale);

  const today = new Date().toISOString().split('T')[0];
  const userMessage = type === 'tournaments'
    ? `Find all beach volleyball tournaments, competitions, and leagues near ${location} (coordinates: ${lat}, ${lng}).

Date range to search: ${dateRange.start} to ${dateRange.end}

Be exhaustive. Search tournament platforms, national/regional federation sites, venue websites, and local event listings. Search in the local language as well as English. Note team formats (2v2, 4v4), skill levels, and registration deadlines.

Today's date is ${today}.`
    : `Find all beach volleyball open play / pickup / drop-in sessions near ${location} (coordinates: ${lat}, ${lng}).

Date range to search: ${dateRange.start} to ${dateRange.end}

Be exhaustive in your search. Search venue websites, booking platforms (meetup.com, sportplaner.de, playtomic.io, etc.), and local event listings. Remember to search in the local language of this city as well as English. Fetch venue websites and calendar pages to get specific schedules and booking links.

Today's date is ${today}.`;

  const messages = [{ role: 'user', content: userMessage }];

  // Two-phase injection: force local-language queries before free-running
  const localQueries = getLocalQueries(type, locale);
  if (localQueries.length > 0) {
    const cityName = location.split(',')[0].trim();
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: 'I\'ll search thoroughly for you. Let me start with local-language searches first.' }],
    });
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: `REQUIRED: Before any other searches, you MUST call web_search for each of these local-language queries:\n${localQueries.map((q, i) => `${i + 1}. "${q} ${cityName}"`).join('\n')}\n\nRun all of these first, then continue with your standard English searches, venue-specific searches, and platform searches.` }],
    });
  }

  let toolCallCount = 0;

  if (onProgress) onProgress({ stage: 'starting', message: 'Starting search agent...' });

  while (toolCallCount < MAX_TOOL_CALLS) {
    if (onProgress) {
      onProgress({
        stage: 'thinking',
        message: toolCallCount === 0
          ? 'Agent is planning search strategy...'
          : `Agent is analyzing results and planning next steps... (${toolCallCount}/${MAX_TOOL_CALLS} actions)`,
        progress: toolCallCount,
        maxProgress: MAX_TOOL_CALLS,
      });
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: getPromptForType(type, locale),
      tools,
      messages,
    });

    // Check if we're done (no more tool use)
    if (response.stop_reason === 'end_turn') {
      if (onProgress) {
        onProgress({ stage: 'parsing', message: 'Compiling results...' });
      }
      // Extract final text response
      const textBlock = response.content.find(b => b.type === 'text');
      if (textBlock) {
        return parseAgentResponse(textBlock.text);
      }
      return [];
    }

    // Process tool calls
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      // No tool calls and not end_turn - extract whatever text we have
      const textBlock = response.content.find(b => b.type === 'text');
      if (textBlock) {
        return parseAgentResponse(textBlock.text);
      }
      return [];
    }

    // Add assistant response to messages
    messages.push({ role: 'assistant', content: response.content });

    // Execute each tool call and collect results
    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      toolCallCount++;
      if (onProgress) {
        onProgress({
          stage: 'searching',
          message: toolUse.name === 'web_search'
            ? `Searching: "${toolUse.input.query}"`
            : toolUse.name === 'deep_extract'
              ? `Deep scanning: ${toolUse.input.url}`
              : `Reading: ${toolUse.input.url}`,
          progress: toolCallCount,
          maxProgress: MAX_TOOL_CALLS,
        });
      }

      let result;
      try {
        result = await executeTool(toolUse.name, toolUse.input);
      } catch (err) {
        result = `Error: ${err.message}`;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // If we hit max tool calls, ask for final answer
  if (onProgress) {
    onProgress({ stage: 'parsing', message: 'Maximum searches reached, compiling results...', progress: MAX_TOOL_CALLS, maxProgress: MAX_TOOL_CALLS });
  }

  messages.push({
    role: 'user',
    content: [{ type: 'text', text: 'You have reached the maximum number of tool calls. Please provide your final JSON response now with all the sessions you have found so far.' }],
  });

  const finalResponse = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: getPromptForType(type, locale),
    messages,
  });

  const textBlock = finalResponse.content.find(b => b.type === 'text');
  if (textBlock) {
    return parseAgentResponse(textBlock.text);
  }

  return [];
}

function parseAgentResponse(text) {
  // Try to extract JSON from the response
  // The agent should return a JSON array, but it might be wrapped in markdown code blocks
  let jsonStr = text;

  // Remove markdown code block if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  // Try to find a JSON array in the text
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    jsonStr = arrayMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      console.log(`Parsed ${parsed.length} venues from agent response`);
      return parsed.map(normalizeResult);
    }
    console.error('Agent response was valid JSON but not an array:', typeof parsed);
    return [];
  } catch (e) {
    console.error('Failed to parse agent response:', e.message);
    console.error('Raw response (first 1000 chars):', text.substring(0, 1000));
    return [];
  }
}

function normalizeResult(item) {
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

module.exports = { searchForSessions };
