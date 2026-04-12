const Anthropic = require('@anthropic-ai/sdk');
const { search: webSearch } = require('./webSearch');
const { fetchPage } = require('./scraper');
const { getSearchAgentSystemPrompt } = require('../utils/prompts');

const MAX_TOOL_CALLS = 20;

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
];

async function executeTool(toolName, toolInput) {
  switch (toolName) {
    case 'web_search': {
      const results = await webSearch(toolInput.query);
      return JSON.stringify(results, null, 2);
    }
    case 'fetch_webpage': {
      const result = await fetchPage(toolInput.url);
      if (result.error) {
        return `Error fetching ${result.url}: ${result.error}`;
      }
      return result.content;
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}

async function searchForSessions(location, lat, lng, dateRange, onProgress) {
  const client = new Anthropic();

  const userMessage = `Find all beach volleyball open play / pickup / drop-in sessions near ${location} (coordinates: ${lat}, ${lng}).

Date range to search: ${dateRange.start} to ${dateRange.end}

Be exhaustive in your search. Search venue websites, booking platforms (meetup.com, sportplaner.de, playtomic.io, etc.), and local event listings. Remember to search in the local language of this city as well as English. Fetch venue websites and calendar pages to get specific schedules and booking links.

Today's date is ${new Date().toISOString().split('T')[0]}.`;

  const messages = [{ role: 'user', content: userMessage }];
  let toolCallCount = 0;

  if (onProgress) onProgress({ stage: 'starting', message: 'Starting search agent...' });

  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: getSearchAgentSystemPrompt(),
      tools,
      messages,
    });

    // Check if we're done (no more tool use)
    if (response.stop_reason === 'end_turn') {
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
  messages.push({
    role: 'user',
    content: [{ type: 'text', text: 'You have reached the maximum number of tool calls. Please provide your final JSON response now with all the sessions you have found so far.' }],
  });

  const finalResponse = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: getSearchAgentSystemPrompt(),
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
      return parsed.map(normalizeResult);
    }
    return [];
  } catch (e) {
    console.error('Failed to parse agent response:', e.message);
    console.error('Raw response:', text.substring(0, 500));
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
