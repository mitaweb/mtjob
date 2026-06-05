export interface Coords {
  lat: number;
  lng: number;
  accuracy: number;
}

export function getPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Thiết bị không hỗ trợ định vị GPS.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(new Error(err.message || 'Không lấy được vị trí.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}
