// Date filter module - supports day mode (open play) and month mode (tournaments)
const Filters = {
  container: null,
  selectedDates: new Set(),
  onChange: null,
  allDates: [],
  mode: 'days', // 'days' or 'months'
  months: [],

  init(containerId, onChange) {
    this.container = document.getElementById(containerId);
    this.onChange = onChange;
    this.generateDayButtons(14);
  },

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.selectedDates.clear();
    if (mode === 'months') {
      this.generateMonthButtons();
    } else {
      this.generateDayButtons(14);
    }
  },

  // ---- Day Mode (Open Play) ----

  generateDayButtons(numDays) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.allDates = [];

    for (let i = 0; i < numDays; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      this.allDates.push(date);
    }

    this.allDates.forEach(d => this.selectedDates.add(this.toISO(d)));
    this.renderDays();
  },

  renderDays() {
    const todayISO = this.toISO(new Date());
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Clear container and build buttons via DOM
    this.container.textContent = '';

    // "All Days" button
    const allSelected = this.selectedDates.size === this.allDates.length;
    const allBtn = document.createElement('button');
    allBtn.className = `date-btn ${allSelected ? 'active' : ''}`;
    allBtn.dataset.action = 'all';
    allBtn.textContent = 'All Days';
    this.container.appendChild(allBtn);

    this.allDates.forEach(date => {
      const iso = this.toISO(date);
      const isActive = this.selectedDates.has(iso);
      const isToday = iso === todayISO;
      const label = isToday ? 'Today' : dayNames[date.getDay()];

      const btn = document.createElement('button');
      btn.className = `date-btn ${isActive ? 'active' : ''}`;
      btn.dataset.date = iso;

      const dayName = document.createElement('span');
      dayName.className = 'day-name';
      dayName.textContent = label;

      const dayNum = document.createElement('span');
      dayNum.className = 'day-num';
      dayNum.textContent = date.getDate();

      btn.appendChild(dayName);
      btn.appendChild(dayNum);
      this.container.appendChild(btn);
    });

    this.bindDayClicks();
  },

  bindDayClicks() {
    this.container.querySelectorAll('.date-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const date = btn.dataset.date;

        if (action === 'all') {
          // Select all days
          this.selectedDates.clear();
          this.allDates.forEach(d => this.selectedDates.add(this.toISO(d)));
        } else if (date) {
          // Single-select: show only this day
          this.selectedDates.clear();
          this.selectedDates.add(date);
        }

        this.renderDays();
        if (this.onChange) this.onChange();
      });
    });
  },

  // ---- Month Mode (Tournaments) ----

  generateMonthButtons() {
    const today = new Date();
    this.months = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      this.months.push(d);
    }
    this.months.forEach(m => this.selectedDates.add(this.toMonthKey(m)));
    this.renderMonths();
  },

  renderMonths() {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Clear container and build buttons via DOM
    this.container.textContent = '';

    // "All" button
    const allSelected = this.selectedDates.size === this.months.length;
    const allBtn = document.createElement('button');
    allBtn.className = `date-btn ${allSelected ? 'active' : ''}`;
    allBtn.dataset.action = 'all';
    allBtn.textContent = 'All';
    this.container.appendChild(allBtn);

    this.months.forEach(date => {
      const key = this.toMonthKey(date);
      const isActive = this.selectedDates.has(key);

      const btn = document.createElement('button');
      btn.className = `date-btn ${isActive ? 'active' : ''}`;
      btn.dataset.month = key;

      const monthLabel = document.createElement('span');
      monthLabel.className = 'day-name';
      monthLabel.textContent = monthNames[date.getMonth()];

      const yearLabel = document.createElement('span');
      yearLabel.className = 'day-num';
      yearLabel.textContent = date.getFullYear();

      btn.appendChild(monthLabel);
      btn.appendChild(yearLabel);
      this.container.appendChild(btn);
    });

    this.bindMonthClicks();
  },

  bindMonthClicks() {
    this.container.querySelectorAll('.date-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const month = btn.dataset.month;

        if (action === 'all') {
          // Select all months
          this.selectedDates.clear();
          this.months.forEach(m => this.selectedDates.add(this.toMonthKey(m)));
        } else if (month) {
          // Single-select: show only this month
          this.selectedDates.clear();
          this.selectedDates.add(month);
        }

        this.renderMonths();
        if (this.onChange) this.onChange();
      });
    });
  },

  // ---- Shared ----

  getDateRange() {
    if (this.mode === 'months') {
      const sortedMonths = Array.from(this.selectedDates).sort();
      if (sortedMonths.length === 0) {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 3, 0);
        return { start: this.toISO(start), end: this.toISO(end) };
      }
      const [fy, fm] = sortedMonths[0].split('-').map(Number);
      const [ly, lm] = sortedMonths[sortedMonths.length - 1].split('-').map(Number);
      const start = new Date(fy, fm - 1, 1);
      const end = new Date(ly, lm, 0); // last day of last selected month
      return { start: this.toISO(start), end: this.toISO(end) };
    }

    // Day mode
    if (this.selectedDates.size === 0) {
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
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  toMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  },
};
