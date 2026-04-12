// Date filter module
const Filters = {
  container: null,
  selectedDates: new Set(),
  onChange: null,
  allDates: [],

  init(containerId, onChange) {
    this.container = document.getElementById(containerId);
    this.onChange = onChange;
    this.generateWeekButtons();
  },

  generateWeekButtons() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.allDates = [];

    // Generate 7 days starting from today
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      this.allDates.push(date);
    }

    // Select all dates by default
    this.allDates.forEach(d => this.selectedDates.add(this.toISO(d)));

    this.render();
  },

  render() {
    const todayISO = this.toISO(new Date());
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // "All" button
    const allSelected = this.selectedDates.size === this.allDates.length;
    let html = `<button class="date-btn ${allSelected ? 'active' : ''}" data-action="all">All Week</button>`;

    this.allDates.forEach(date => {
      const iso = this.toISO(date);
      const isActive = this.selectedDates.has(iso);
      const isToday = iso === todayISO;
      const label = isToday ? 'Today' : dayNames[date.getDay()];

      html += `
        <button class="date-btn ${isActive ? 'active' : ''}" data-date="${iso}">
          <span class="day-name">${label}</span>
          <span class="day-num">${date.getDate()}</span>
        </button>
      `;
    });

    this.container.innerHTML = html;

    // Bind clicks
    this.container.querySelectorAll('.date-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const date = btn.dataset.date;

        if (action === 'all') {
          // Toggle all
          if (this.selectedDates.size === this.allDates.length) {
            this.selectedDates.clear();
          } else {
            this.allDates.forEach(d => this.selectedDates.add(this.toISO(d)));
          }
        } else if (date) {
          if (this.selectedDates.has(date)) {
            this.selectedDates.delete(date);
          } else {
            this.selectedDates.add(date);
          }
        }

        this.render();
        if (this.onChange) this.onChange();
      });
    });
  },

  getDateRange() {
    if (this.selectedDates.size === 0) {
      // Default to full week if nothing selected
      return {
        start: this.toISO(this.allDates[0]),
        end: this.toISO(this.allDates[this.allDates.length - 1]),
      };
    }

    const sorted = Array.from(this.selectedDates).sort();
    return {
      start: sorted[0],
      end: sorted[sorted.length - 1],
    };
  },

  getSelectedDates() {
    return new Set(this.selectedDates);
  },

  toISO(date) {
    return date.toISOString().split('T')[0];
  },
};
