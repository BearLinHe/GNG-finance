import { lookup } from "zipcodes";
import { locationKey, type DriverLocation, type DriverLocations } from "./oak-route-types";

const terminals: Record<string, { name: string; address: string; latitude: number; longitude: number }> = {
  // Addresses: Port of Oakland facilities directory. Coordinates: OSM address/facility reference points, not truck gates.
  ETS: { name: "ETS 码头", address: "5190 7th Street, Oakland, CA 94607", latitude: 37.8071728, longitude: -122.3305013 },
  SSA: { name: "SSA 码头", address: "1717 Middle Harbor Road, Oakland, CA 94607", latitude: 37.7968557, longitude: -122.3042596 },
  TRAPAC: { name: "TraPac 码头", address: "2800 7th Street, Oakland, CA 94607", latitude: 37.8089301, longitude: -122.3246724 }
};

export function resolveDriverLocation(value: string): DriverLocation {
  const code = locationKey(value);
  const unresolved: DriverLocation = { code, name: code, city: null, state: null, zip: null, address: null, latitude: null, longitude: null, precision: "unresolved", note: "地点代号待确认" };
  const terminal = terminals[code];
  if (terminal) return { ...unresolved, ...terminal, city: "Oakland", state: "CA", zip: "94607", precision: "facility", note: "码头参考位置，非闸口导航位置" };
  if (code === "STK") return {
    ...unresolved, name: "STK 场地", city: "Stockton", state: "CA", zip: "95206",
    address: "1642 Northrop St, Stockton, CA 95206",
    // User-confirmed address; U.S. Census Geocoder address-range reference point.
    latitude: 37.890044065417, longitude: -121.24780995545, precision: "address",
    note: "按提供地址定位；地址参考点，非闸口实测位置"
  };
  if (code === "SHIPPER") return { ...unresolved, name: "Shipper yard", city: "Oakland", state: "CA", note: "场地具体地址待确认" };
  const zip = code === "SFO" ? "94545" : /^(\d{5})(?:-\d{4})?$/.exec(code)?.[1];
  if (!zip) return unresolved;
  const place = lookup(zip);
  if (!place || place.country !== "US") return { ...unresolved, note: "邮编未匹配到城市" };
  return {
    ...unresolved, name: code === "SFO" ? "OAK 起始地" : place.city, city: place.city, state: place.state, zip,
    latitude: place.latitude, longitude: place.longitude, precision: "postal",
    note: code === "SFO" ? "Hayward 起始地；暂按 94545 邮编区域定位" : "邮编区域参考位置，非仓库准确地址"
  };
}

export function resolveDriverLocations(codes: string[]): DriverLocations {
  return Object.fromEntries([...new Set(codes.map(locationKey))].map(code => [code, resolveDriverLocation(code)]));
}
