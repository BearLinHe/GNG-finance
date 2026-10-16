"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ExternalLink, LocateFixed, MapPin, RefreshCw, TriangleAlert } from "lucide-react";
import { driverTaskLabel, type DriverDay } from "@/lib/oak-driver-types";
import { buildDriverRoutes, locationCity, locationPosition, routeDateColor, type DriverLocations, type DriverRoute } from "@/lib/oak-route-types";
import { loadGoogleMaps, onGoogleMapsAuthorizationFailure } from "@/lib/google-maps-client";
import OakLocationLabel from "./oak-location-label";

function routePath(route: DriverRoute) {
  const from = locationPosition(route.from); const to = locationPosition(route.to);
  return from && to ? [from, to] : null;
}

export default function OakDriverRouteMap({ days, locations, driverName }: { days: DriverDay[]; locations: DriverLocations; driverName: string }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const lines = useRef<Map<string, google.maps.Polyline>>(new Map());
  const routes = useMemo(() => buildDriverRoutes(days, locations), [days, locations]);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const mapped = routes.filter(route => routePath(route));
  const pending = routes.length - mapped.length;

  const fitRoutes = useCallback((items: DriverRoute[]) => {
    if (!map.current) return;
    const points = items.flatMap(route => [locationPosition(route.from), locationPosition(route.to)].filter((point): point is google.maps.LatLngLiteral => point !== null));
    if (!points.length) return;
    const bounds = new google.maps.LatLngBounds(); points.forEach(point => bounds.extend(point));
    map.current.fitBounds(bounds, 60);
    const listener = google.maps.event.addListenerOnce(map.current, "idle", () => {
      if (map.current && (map.current.getZoom() || 0) > 14) map.current.setZoom(14);
    });
    return () => listener.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | undefined;
    setStatus("loading"); setError("");
    const timeout = window.setTimeout(() => { if (!cancelled) { setStatus("error"); setError("地图加载超时，请检查网络后重试"); } }, 20000);
    const unsubscribe = onGoogleMapsAuthorizationFailure(() => {
      if (!cancelled) { setStatus("error"); setError("Google Maps 授权失败，请检查密钥的网站限制、API 启用和结算设置"); }
    });
    void loadGoogleMaps().then(({ Map }) => {
      if (cancelled || !container.current) return;
      map.current = new Map(container.current, {
        center: { lat: 37.6332, lng: -122.0971 }, zoom: 9, mapTypeId: "roadmap", mapTypeControl: false,
        streetViewControl: false, fullscreenControl: false, clickableIcons: false, gestureHandling: "greedy",
        styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }]
      });
      resize = new ResizeObserver(() => { if (map.current) google.maps.event.trigger(map.current, "resize"); });
      resize.observe(container.current);
      setStatus("ready");
    }).catch(err => { if (!cancelled) { setStatus("error"); setError(err instanceof Error ? err.message : "地图加载失败"); } })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true; unsubscribe(); window.clearTimeout(timeout); resize?.disconnect();
      if (map.current) google.maps.event.clearInstanceListeners(map.current);
      map.current = null;
    };
  }, [attempt]);

  useEffect(() => { setSelectedId(""); }, [days]);
  useEffect(() => {
    if (status !== "ready" || !map.current) return;
    const overlays: Array<google.maps.Polyline | google.maps.Circle> = [];
    const listeners: google.maps.MapsEventListener[] = [];
    const points = new Set<string>();
    const info = new google.maps.InfoWindow({ maxWidth: 280 });
    for (const route of routes) {
      const path = routePath(route);
      if (path) {
        const color = routeDateColor(route.date);
        const line = new google.maps.Polyline({
          map: map.current, path, geodesic: false, strokeColor: color, strokeWeight: 4, strokeOpacity: .75,
          icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: color, fillColor: color, fillOpacity: 1 }, offset: "60%" }]
        });
        lines.current.set(route.id, line); overlays.push(line);
        listeners.push(line.addListener("click", () => {
          setSelectedId(route.id);
          document.getElementById(`oak-map-route-${route.id}`)?.scrollIntoView({ block: "nearest" });
        }));
      }
      for (const location of [route.from, route.to]) {
        const position = locationPosition(location);
        if (!location || !position) continue;
        const key = `${position.lat},${position.lng}`;
        if (points.has(key)) continue;
        points.add(key);
        const dot = new google.maps.Circle({ map: map.current, center: position, radius: location.precision === "postal" ? 450 : 90, fillColor: "#17212f", fillOpacity: .7, strokeColor: "#ffffff", strokeWeight: 2, clickable: true });
        overlays.push(dot);
        listeners.push(dot.addListener("click", () => {
          const content = document.createElement("div"); content.className = "oak-map-info";
          const title = document.createElement("strong"); title.textContent = `${location.code} · ${location.name}`;
          const address = document.createElement("p"); address.textContent = location.address || locationCity(location);
          const note = document.createElement("small"); note.textContent = location.note;
          content.append(title, address, note); info.setContent(content); info.setPosition(position); info.open(map.current);
        }));
      }
    }
    const releaseFit = fitRoutes(routes);
    return () => { releaseFit?.(); info.close(); listeners.forEach(listener => listener.remove()); overlays.forEach(overlay => overlay.setMap(null)); lines.current.clear(); };
  }, [status, routes, fitRoutes]);

  useEffect(() => {
    lines.current.forEach((line, id) => line.setOptions({ strokeWeight: id === selectedId ? 7 : 4, strokeOpacity: selectedId ? id === selectedId ? 1 : .2 : .75, zIndex: id === selectedId ? 2 : 1 }));
    const selected = routes.find(route => route.id === selectedId);
    if (selected && locationPosition(selected.from) && locationPosition(selected.to)) return fitRoutes([selected]);
  }, [selectedId, routes, status, fitRoutes]);

  return <div className="oak-route-map" data-map-status={status} data-mapped-routes={mapped.length}>
    <div className="oak-map-summary"><span><MapPin size={14} />已定位 {mapped.length} / {routes.length} 段</span>{pending ? <span className="oak-map-pending"><TriangleAlert size={14} />{pending} 段有地点待定位</span> : null}<button className="icon-button" title="显示全部线路" disabled={status !== "ready"} onClick={() => { setSelectedId(""); fitRoutes(routes); }}><LocateFixed size={16} /></button></div>
    <div className="oak-route-map-layout">
      <div className="oak-map-pane"><div className="oak-map-canvas-wrap"><div ref={container} className="oak-map-canvas" aria-label={`${driverName} 运输线路地图`} />
        {status !== "ready" ? <div className="oak-map-state" role="status"><MapPin size={26} /><strong>{status === "loading" ? "正在加载 Google Maps..." : "地图暂不可用"}</strong>{error ? <p>{error}</p> : null}{status === "error" ? <button className="button ghost" onClick={() => { if (error.includes("授权失败")) window.location.reload(); else setAttempt(value => value + 1); }}><RefreshCw size={14} />{error.includes("授权失败") ? "刷新页面" : "重试"}</button> : null}</div> : !mapped.length ? <div className="oak-map-no-routes">当前作业没有可连线的完整起终点</div> : null}
      </div><div className="oak-map-footnote">起终点示意连线，非实际行驶轨迹。邮编按区域定位；里程沿用原表。<span>地点坐标：邮编资料库 / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a> / <a href="https://geocoding.geo.census.gov/geocoder/" target="_blank" rel="noreferrer">U.S. Census</a></span></div></div>
      <div className="oak-map-route-list" aria-label="地图线路明细">{days.map(day => <section key={day.workDate}><h4><i style={{ backgroundColor: routeDateColor(day.workDate) }} />{day.workDate}<span>{day.taskCount} 段</span></h4>{routes.filter(route => route.date === day.workDate).map(route => {
        const located = Boolean(routePath(route));
        return <div className={`oak-map-route-item${selectedId === route.id ? " active" : ""}`} id={`oak-map-route-${route.id}`} key={route.id}>
          <button className="oak-map-route-select" aria-pressed={selectedId === route.id} onClick={() => setSelectedId(route.id)}><span className="oak-map-route-title"><b style={{ color: routeDateColor(route.date) }}>{route.number}. {driverTaskLabel(route.task)}</b><span>{route.task.miles == null ? "-" : route.task.miles.toLocaleString("en-US")} mi</span></span><span className="oak-map-route-reference">{route.task.reference || "无参考号"}</span><span className="oak-map-route-endpoints"><OakLocationLabel code={route.task.fromLocation} locations={locations} /><ArrowRight size={13} /><OakLocationLabel code={route.task.toLocation} locations={locations} /></span></button>
          <div className="oak-map-route-bottom"><span className={located ? "" : "oak-map-pending"}>{located ? "起终点连线" : "地点待定位，未连线"}</span>{located ? <a title="在 Google Maps 查看道路参考" href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${locationPosition(route.from)!.lat},${locationPosition(route.from)!.lng}`)}&destination=${encodeURIComponent(`${locationPosition(route.to)!.lat},${locationPosition(route.to)!.lng}`)}&travelmode=driving`} target="_blank" rel="noreferrer"><ExternalLink size={13} /><span className="sr-only">Google Maps 道路参考</span></a> : null}</div>
        </div>;
      })}</section>)}</div>
    </div>
  </div>;
}
