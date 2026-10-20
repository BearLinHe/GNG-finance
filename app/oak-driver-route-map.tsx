"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Info, Layers3, LocateFixed, MapPin, RefreshCw, Route as RouteIcon, TriangleAlert } from "lucide-react";
import { driverTaskLabel, type DriverDay } from "@/lib/oak-driver-types";
import { buildDriverRoutes, buildDriverRouteStyles, locationCity, locationPosition, type DriverLocations, type DriverRoute, type DriverRouteStyle } from "@/lib/oak-route-types";
import { loadGoogleMaps, onGoogleMapsAuthorizationFailure } from "@/lib/google-maps-client";
import OakLocationLabel from "./oak-location-label";

function routePath(route: DriverRoute) {
  const from = locationPosition(route.from); const to = locationPosition(route.to);
  return from && to ? [from, to] : null;
}

function lineStyle(style: DriverRouteStyle, active: boolean): google.maps.PolylineOptions {
  const icons: google.maps.IconSequence[] = [];
  if (style.reverseOf != null) icons.push({ icon: { path: "M 0,-1 0,1", strokeColor: style.color, strokeOpacity: 1, strokeWeight: 2, scale: 3 }, offset: "0", repeat: "14px" });
  icons.push({ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: style.color, fillColor: style.color, fillOpacity: 1, strokeOpacity: 1 }, offset: "65%" });
  return { strokeColor: style.color, strokeWeight: active ? 6 : 4, strokeOpacity: style.reverseOf == null ? .9 : 0, icons, zIndex: active ? 2 : 1 };
}

type MapSelection = { scope: string; mode: "segment" | "overview"; routeId: string };

export default function OakDriverRouteMap({ days, locations, driverName, allDates, onSelectDate }: { days: DriverDay[]; locations: DriverLocations; driverName: string; allDates: boolean; onSelectDate: (date: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const lines = useRef<Map<string, google.maps.Polyline>>(new Map());
  const dots = useRef<Map<string, google.maps.Circle>>(new Map());
  const infoWindow = useRef<google.maps.InfoWindow | null>(null);
  const routes = useMemo(() => buildDriverRoutes(days, locations), [days, locations]);
  const styles = useMemo(() => buildDriverRouteStyles(routes), [routes]);
  const scope = `${allDates ? "all" : "day"}:${days.map(day => day.workDate).join(",")}`;
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const current = selection?.scope === scope ? selection : { scope, mode: allDates ? "overview" as const : "segment" as const, routeId: routes[0]?.id || "" };
  const mode = current.mode;
  const selectedIndex = Math.max(0, routes.findIndex(route => route.id === current.routeId));
  const selected = mode === "segment" ? routes[selectedIndex] : null;
  const selectedId = selected?.id || "";
  const visibleRoutes = useMemo(() => mode === "segment" ? routes.filter(route => route.id === selectedId) : routes, [mode, selectedId, routes]);
  const visibleRoutesRef = useRef(visibleRoutes);
  useEffect(() => { visibleRoutesRef.current = visibleRoutes; }, [visibleRoutes]);
  const chooseRoute = useCallback((id: string) => {
    const route = routes.find(item => item.id === id);
    if (!route) return;
    if (allDates) onSelectDate(route.date);
    setSelection({ scope: allDates ? `day:${route.date}` : scope, mode: "segment", routeId: id });
  }, [scope, allDates, onSelectDate, routes]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const mapped = routes.filter(route => routePath(route));
  const pending = routes.length - mapped.length;
  const shown = visibleRoutes.filter(route => routePath(route)).length;
  const overviewLabel = days.length > 1 ? "多日总览" : "当日总览";

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
    let resizeFrame = 0;
    let clearResizeFit: (() => void) | undefined;
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
      resize = new ResizeObserver(() => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          if (!map.current) return;
          google.maps.event.trigger(map.current, "resize");
          clearResizeFit?.();
          clearResizeFit = fitRoutes(visibleRoutesRef.current);
        });
      });
      resize.observe(container.current);
      setStatus("ready");
    }).catch(err => { if (!cancelled) { setStatus("error"); setError(err instanceof Error ? err.message : "地图加载失败"); } })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true; unsubscribe(); window.clearTimeout(timeout); resize?.disconnect(); window.cancelAnimationFrame(resizeFrame); clearResizeFit?.();
      if (map.current) google.maps.event.clearInstanceListeners(map.current);
      map.current = null;
    };
  }, [attempt, fitRoutes]);

  useEffect(() => {
    if (status !== "ready" || !map.current) return;
    const overlays: Array<google.maps.Polyline | google.maps.Circle> = [];
    const listeners: google.maps.MapsEventListener[] = [];
    const points = new Set<string>();
    const info = new google.maps.InfoWindow({ maxWidth: 280 });
    infoWindow.current = info;
    for (const route of routes) {
      const path = routePath(route);
      if (path) {
        const line = new google.maps.Polyline({
          map: map.current, path, geodesic: false, visible: false, ...lineStyle(styles[route.id], false)
        });
        lines.current.set(route.id, line); overlays.push(line);
        listeners.push(line.addListener("click", () => {
          chooseRoute(route.id);
          document.getElementById(`oak-map-route-${route.id}`)?.scrollIntoView({ block: "nearest" });
        }));
      }
      for (const location of [route.from, route.to]) {
        const position = locationPosition(location);
        if (!location || !position) continue;
        const key = `${position.lat},${position.lng}`;
        if (points.has(key)) continue;
        points.add(key);
        const dot = new google.maps.Circle({ map: map.current, center: position, radius: location.precision === "postal" ? 450 : 90, fillColor: "#17212f", fillOpacity: .7, strokeColor: "#ffffff", strokeWeight: 2, clickable: true, visible: false });
        overlays.push(dot); dots.current.set(key, dot);
        listeners.push(dot.addListener("click", () => {
          const content = document.createElement("div"); content.className = "oak-map-info";
          const title = document.createElement("strong"); title.textContent = `${location.code} · ${location.name}`;
          const address = document.createElement("p"); address.textContent = location.address || locationCity(location);
          const note = document.createElement("small"); note.textContent = location.note;
          content.append(title, address, note); info.setContent(content); info.setPosition(position); info.open(map.current);
        }));
      }
    }
    return () => { info.close(); infoWindow.current = null; listeners.forEach(listener => listener.remove()); overlays.forEach(overlay => overlay.setMap(null)); lines.current.clear(); dots.current.clear(); };
  }, [status, routes, styles, chooseRoute]);

  useEffect(() => {
    if (status !== "ready") return;
    const visibleIds = new Set(visibleRoutes.map(route => route.id));
    const visiblePoints = new Set(visibleRoutes.flatMap(route => [locationPosition(route.from), locationPosition(route.to)]).filter((point): point is google.maps.LatLngLiteral => point !== null).map(point => `${point.lat},${point.lng}`));
    lines.current.forEach((line, id) => { line.setVisible(visibleIds.has(id)); line.setOptions(lineStyle(styles[id], id === selectedId)); });
    dots.current.forEach((dot, key) => dot.setVisible(visiblePoints.has(key)));
    infoWindow.current?.close();
    return fitRoutes(visibleRoutes);
  }, [selectedId, visibleRoutes, styles, status, fitRoutes]);

  return <div className="oak-route-map" data-map-status={status} data-map-mode={mode} data-mapped-routes={mapped.length} data-visible-routes={shown} data-selected-route={selectedId}>
    <div className="oak-map-view-head"><div className="oak-map-context"><CalendarDays size={15} /><strong>{allDates ? `${days[0]?.workDate || ""} 至 ${days.at(-1)?.workDate || ""}` : days[0]?.workDate}</strong><span>{allDates ? `${days.length} 天范围` : "当日作业"}</span></div><div className="oak-map-modes" role="group" aria-label="线路显示方式"><button aria-pressed={mode === "segment"} className={mode === "segment" ? "active" : ""} onClick={() => chooseRoute(current.routeId || routes[0]?.id || "")}><RouteIcon size={14} />逐段查看</button><button aria-pressed={mode === "overview"} className={mode === "overview" ? "active" : ""} onClick={() => setSelection({ ...current, mode: "overview" })}><Layers3 size={14} />{overviewLabel}</button></div></div>
    <div className="oak-map-accuracy"><Info size={14} /><strong>起终点示意，非道路路线 / GPS 轨迹</strong>{mode === "overview" && days.length > 1 ? <span className="oak-map-multiday">{days.length} 天、{routes.length} 段叠加显示</span> : null}</div>
    {selected ? <div className="oak-map-current"><div className="oak-map-step"><div className="oak-map-step-buttons"><button className="icon-button" title="上一段" disabled={!selectedIndex} onClick={() => chooseRoute(routes[selectedIndex - 1].id)}><ChevronLeft size={15} /></button><strong>{allDates ? `${selected.date} · ` : ""}第 {selectedIndex + 1} / {routes.length} 段</strong><button className="icon-button" title="下一段" disabled={selectedIndex >= routes.length - 1} onClick={() => chooseRoute(routes[selectedIndex + 1].id)}><ChevronRight size={15} /></button></div><span>{driverTaskLabel(selected.task)} · 原表 {selected.task.miles == null ? "-" : selected.task.miles.toLocaleString("en-US")} mi</span></div><div className="oak-map-current-endpoints"><OakLocationLabel code={selected.task.fromLocation} locations={locations} /><ArrowRight size={16} /><OakLocationLabel code={selected.task.toLocation} locations={locations} /></div></div> : null}
    <div className="oak-map-summary"><span><MapPin size={14} />图中显示 {shown} 段<span className="oak-map-located">已定位 {mapped.length} / {routes.length} 段</span></span>{pending ? <span className="oak-map-pending"><TriangleAlert size={14} />{pending} 段有地点待定位</span> : null}<button className="icon-button" title="适应当前视图" disabled={status !== "ready"} onClick={() => fitRoutes(visibleRoutes)}><LocateFixed size={16} /></button></div>
    <div className="oak-route-map-layout">
      <div className="oak-map-pane"><div className="oak-map-canvas-wrap"><div ref={container} className="oak-map-canvas" aria-label={`${driverName} 运输线路地图`} />
        {status === "ready" ? <div className="oak-map-scene-label">{selected ? `${selected.date} · 第 ${selected.number} / ${routes.length} 段` : `${overviewLabel} · ${days.length} 天 / ${routes.length} 段`}<small>起终点示意</small></div> : null}
        {status !== "ready" ? <div className="oak-map-state" role="status"><MapPin size={26} /><strong>{status === "loading" ? "正在加载 Google Maps..." : "地图暂不可用"}</strong>{error ? <p>{error}</p> : null}{status === "error" ? <button className="button ghost" onClick={() => { if (error.includes("授权失败")) window.location.reload(); else setAttempt(value => value + 1); }}><RefreshCw size={14} />{error.includes("授权失败") ? "刷新页面" : "重试"}</button> : null}</div> : !shown ? <div className="oak-map-no-routes">{selected ? "本段地点待定位，未绘制连线" : "当前作业没有可连线的完整起终点"}</div> : null}
      </div><div className="oak-map-footnote">起终点示意连线，非实际行驶轨迹。邮编按区域定位；里程沿用原表。<span>地点坐标：邮编资料库 / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a> / <a href="https://geocoding.geo.census.gov/geocoder/" target="_blank" rel="noreferrer">U.S. Census</a></span></div></div>
      <div className="oak-map-route-list" aria-label="地图线路明细">{days.map(day => <section key={day.workDate}><h4><CalendarDays size={13} />{day.workDate}<span>{day.taskCount} 段</span></h4>{routes.filter(route => route.date === day.workDate).map(route => {
        const located = Boolean(routePath(route));
        const style = styles[route.id];
        return <div className={`oak-map-route-item${selectedId === route.id ? " active" : ""}`} id={`oak-map-route-${route.id}`} key={route.id}>
          <button className="oak-map-route-select" aria-pressed={selectedId === route.id} onClick={() => chooseRoute(route.id)}><span className="oak-map-route-title"><b style={{ color: style.color }}><span className="oak-map-route-number" style={{ backgroundColor: style.color }}>{route.number}</span>{driverTaskLabel(route.task)}</b><span>原表 {route.task.miles == null ? "-" : route.task.miles.toLocaleString("en-US")} mi</span></span><span className="oak-map-route-reference">{route.task.reference || "无参考号"}</span><span className="oak-map-route-endpoints"><OakLocationLabel code={route.task.fromLocation} locations={locations} /><ArrowRight size={13} /><OakLocationLabel code={route.task.toLocation} locations={locations} /></span></button>
          <div className="oak-map-route-bottom"><span className={located ? "oak-map-line-legend" : "oak-map-pending"}>{located ? <><i className={style.reverseOf != null ? "reverse" : ""} style={{ borderColor: style.color }} />{style.reverseOf != null ? `与第 ${style.reverseOf} 段反向` : "起终点连线"}</> : "地点待定位，未连线"}</span>{located ? <a title="在 Google Maps 查看道路参考" href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${locationPosition(route.from)!.lat},${locationPosition(route.from)!.lng}`)}&destination=${encodeURIComponent(`${locationPosition(route.to)!.lat},${locationPosition(route.to)!.lng}`)}&travelmode=driving`} target="_blank" rel="noreferrer"><ExternalLink size={13} /><span className="sr-only">Google Maps 道路参考</span></a> : null}</div>
        </div>;
      })}</section>)}</div>
    </div>
  </div>;
}
