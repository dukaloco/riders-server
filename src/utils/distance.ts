
//Helper to convert degrees to radians.
const toRad = (deg: number): number => deg * (Math.PI / 180);


//Haversine formula — great-circle distance between two coordinates in km.

export const haversineDistanceKm = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number => {
    const R = 6371; // Earth radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};


// Estimate travel time in minutes based on average speed.
//Default speed: 30 km/h (city average).

export const estimateTravelMinutes = (
    distanceKm: number,
    avgSpeedKmh = 30
): number => Math.ceil((distanceKm / avgSpeedKmh) * 60);
