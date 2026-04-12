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
    activeTab: 'openplay', // 'openplay' | 'tournaments'
    cachedResults: {
      openplay: null,
      tournaments: null,
    },
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
    searchTabs: document.getElementById('search-tabs'),
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

    // Tab switching
    els.searchTabs.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => handleTabSwitch(btn.dataset.tab));
    });
  }

  // ---- Tabs ----
  function handleTabSwitch(tab) {
    if (tab === state.activeTab) return;

    if (state.isSearching) {
      showError('Please wait for the current search to complete.');
      return;
    }

    state.activeTab = tab;

    // Update tab button active states
    els.searchTabs.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Switch filter mode
    if (tab === 'tournaments') {
      Filters.setMode('months');
    } else {
      Filters.setMode('days');
    }

    // Check if we have cached results for this tab + location
    const cached = state.cachedResults[tab];
    if (cached && cached.location === state.location) {
      state.results = cached.results;
      const filtered = filterResultsByDate(state.results);
      renderResults(filtered);
    } else {
      state.results = [];
      renderResults([]);
      if (state.lat && state.lng) {
        triggerSearch();
      }
    }
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

      state.cachedResults = { openplay: null, tournaments: null };
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

      state.cachedResults = { openplay: null, tournaments: null };
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
    const isTournament = state.activeTab === 'tournaments';

    showLoading(isTournament ? 'Searching for tournaments...' : 'Searching for open play sessions...');
    updateLoadingDetail(
      isTournament
        ? 'Our AI agent is searching tournament platforms, federation sites, and event listings...'
        : 'Our AI agent is searching venue websites, booking platforms, and event listings...'
    );

    try {
      const data = await API.searchEvents(state.location, state.lat, state.lng, dateRange, state.activeTab, (progress) => {
        if (progress.message) {
          updateLoadingDetail(progress.message);
        }
        if (progress.progress && progress.maxProgress) {
          updateLoadingProgress(progress.progress, progress.maxProgress);
        }
      });
      state.results = data.results || [];

      // Cache results for this tab
      state.cachedResults[state.activeTab] = {
        location: state.location,
        results: state.results,
      };

      const filtered = filterResultsByDate(state.results);
      renderResults(filtered);

      hideLoading();

      if (filtered.length === 0) {
        showError(
          isTournament
            ? 'No tournaments found. Try a different location or expand your date range.'
            : 'No open play sessions found. Try a different location or expand your dates.'
        );
      }
    } catch (err) {
      hideLoading();
      showError(err.message || 'Search failed. Please try again.');
    } finally {
      state.isSearching = false;
    }
  }

  function filterResultsByDate(results) {
    const selected = Filters.getSelectedDates();
    if (selected.size === 0) return results;

    const isMonthMode = state.activeTab === 'tournaments';

    return results.map(venue => {
      const filtered = { ...venue };
      if (venue.events && venue.events.length > 0) {
        filtered.events = venue.events.filter(e => {
          if (!e.date) return true; // Keep events without specific dates
          if (isMonthMode) {
            const monthKey = e.date.substring(0, 7); // "2026-04-15" -> "2026-04"
            return selected.has(monthKey);
          }
          return selected.has(e.date);
        });
      }
      return filtered;
    }).filter(venue => {
      return !venue.events || venue.events.length === 0 || venue.events.some(() => true);
    });
  }

  function renderResults(filtered) {
    MapView.setResults(filtered, (idx) => {
      MapView.highlightVenue(idx, filtered);
      switchView('map');
    });
    ListView.render(filtered, (idx) => {
      switchView('map');
      MapView.highlightVenue(idx, filtered);
    }, { type: state.activeTab });
  }

  function onDateFilterChange() {
    if (state.results.length > 0) {
      const filtered = filterResultsByDate(state.results);
      renderResults(filtered);
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
    const bar = document.getElementById('loading-progress');
    if (bar) bar.style.width = '0%';
    els.loadingOverlay.classList.remove('hidden');
  }

  function updateLoadingDetail(text) {
    els.loadingDetail.textContent = text;
  }

  function updateLoadingProgress(current, max) {
    let bar = document.getElementById('loading-progress');
    if (!bar) return;
    const pct = Math.round((current / max) * 100);
    bar.style.width = pct + '%';
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
