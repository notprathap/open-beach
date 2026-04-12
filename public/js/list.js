// List view renderer
const ListView = {
  container: null,

  init(containerId) {
    this.container = document.getElementById(containerId);
  },

  render(results, onMapClick, options = {}) {
    if (!results || results.length === 0) {
      const isTournament = options.type === 'tournaments';
      const noResults = document.createElement('div');
      noResults.className = 'no-results';

      const icon = document.createElement('div');
      icon.className = 'empty-icon';
      icon.textContent = isTournament ? '🏆' : '🔍';

      const heading = document.createElement('h3');
      heading.textContent = isTournament ? 'No tournaments found' : 'No sessions found';

      const desc = document.createElement('p');
      desc.textContent = isTournament
        ? 'No tournaments found for the selected months. Try expanding your date range or searching a different area.'
        : 'No open play sessions found for the selected dates. Try expanding your date range or searching a different area.';

      noResults.appendChild(icon);
      noResults.appendChild(heading);
      noResults.appendChild(desc);
      this.container.textContent = '';
      this.container.appendChild(noResults);
      return;
    }

    // Flatten events with venue info for sorting by date
    const flatEvents = [];
    results.forEach((venue, venueIndex) => {
      if (venue.events && venue.events.length > 0) {
        venue.events.forEach(event => {
          flatEvents.push({ ...event, venue, venueIndex });
        });
      } else {
        // Venue with no specific dates - show as "schedule" card
        flatEvents.push({
          date: '',
          startTime: '',
          endTime: '',
          title: 'Regular Sessions',
          venue,
          venueIndex,
        });
      }
    });

    // Sort by date, then time
    flatEvents.sort((a, b) => {
      if (a.date && b.date) {
        const dateComp = a.date.localeCompare(b.date);
        if (dateComp !== 0) return dateComp;
        return (a.startTime || '').localeCompare(b.startTime || '');
      }
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });

    // Group by venue to avoid duplicate cards
    const venueMap = new Map();
    results.forEach((venue, venueIndex) => {
      venueMap.set(venueIndex, venue);
    });

    let html = '';

    // Group by date
    const dateGroups = new Map();
    flatEvents.forEach(event => {
      const key = event.date || 'Recurring Schedule';
      if (!dateGroups.has(key)) dateGroups.set(key, []);
      dateGroups.get(key).push(event);
    });

    // Deduplicate within date groups (same venue)
    for (const [dateKey, events] of dateGroups) {
      const dateLabel = dateKey === 'Recurring Schedule'
        ? 'Recurring Schedule'
        : formatDateHeader(dateKey);

      html += `<div class="date-group-header">${escapeHtml(dateLabel)}</div>`;

      // Deduplicate by venue within this date group
      const seen = new Set();
      events.forEach(event => {
        const venueKey = event.venueIndex;
        if (seen.has(venueKey)) return;
        seen.add(venueKey);

        const venue = event.venue;
        const venueEvents = events.filter(e => e.venueIndex === venueKey);

        const eventsHtml = venueEvents.map(e => {
          const time = e.startTime
            ? `${e.startTime}${e.endTime ? ' - ' + e.endTime : ''}`
            : 'See website';
          return `
            <div class="card-event-row">
              <span class="event-time">${escapeHtml(time)}</span>
              <span class="event-title">${escapeHtml(e.title || 'Open Play')}</span>
            </div>
          `;
        }).join('');

        html += `
          <div class="event-card" data-venue-index="${venueKey}">
            <div class="card-header">
              <div class="card-venue">${escapeHtml(venue.venueName)}</div>
              ${venue.priceInfo ? `<span class="card-price">${escapeHtml(venue.priceInfo)}</span>` : ''}
            </div>
            <div class="card-address">${escapeHtml(venue.address)}</div>
            <div class="card-events">${eventsHtml}</div>
            ${venue.notes ? `<div class="card-notes">${escapeHtml(venue.notes)}</div>` : ''}
            ${venue.description ? `<div class="card-notes">${escapeHtml(venue.description)}</div>` : ''}
            <div class="card-actions">
              ${venue.bookingUrl
                ? `<a href="${escapeHtml(venue.bookingUrl)}" target="_blank" rel="noopener" class="book-btn">Book Now &rarr;</a>`
                : `<span class="book-btn" style="opacity:0.5;cursor:default;">No booking link</span>`
              }
              <button class="map-btn" data-venue-index="${venueKey}">Map</button>
            </div>
          </div>
        `;
      });
    }

    this.container.innerHTML = html;

    // Bind map button clicks
    this.container.querySelectorAll('.map-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.venueIndex);
        if (onMapClick) onMapClick(idx);
      });
    });

    // Bind card clicks to show on map
    this.container.querySelectorAll('.event-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('a') || e.target.closest('button')) return;
        const idx = parseInt(card.dataset.venueIndex);
        if (onMapClick) onMapClick(idx);
      });
    });
  },
};

function formatDateHeader(dateStr) {
  if (!dateStr) return 'Unknown Date';
  try {
    const date = new Date(dateStr + 'T00:00:00');
    const options = { weekday: 'long', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  } catch {
    return dateStr;
  }
}
