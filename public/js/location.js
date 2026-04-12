// Location module - GPS + manual entry
const Location = {
  async getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          switch (error.code) {
            case error.PERMISSION_DENIED:
              reject(new Error('Location permission denied. Please enter a location manually.'));
              break;
            case error.POSITION_UNAVAILABLE:
              reject(new Error('Location unavailable. Please enter a location manually.'));
              break;
            case error.TIMEOUT:
              reject(new Error('Location request timed out. Please enter a location manually.'));
              break;
            default:
              reject(new Error('Unable to get location. Please enter a location manually.'));
          }
        },
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 300000,
        }
      );
    });
  },

  saveLocation(location) {
    try {
      localStorage.setItem('openbeach_location', JSON.stringify(location));
    } catch (e) { /* ignore */ }
  },

  loadLocation() {
    try {
      const saved = localStorage.getItem('openbeach_location');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  },
};
