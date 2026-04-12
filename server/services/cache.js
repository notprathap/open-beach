class Cache {
  constructor(defaultTTL = 24 * 60 * 60 * 1000) {
    this.store = new Map();
    this.defaultTTL = defaultTTL;
    setInterval(() => this.cleanup(), 10 * 60 * 1000);
  }

  key(type, location, startDate, endDate) {
    return `${type}|${location.toLowerCase().trim()}|${startDate}|${endDate}`;
  }

  get(k) {
    const entry = this.store.get(k);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(k);
      return null;
    }
    return entry.value;
  }

  set(k, value, ttl) {
    this.store.set(k, {
      value,
      expiresAt: Date.now() + (ttl || this.defaultTTL),
    });
  }

  has(k) {
    return this.get(k) !== null;
  }

  cleanup() {
    const now = Date.now();
    for (const [k, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(k);
    }
  }
}

module.exports = new Cache();
