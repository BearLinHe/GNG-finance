import { locationCity, locationKey, type DriverLocations } from "@/lib/oak-route-types";

export default function OakLocationLabel({ code, locations }: { code: string | null; locations: DriverLocations }) {
  if (!code) return <span className="oak-location-label"><span>未填写地点</span></span>;
  const location = locations[locationKey(code)];
  const isZip = /^\d{5}(?:-\d{4})?$/.test(code.trim());
  const city = location ? locationCity(location) : "";
  return <span className="oak-location-label" title={location ? `${location.address || city || code} · ${location.note}` : code}>
    <span>{isZip && city ? `${[location.city, location.state].filter(Boolean).join(", ")} ${code.trim()}` : code}</span>
    {!isZip && location && city ? <small>{location.name} · {city}</small> : null}
    {location?.precision === "unresolved" ? <small className="oak-location-pending">{location.note}</small> : null}
  </span>;
}
