// Main app controller
(function () {
  'use strict';

  const state = {
    location: '',
    lat: null,
    lng: null,
    results: [],
    currentView: 'map',
    isSearching: false,
  };

  const els = {
    locationInput: document.getElementById('location-input'),
    gpsBtn: document.getElementById('gps-btn'),
    btnMap: document.getElementById('btn-map'),
    btnList: document.getElementById('btn-list'),
    mapContainer: document.getElementById('map-container'),
    listContainer: document.getElementById('list-container'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),
    loadingDetail: document.getElementById('loading-detail'),
  };

  // ---- Initialize ----
  function init() {
    MapView.init('map');
    ListView.init('event-list');
    Filters.init('date-filter', onDateFilterChange);

    bindEvents();
    restoreLastLocation();

    // On desktop, use split view
    if (window.innerWidth >= 768) {
      setupSplitView();
    }

    window.addEventListener('resize', () => {
      if (window.innerWidth >= 768) {
        setupSplitView();
      } else {
        removeSplitView();
      }
    });
  }

  // ---- Events ----
  function bindEvents() {
    els.locationInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleLocationSearch(els.locationInput.value.trim());
      }
    });

    els.gpsBtn.addEventListener('click', handleGPSClick);
    els.btnMap.addEventListener('click', () => switchView('map'));
    els.btnList.addEventListener('click', () => switchView('list'));
  }

  // ---- Location ----
  async function handleGPSClick() {
    els.gpsBtn.classList.add('loading');
    try {
      const pos = await Location.getCurrentPosition();
      state.lat = pos.lat;
      state.lng = pos.lng;

      MapView.centerOn(pos.lat, pos.lng);

      // Reverse geocode to get location name
      try {
        const geo = await API.reverseGeocode(pos.lat, pos.lng);
        state.location = geo.city || geo.displayName || `${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)}`;
        els.locationInput.value = state.location;
      } catch {
        state.location = `${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)}`;
        els.locationInput.value = state.location;
      }

      Location.saveLocation({ ...state });
      triggerSearch();
    } catch (err) {
      showError(err.message);
    } finally {
      els.gpsBtn.classList.remove('loading');
    }
  }

  async function handleLocationSearch(query) {
    if (!query) return;

    showLoading('Finding location...');
    try {
      const geo = await API.geocode(query);
      state.location = geo.displayName || query;
      state.lat = geo.lat;
      state.lng = geo.lng;
      els.locationInput.value = query;

      MapView.centerOn(geo.lat, geo.lng);
      Location.saveLocation({ ...state });
      triggerSearch();
    } catch (err) {
      hideLoading();
      showError(`Could not find "${query}". Try a different search.`);
    }
  }

  function restoreLastLocation() {
    const saved = Location.loadLocation();
    if (saved && saved.lat && saved.lng) {
      state.location = saved.location;
      state.lat = saved.lat;
      state.lng = saved.lng;
      els.locationInput.value = saved.location || '';
      MapView.centerOn(saved.lat, saved.lng);
    }
  }

  // ---- Search ----
  async function triggerSearch() {
    if (state.isSearching || !state.lat || !state.lng) return;

    state.isSearching = true;
    const dateRange = Filters.getDateRange();

    showLoading('Searching for open play sessions...');
    updateLoadingDetail('Our AI agent is searching venue websites, booking platforms, and event listings...');

    try {
      const data = await API.searchEvents(state.location, state.lat, state.lng, dateRange);
      state.results = data.results || [];

      // Filter results by selected dates
      const filtered = filterResultsByDate(state.results);

      MapView.setResults(filtered, (idx) => {
        MapView.highlightVenue(idx, filtered);
        switchView('map');
      });

      ListView.render(filtered, (idx) => {
        switchView('map');
        MapView.highlightVenue(idx, filtered);
      });

      hideLoading();

      if (filtered.length === 0) {
        showError('No open play sessions found. Try a different location or expand your dates.');
      }
    } catch (err) {
      hideLoading();
      showError(err.message || 'Search failed. Please try again.');
    } finally {
      state.isSearching = false;
    }
  }

  function filterResultsByDate(results) {
    const selectedDates = Filters.getSelectedDates();
    if (selectedDates.size === 0) return results;

    return results.map(venue => {
      const filtered = { ...venue };
      if (venue.events && venue.events.length > 0) {
        filtered.events = venue.events.filter(e => {
          if (!e.date) return true; // Keep events without specific dates
          return selectedDates.has(e.date);
        });
      }
      return filtered;
    }).filter(venue => {
      // Keep venues that have matching events or no specific events
      return !venue.events || venue.events.length === 0 || venue.events.some(e => true);
    });
  }

  function onDateFilterChange() {
    if (state.results.length > 0) {
      const filtered = filterResultsByDate(state.results);
      MapView.setResults(filtered, (idx) => {
        MapView.highlightVenue(idx, filtered);
        switchView('map');
      });
      ListView.render(filtered, (idx) => {
        switchView('map');
        MapView.highlightVenue(idx, filtered);
      });
    } else if (state.lat && state.lng) {
      triggerSearch();
    }
  }

  // ---- View Toggle ----
  function switchView(view) {
    // On desktop, always show both
    if (window.innerWidth >= 768) return;

    state.currentView = view;
    els.mapContainer.classList.toggle('active', view === 'map');
    els.listContainer.classList.toggle('active', view === 'list');
    els.btnMap.classList.toggle('active', view === 'map');
    els.btnList.classList.toggle('active', view === 'list');

    if (view === 'map') {
      MapView.invalidateSize();
    }
  }

  function setupSplitView() {
    // Create split view wrapper if it doesn't exist
    let splitView = document.querySelector('.split-view');
    if (!splitView) {
      splitView = document.createElement('div');
      splitView.className = 'split-view';
      els.mapContainer.parentNode.insertBefore(splitView, els.mapContainer);
      splitView.appendChild(els.mapContainer);
      splitView.appendChild(els.listContainer);
    }
    els.mapContainer.classList.add('active');
    els.listContainer.classList.add('active');
    MapView.invalidateSize();
  }

  function removeSplitView() {
    const splitView = document.querySelector('.split-view');
    if (splitView) {
      splitView.parentNode.insertBefore(els.mapContainer, splitView);
      splitView.parentNode.insertBefore(els.listContainer, splitView.nextSibling);
      splitView.remove();
    }
    // Restore mobile view state
    switchView(state.currentView);
  }

  // ---- UI Helpers ----
  function showLoading(text) {
    els.loadingText.textContent = text || 'Loading...';
    els.loadingOverlay.classList.remove('hidden');
  }

  function updateLoadingDetail(text) {
    els.loadingDetail.textContent = text;
  }

  function hideLoading() {
    els.loadingOverlay.classList.add('hidden');
  }

  function showError(message) {
    // Remove existing toast
    const existing = document.querySelector('.error-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  // ---- Start ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
