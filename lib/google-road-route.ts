import {loadGoogleMaps} from './google-maps-client';
import {createAsyncReadCache} from './async-read-cache';
import {locationPosition,type DriverLocation} from './oak-route-types';
export type GoogleRoadRoute={path:google.maps.LatLngLiteral[];miles:number|null;minutes:number|null};
const cache=createAsyncReadCache<GoogleRoadRoute>({ttlMs:15*60000,maxEntries:80});
export function googleRoadKey(from:DriverLocation|null,to:DriverLocation|null){return JSON.stringify([from?.address,locationPosition(from),to?.address,locationPosition(to)]);}
export function getGoogleRoadRoute(from:DriverLocation,to:DriverLocation):Promise<GoogleRoadRoute>{
  return cache.read(googleRoadKey(from,to),async()=>{
    const origin=locationPosition(from),destination=locationPosition(to);if(!origin||!destination)throw Error('起终点尚未定位');
    await loadGoogleMaps();
    try{
      const {Route}=await google.maps.importLibrary('routes') as google.maps.RoutesLibrary;
      let timer:ReturnType<typeof setTimeout>|undefined;
      const result=await Promise.race([Route.computeRoutes({origin:from.address||origin,destination:to.address||destination,travelMode:'DRIVING',routingPreference:'TRAFFIC_UNAWARE',fields:['path','distanceMeters','durationMillis']}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),18000);})]).finally(()=>clearTimeout(timer));
      const route=result.routes?.[0],path=route?.path?.map(point=>({lat:point.lat,lng:point.lng}));
      if(!path||path.length<2||path.some(point=>!Number.isFinite(point.lat)||!Number.isFinite(point.lng)))throw Error('未返回可用道路');
      return{path,miles:route?.distanceMeters==null?null:route.distanceMeters/1609.344,minutes:route?.durationMillis==null?null:route.durationMillis/60000};
    }catch{throw Error('Google 道路服务暂不可用，请确认 Routes API 已启用、密钥限制及结算设置正确');}
  });
}
