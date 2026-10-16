let mapsPromise: Promise<google.maps.MapsLibrary> | null = null;
let configured = false;
let authorizationFailed = false;
const authorizationListeners = new Set<() => void>();

export function onGoogleMapsAuthorizationFailure(listener: () => void) {
  authorizationListeners.add(listener);
  if (authorizationFailed) listener();
  return () => { authorizationListeners.delete(listener); };
}

export function loadGoogleMaps() {
  if (!mapsPromise) {
    mapsPromise = (async () => {
      const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!key) throw new Error("尚未配置 Google Maps 密钥");
      if (authorizationFailed) throw new Error("Google Maps 授权失败，请检查密钥的网站限制、API 启用和结算设置");
      const { setOptions, importLibrary } = await import("@googlemaps/js-api-loader");
      if (!configured) {
        const target = window as Window & { gm_authFailure?: () => void };
        const previous = target.gm_authFailure;
        target.gm_authFailure = () => {
          authorizationFailed = true; authorizationListeners.forEach(listener => listener()); previous?.();
        };
        setOptions({ key, v: "weekly", language: "zh-CN", region: "US" }); configured = true;
      }
      const maps = await importLibrary("maps");
      if (authorizationFailed) throw new Error("Google Maps 授权失败，请检查密钥的网站限制、API 启用和结算设置");
      return maps;
    })().catch(error => { mapsPromise = null; throw error; });
  }
  return mapsPromise;
}
