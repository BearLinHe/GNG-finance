import test from 'node:test';
import assert from 'node:assert/strict';
import { fitTableColumnWidths, sanitizeTableColumnWidths, type TableColumnSize } from '../lib/oak-table-sizing';
const columns:TableColumnSize[]=[{id:'vehicle',size:100,minSize:70,maxSize:250},{id:'date',size:140,minSize:110,maxSize:250},{id:'income',size:120,minSize:90,maxSize:250},{id:'note',size:240,minSize:130,maxSize:800}];
const total=(sizes:Record<string,number>)=>Object.values(sizes).reduce((sum,width)=>sum+width,0);
test('automatic columns exactly fill the available width, before and after sidebar changes',()=>{
 for(const available of[400,511,800,1200]){const sizes=fitTableColumnWidths(columns,available);assert.equal(total(sizes),available);for(const column of columns)assert.ok(sizes[column.id]>=column.minSize&&sizes[column.id]<=column.maxSize);}
 assert.ok(fitTableColumnWidths(columns,800).note>fitTableColumnWidths(columns,600).note);
});
test('narrow screens preserve readable minimums and scroll only the table',()=>{
 const sizes=fitTableColumnWidths(columns,320);assert.deepEqual(sizes,{vehicle:70,date:110,income:90,note:130});assert.equal(total(sizes),400);
});
test('manually resized columns retain their widths while automatic columns use remaining space',()=>{
 const sizes=fitTableColumnWidths(columns,800,{vehicle:180});assert.equal(sizes.vehicle,180);assert.equal(total(sizes),800);
 const narrow=fitTableColumnWidths(columns,300,{vehicle:180});assert.equal(narrow.vehicle,180);assert.equal(narrow.date,110);assert.equal(total(narrow),510);
});
test('saved widths reject corrupt shapes, unknown keys and nonfinite values',()=>{
 assert.deepEqual(sanitizeTableColumnWidths([],columns),{});assert.deepEqual(sanitizeTableColumnWidths(null,columns),{});
 assert.deepEqual(sanitizeTableColumnWidths({vehicle:NaN,date:Infinity,income:'180',old:200},columns),{});
 assert.deepEqual(sanitizeTableColumnWidths({vehicle:-1,date:9999,income:123.4},columns),{vehicle:70,date:250,income:123});
});
test('rounding and maximum bounds never generate negative or missing column widths',()=>{
 for(let width=400;width<1100;width+=17){const sizes=fitTableColumnWidths(columns,width+.75);assert.equal(total(sizes),width);assert.ok(Object.values(sizes).every(Number.isInteger));}
 assert.equal(total(fitTableColumnWidths(columns,9999)),1550);assert.deepEqual(fitTableColumnWidths([],100),{});
});
test('loading uses preferred widths before the container is measured and keeps fully manual layouts',()=>{
 assert.equal(total(fitTableColumnWidths(columns,0)),600);
 assert.deepEqual(fitTableColumnWidths(columns,900,{vehicle:100,date:140,income:120,note:240}),{vehicle:100,date:140,income:120,note:240});
});
