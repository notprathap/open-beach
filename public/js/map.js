// Leaflet map module
const MapView = {
  map: null,
  markers: null,
  userMarker: null,

  init(containerId) {
    this.map = L.map(containerId, {
      zoomControl: true,
      attributionControl: true,
    }).setView([52.52, 13.405], 12); // Default to Berlin

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(this.map);

    this.markers = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    });
    this.map.addLayer(this.markers);

    // Fix map size issues when shown/hidden
    setTimeout(() => this.map.invalidateSize(), 100);
  },

  centerOn(lat, lng, zoom) {
    this.map.setView([lat, lng], zoom || 12);
    this.setUserMarker(lat, lng);
  },

  setUserMarker(lat, lng) {
    if (this.userMarker) {
      this.map.removeLayer(this.userMarker);
    }

    const icon = L.divIcon({
      className: 'user-location-marker',
      html: '<div style="width:16px;height:16px;background:#4285f4;border:3px solid white;border-radius:50%;box-shadow:0 0 8px rgba(66,133,244,0.5);"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    this.userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 })
      .addTo(this.map)
      .bindPopup('Your location');
  },

  setResults(results, onVenueClick) {
    this.markers.clearLayers();

    if (!results || results.length === 0) return;

    const bounds = [];

    results.forEach((venue, index) => {
      if (!venue.lat || !venue.lng) return;

      const icon = L.divIcon({
        className: 'volleyball-marker',
        html: '🏐',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -20],
      });

      const eventsHtml = (venue.events || []).slice(0, 3).map(e => {
        const time = e.startTime ? `${e.startTime}${e.endTime ? '-' + e.endTime : ''}` : 'See website';
        return `<div class="popup-event">${e.date ? e.date + ' ' : ''}${time} - ${e.title || 'Open Play'}</div>`;
      }).join('');

      const popupHtml = `
        <div class="marker-popup">
          <h3>${escapeHtml(venue.venueName)}</h3>
          <div class="popup-address">${escapeHtml(venue.address)}</div>
          ${eventsHtml ? `<div class="popup-events">${eventsHtml}</div>` : ''}
          ${venue.priceInfo ? `<div class="popup-price">${escapeHtml(venue.priceInfo)}</div>` : ''}
          ${venue.bookingUrl ? `<a href="${escapeHtml(venue.bookingUrl)}" target="_blank" rel="noopener" class="popup-book-btn">Book Now &rarr;</a>` : ''}
        </div>
      `;

      const marker = L.marker([venue.lat, venue.lng], { icon })
        .bindPopup(popupHtml, { maxWidth: 280 });

      marker.on('click', () => {
        if (onVenueClick) onVenueClick(index);
      });

      this.markers.addLayer(marker);
      bounds.push([venue.lat, venue.lng]);
    });

    if (bounds.length > 0) {
      this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  },

  invalidateSize() {
    if (this.map) {
      setTimeout(() => this.map.invalidateSize(), 50);
    }
  },

  highlightVenue(index, results) {
    if (!results[index] || !results[index].lat || !results[index].lng) return;
    this.map.setView([results[index].lat, results[index].lng], 15);
  },
};

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
