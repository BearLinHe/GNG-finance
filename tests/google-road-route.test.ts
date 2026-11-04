import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import * as mapsClient from '../lib/google-maps-client';
import {getGoogleRoadRoute,googleRoadKey} from '../lib/google-road-route';
import type {DriverLocation} from '../lib/oak-route-types';
const from:DriverLocation={code:'SFO',name:'Hayward',city:'Hayward',state:'CA',zip:'94545',precision:'postal',note:'ZIP area',address:'Hayward, CA 94545',latitude:37.63,longitude:-122.09};
const to:DriverLocation={code:'STK',name:'STK',city:'Stockton',state:'CA',zip:'95206',precision:'address',note:'User address',address:'1642 Northrop St, Stockton, CA 95206',latitude:37.93,longitude:-121.29};
test('Google road reference requests bounded fields and does not replace original workbook miles',async()=>{
 const previous=globalThis.google;let count=0,request:any;
 const loader=mock.method(mapsClient,'loadGoogleMaps',async()=>({}));
 globalThis.google={maps:{importLibrary:async()=>({Route:{computeRoutes:async(input:any)=>{request=input;count++;return{routes:[{path:[{lat:37.63,lng:-122.09},{lat:37.7,lng:-121.8},{lat:37.93,lng:-121.29}],distanceMeters:160934.4,durationMillis:3600000}]};}}})}} as unknown as typeof google;
 try{const first=await getGoogleRoadRoute(from,to),second=await getGoogleRoadRoute(from,to);assert.deepEqual(first,second);assert.equal(count,1);assert.equal(first.path.length,3);assert.equal(first.miles,100);assert.equal(first.minutes,60);
  assert.equal(request.origin,from.address);assert.equal(request.destination,to.address);assert.equal(request.travelMode,'DRIVING');assert.deepEqual(request.fields,['path','distanceMeters','durationMillis']);assert.notEqual(googleRoadKey(from,to),googleRoadKey(to,from));
 }finally{loader.mock.restore();globalThis.google=previous;}
});
test('unavailable road service rejects safely and never caches a failure as a route',async()=>{
 const previous=globalThis.google;let count=0;const loader=mock.method(mapsClient,'loadGoogleMaps',async()=>({}));
 globalThis.google={maps:{importLibrary:async()=>({Route:{computeRoutes:async()=>{count++;throw Error('sensitive upstream details');}}})}} as unknown as typeof google;
 try{const endpoint={...to,address:'Different destination'};await assert.rejects(getGoogleRoadRoute(from,endpoint),/Routes API/);await assert.rejects(getGoogleRoadRoute(from,endpoint),/Routes API/);assert.equal(count,2);}
 finally{loader.mock.restore();globalThis.google=previous;}
});
