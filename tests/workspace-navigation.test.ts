import test from 'node:test';
import assert from 'node:assert/strict';
import {readWorkspaceNavigation,workspaceNavigationUrl} from '../lib/workspace-navigation';

test('first visit defaults to source bills while refresh restores the selected module and OAK workspace',()=>{
 assert.equal(readWorkspaceNavigation('').module,'external');
 const saved=JSON.stringify({module:'oak-transport',oakView:'maintenance'});
 assert.equal(readWorkspaceNavigation('',saved).module,'oak-transport');
 assert.equal(readWorkspaceNavigation('',saved).oakView,'maintenance');
 const url=workspaceNavigationUrl('http://localhost:3000/',readWorkspaceNavigation('',saved));
 assert.equal(url,'/?module=oak-transport&oakView=maintenance');
 assert.deepEqual(readWorkspaceNavigation(new URL(url,'http://localhost').search),readWorkspaceNavigation('',saved));
});
test('explicit module links override saved preferences and retain the existing SAV link',()=>{
 const saved=JSON.stringify({module:'oak-transport',oakView:'labor'});
 assert.equal(readWorkspaceNavigation('?module=sav',saved).module,'sav');
 assert.equal(readWorkspaceNavigation('?module=external',saved).module,'external');
 assert.equal(readWorkspaceNavigation('?module=oak-transport&oakView=insurance',saved).oakView,'insurance');
});
test('invalid browser preferences and unknown query values fall back to validated navigation only',()=>{
 for(const saved of ['{bad','null','[]','123',JSON.stringify({module:'bad',tab:{},oakView:'delete'})])assert.equal(readWorkspaceNavigation('?module=unknown&oakView=bad',saved).module,'external');
 assert.equal(readWorkspaceNavigation('?oakView=bad',JSON.stringify({oakView:'fuel'})).oakView,'fuel');
 assert.equal(readWorkspaceNavigation('?oakView=__proto__').oakView,'vehicles');
});
test('external subpages preserve their category without retaining irrelevant URL navigation',()=>{
 for(const [tab,key,value] of [['initial','initialKind','direct_delivery'],['container','containerKind','direct_delivery'],['fees','standardCategory','warehouse']] as const){
  const state={...readWorkspaceNavigation(''),tab,[key]:value};
  const url=workspaceNavigationUrl('https://example.com/?module=sav&oakView=maintenance&keep=yes#table',state);
  const parsed=new URL(url,'https://example.com');assert.equal(parsed.searchParams.get('keep'),'yes');assert.equal(parsed.hash,'#table');
  assert.equal(parsed.searchParams.has('oakView'),false);assert.equal(readWorkspaceNavigation(parsed.search)[key],value);assert.equal(readWorkspaceNavigation(parsed.search).tab,tab);
 }
});
test('every OAK workspace survives a refresh without saving financial fields or unsaved drafts',()=>{
 for(const oakView of ['vehicles','maintenance','labor','insurance','income','fuel','other','activities','rules','jobs','settlements'] as const){
  const state={...readWorkspaceNavigation(''),module:'oak-transport' as const,oakView};
  const url=workspaceNavigationUrl('http://localhost:3000/?tab=fees&standardCategory=warehouse',state);
  const params=new URL(url,'http://localhost').searchParams;assert.deepEqual([...params.keys()],['module','oakView']);
  assert.equal(readWorkspaceNavigation(params.toString()).oakView,oakView);
 }
});
