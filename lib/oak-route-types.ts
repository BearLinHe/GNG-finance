import type { DriverDay, DriverTask } from "./oak-driver-types";

export type DriverLocation = {
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  precision: "postal" | "facility" | "address" | "unresolved";
  note: string;
};
export type DriverLocations = Record<string, DriverLocation>;
export const locationKey = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
export const locationCity = (location: DriverLocation) => [location.city, location.state].filter(Boolean).join(", ") + (location.zip ? ` ${location.zip}` : "");
export const locationPosition = (location?: DriverLocation | null) => location && location.latitude != null && location.longitude != null
  && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
  && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180
  ? { lat: location.latitude, lng: location.longitude } : null;
const routeColors = ["#2563eb", "#c2410c", "#0f766e", "#7e22ce", "#be123c", "#0369a1", "#4d7c0f"];
export const routeDateColor = (date: string) => routeColors[new Date(`${date}T00:00:00Z`).getUTCDay()] || routeColors[0];

export type DriverRoute = {
  id: string;
  number: number;
  date: string;
  task: DriverTask;
  from: DriverLocation | null;
  to: DriverLocation | null;
};

export function buildDriverRoutes(days: DriverDay[], locations: DriverLocations): DriverRoute[] {
  return days.flatMap(day => day.tasks.map((task, index) => ({
    id: `${day.workDate}-${index}`, number: index + 1, date: day.workDate, task,
    from: task.fromLocation ? locations[locationKey(task.fromLocation)] || null : null,
    to: task.toLocation ? locations[locationKey(task.toLocation)] || null : null
  })));
}

export type DriverRouteStyle = { color: string; reverseOf: number | null };

export function buildDriverRouteStyles(routes: DriverRoute[]): Record<string, DriverRouteStyle> {
  const seen = new Map<string, number>();
  return Object.fromEntries(routes.map(route => {
    const from = locationPosition(route.from); const to = locationPosition(route.to);
    let reverseOf: number | null = null;
    if (from && to && (from.lat !== to.lat || from.lng !== to.lng)) {
      const forward = JSON.stringify([route.date, from.lat, from.lng, to.lat, to.lng]);
      const reverse = JSON.stringify([route.date, to.lat, to.lng, from.lat, from.lng]);
      reverseOf = seen.get(reverse) ?? null;
      if (!seen.has(forward)) seen.set(forward, route.number);
    }
    return [route.id, { color: routeColors[(route.number - 1) % routeColors.length], reverseOf }];
  }));
}
