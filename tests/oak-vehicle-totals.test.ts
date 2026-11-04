import {test} from 'node:test';import assert from 'node:assert/strict';
import {vehicleTotalsPreview} from '../lib/oak-vehicle-totals';
import type {VehicleAccountingLine,VehicleField} from '../lib/oak-vehicle-accounting';
const lines=(overrides:Partial<Record<VehicleField,Partial<VehicleAccountingLine>>>={})=>Object.fromEntries(Object.entries({maintenance:0,labor:1870,fuel:643.01,insurance:null,income:3940}).map(([key,amount])=>[key,{amount,source:'ledger',basis:'',...overrides[key as VehicleField]}])) as Record<VehicleField,VehicleAccountingLine>;
test('known expenses and provisional profit remain visible without treating missing insurance as confirmed zero',()=>{
 const source=lines(),before=structuredClone(source),result=vehicleTotalsPreview(source,0);assert.equal(result.knownCost,2513.01);assert.equal(result.provisionalNet,1426.99);assert.deepEqual(result.missingCosts,['insurance']);assert.deepEqual(source,before);assert.equal(source.insurance.amount,null);
});
test('explicit zero completes a cost line and actual insurance reduces the result',()=>{
 assert.deepEqual(vehicleTotalsPreview(lines({insurance:{amount:0}}),0).missingCosts,[]);
 assert.equal(vehicleTotalsPreview(lines({insurance:{amount:100}}),0).provisionalNet,1326.99);
});
test('partial entered wage subtotals are counted but remain flagged as incomplete',()=>{
 const result=vehicleTotalsPreview(lines({labor:{amount:null,knownAmount:1000}}),0);assert.equal(result.knownCost,1643.01);assert.deepEqual(result.missingCosts,['labor','insurance']);
});
test('missing income never produces false negative profit and empty expenses never become known zero',()=>{
 assert.equal(vehicleTotalsPreview(lines({income:{amount:null,knownAmount:0}}),0).provisionalNet,null);
 const empty=Object.fromEntries(['maintenance','labor','fuel','insurance','income'].map(key=>[key,{amount:null,source:'missing',basis:''}])) as Record<VehicleField,VehicleAccountingLine>;
 assert.equal(vehicleTotalsPreview(empty,0).knownCost,null);assert.equal(vehicleTotalsPreview(empty,20).knownCost,20);assert.equal(vehicleTotalsPreview(lines(),null).knownCost,null);
});
