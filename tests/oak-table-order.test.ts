import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moveTableItem,reconcileTableOrder} from '../lib/oak-table-order';
test('drag order moves an item without mutating source keys or losing data',()=>{const source=['vehicle','fuel','income'];assert.deepEqual(moveTableItem(source,'income','vehicle'),['income','vehicle','fuel']);assert.deepEqual(source,['vehicle','fuel','income']);});
test('invalid and self drops leave the order unchanged',()=>{assert.deepEqual(moveTableItem(['a','b'],'z','a'),['a','b']);assert.deepEqual(moveTableItem(['a','b'],'a','a'),['a','b']);});
test('stored layout preserves known IDs and appends newly introduced columns',()=>{assert.deepEqual(reconcileTableOrder(['income','vehicle','old','income'],['vehicle','fuel','income']),['income','vehicle','fuel']);});
test('row identity is not a numeric vehicle number and preserves leading zeroes',()=>{assert.deepEqual(moveTableItem(['oak-15','oak-19','oak-26'],'oak-26','oak-15'),['oak-26','oak-15','oak-19']);});
