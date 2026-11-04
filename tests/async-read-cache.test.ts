import test from 'node:test';
import assert from 'node:assert/strict';
import {createAsyncReadCache} from '../lib/async-read-cache';

test('simultaneous reads share a request, but zero-TTL results are never reused after completion',async()=>{
 const cache=createAsyncReadCache<number>({ttlMs:0});let count=0;
 const load=async()=>++count;
 assert.deepEqual(await Promise.all([cache.read('a',load),cache.read('a',load)]),[1,1]);
 assert.equal(await cache.read('a',load),2);
});
test('cached reads expire, are bounded and never mix different vehicle keys',async()=>{
 let now=1,count=0;const cache=createAsyncReadCache<number>({ttlMs:30,maxEntries:2,now:()=>now});
 const load=async()=>++count;
 assert.equal(await cache.read('a',load),1);assert.equal(await cache.read('a',load),1);
 assert.equal(await cache.read('b',load),2);assert.equal(await cache.read('c',load),3);
 assert.equal(await cache.read('a',load),4);now=40;assert.equal(await cache.read('a',load),5);
});
test('failed or unavailable source reads are not cached or replaced by an old success',async()=>{
 let now=0,count=0;const cache=createAsyncReadCache<{available:boolean}>({ttlMs:30,now:()=>now,cacheable:value=>value.available});
 await cache.read('a',async()=>({available:true}));now=31;
 await assert.rejects(cache.read('a',async()=>{throw Error('offline');}),/offline/);
 const load=async()=>{count++;return{available:false};};
 await cache.read('a',load);await cache.read('a',load);assert.equal(count,2);
});
test('saving bypasses cached reads and an older inflight result cannot overwrite the fresh result',async()=>{
 const cache=createAsyncReadCache<number>({ttlMs:30000});let finish!:(value:number)=>void;
 const old=cache.read('a',()=>new Promise(resolve=>{finish=resolve;}));await Promise.resolve();
 assert.equal(await cache.read('a',async()=>2,true),2);finish(1);assert.equal(await old,1);
 assert.equal(await cache.read('a',async()=>3),2);
 assert.equal(await cache.read('a',async()=>4,true),4);
});
