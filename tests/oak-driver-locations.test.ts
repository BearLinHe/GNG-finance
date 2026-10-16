import test from "node:test";
import assert from "node:assert/strict";
import { resolveDriverLocation, resolveDriverLocations } from "../lib/oak-driver-locations";
import { buildDriverRoutes, locationKey, locationPosition, routeDateColor } from "../lib/oak-route-types";
import type { DriverDay, DriverTask } from "../lib/oak-driver-types";

test("ZIP codes resolve locally to city, state and approximate area, including ZIP+4", () => {
  const place = resolveDriverLocation("95215");
  assert.equal(place.city, "Stockton"); assert.equal(place.state, "CA");
  assert.equal(place.zip, "95215"); assert.equal(place.precision, "postal");
  assert.deepEqual(locationPosition(place), { lat: 37.9551, lng: -121.2041 });
  const extended = resolveDriverLocation(" 95215-1234 ");
  assert.equal(extended.code, "95215-1234"); assert.equal(extended.city, "Stockton");
  assert.equal(resolveDriverLocation("00501").zip, "00501");
});

test("SFO means user's Hayward origin, never San Francisco airport", () => {
  const place = resolveDriverLocation(" sfo ");
  assert.equal(place.name, "OAK 起始地"); assert.equal(place.city, "Hayward");
  assert.equal(place.zip, "94545"); assert.equal(place.precision, "postal");
});

test("confirmed Oakland terminals have facility references; unknown locations stay unlocated", () => {
  for (const code of ["ETS", "SSA", "Trapac"]) {
    const place = resolveDriverLocation(code);
    assert.equal(place.city, "Oakland"); assert.equal(place.precision, "facility");
    assert.ok(place.latitude! > 37.79 && place.latitude! < 37.82);
    assert.ok(place.longitude! < -122.3 && place.longitude! > -122.34);
  }
  const unknown = resolveDriverLocation("PCC");
  assert.equal(unknown.precision, "unresolved");
  assert.equal(locationPosition(unknown), null);
  assert.equal(resolveDriverLocation("00000").precision, "unresolved");
  assert.equal(resolveDriverLocation("999999").precision, "unresolved");
  assert.equal(locationPosition({ ...unknown, latitude: NaN, longitude: 100 }), null);
});

test("Shipper uses the confirmed West 14th Street address rather than a ZIP-area center", () => {
  const place = resolveDriverLocation(" Shipper ");
  assert.equal(place.code, "SHIPPER"); assert.equal(place.name, "Shipper yard");
  assert.equal(place.city, "Oakland"); assert.equal(place.state, "CA"); assert.equal(place.zip, "94607");
  assert.equal(place.address, "2441 W 14th St, Oakland, CA 94607");
  assert.equal(place.precision, "address");
  assert.deepEqual(locationPosition(place), { lat: 37.814798893343, lng: -122.303933072582 });
  assert.notDeepEqual(locationPosition(place), locationPosition(resolveDriverLocation("94607")));
});

test("Shipper outbound and return routes both connect without changing the original jobs", () => {
  const task: DriverTask = { sheetName: "O Don", section: "container", sourceRow: 23, driverName: "O Don", workDate: "2026-10-09", reference: "TCNU7767324", nature: null, fromLocation: "Shipper", toLocation: "SFO", miles: 21, notes: null, rawCells: {} };
  const day: DriverDay = { driverName: task.driverName, workDate: task.workDate, taskCount: 2, miles: 42, tasks: [task, { ...task, sourceRow: 26, fromLocation: "SFO", toLocation: "Shipper" }] };
  const routes = buildDriverRoutes([day], resolveDriverLocations(["Shipper", "SFO"]));
  assert.equal(routes.length, 2);
  for (const route of routes) { assert.ok(locationPosition(route.from)); assert.ok(locationPosition(route.to)); }
  assert.equal(routes[0].from?.address, "2441 W 14th St, Oakland, CA 94607");
  assert.equal(routes[1].to?.address, "2441 W 14th St, Oakland, CA 94607");
  assert.equal(routes[0].task, task); assert.equal(task.fromLocation, "Shipper");
});

test("STK uses the confirmed Northrop Street address rather than a ZIP-area center", () => {
  const place = resolveDriverLocation(" stk ");
  assert.equal(place.code, "STK"); assert.equal(place.city, "Stockton");
  assert.equal(place.state, "CA"); assert.equal(place.zip, "95206");
  assert.equal(place.address, "1642 Northrop St, Stockton, CA 95206");
  assert.equal(place.precision, "address");
  assert.deepEqual(locationPosition(place), { lat: 37.890044065417, lng: -121.24780995545 });
  assert.notDeepEqual(locationPosition(place), locationPosition(resolveDriverLocation("95206")));
});

test("routes preserve all jobs, dates and direction, including repeated or unlocated segments", () => {
  const task: DriverTask = { sheetName: "张晓澄", section: "container", sourceRow: 3, driverName: "张晓澄", workDate: "2026-10-05", reference: "trailer 605", nature: null, fromLocation: "SFO", toLocation: "95215", miles: 77, notes: null, rawCells: {} };
  const day: DriverDay = { driverName: task.driverName, workDate: task.workDate, taskCount: 5, miles: 385, tasks: [task, { ...task, sourceRow: 4, fromLocation: "95215", toLocation: "SFO" }, { ...task, sourceRow: 5, fromLocation: "STK" }, { ...task, sourceRow: 6 }, { ...task, sourceRow: 7, fromLocation: "PCC" }] };
  const locations = resolveDriverLocations(["SFO", "sfo", "95215", "STK", "PCC"]);
  assert.equal(Object.keys(locations).length, 4);
  const routes = buildDriverRoutes([day], locations);
  assert.equal(routes.length, 5); assert.equal(new Set(routes.map(route => route.id)).size, 5);
  assert.equal(routes[0].from?.city, "Hayward"); assert.equal(routes[0].to?.city, "Stockton");
  assert.equal(routes[1].from?.city, "Stockton"); assert.equal(routes[1].to?.city, "Hayward");
  assert.equal(routes[2].from?.address, "1642 Northrop St, Stockton, CA 95206");
  assert.ok(locationPosition(routes[2].from));
  assert.equal(locationPosition(routes[4].from), null);
  assert.equal(routes[0].task, task); assert.equal(routes[0].date, "2026-10-05");
  assert.equal(buildDriverRoutes([], locations).length, 0);
  assert.equal(locationKey(" sFo "), "SFO");
  assert.equal(routeDateColor(day.workDate), routeDateColor(day.workDate));
  assert.notEqual(routeDateColor("2026-10-05"), routeDateColor("2026-10-06"));
});
