import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assistantAccess,assistantMode,assistantVisitor} from '../lib/finance-assistant-access';

const prod={NODE_ENV:'production',VERCEL_ENV:'production'};
const host='finance.example',origin='https://'+host;
function post(headers: Record<string,string>={},url=origin){
  return new Request(url,{method:'POST',headers:{host,origin,'content-type':'application/json',...headers}});
}

test('production visitors can open and use the assistant without a code; previews stay off',()=>{
  assert.equal(assistantMode(prod),'hosted');
  assert.equal(assistantMode({NODE_ENV:'production'}),'hosted');
  assert.equal(assistantMode({...prod,VERCEL_ENV:'preview'}),'off');
  assert.equal(assistantAccess(new Request(origin,{headers:{host}}),prod),'hosted');
  assert.equal(assistantAccess(post(),prod),'hosted');
});
test('hosted writes require same-origin JSON over TLS',()=>{
  for(const req of [post({origin:'https://other.example'}),post({'content-type':'text/plain'}),post({},'http://'+host),post({host:'other.example'}),post({'sec-fetch-site':'cross-site'})]){
    assert.equal(assistantAccess(req,prod),'denied');
  }
  const proxied=post({'x-forwarded-proto':'https'},'http://internal:3000');
  assert.equal(assistantAccess(proxied,prod),'denied');
  assert.equal(assistantAccess(proxied,{...prod,VERCEL:'1'}),'hosted');
});
test('local assistant remains opt-in and loopback only',()=>{
  const localHost='127.0.0.1:3001',localOrigin='http://'+localHost;
  const req=post({host:localHost,origin:localOrigin},localOrigin);
  const env={NODE_ENV:'development',NEXT_PUBLIC_OAK_LOCAL_ASSISTANT:'1'};
  assert.equal(assistantAccess(req,env),'local');
  assert.equal(assistantAccess(req,{NODE_ENV:'development'}),'denied');
  assert.equal(assistantAccess(post(),env),'denied');
});
test('each anonymous browser has its own draft identity; subsequent calls reuse only its cookie',()=>{
  const alice=assistantVisitor(post(),'hosted'),bob=assistantVisitor(post(),'hosted');
  assert.equal(alice.isNew,true);
  assert.match(alice.value,/^[0-9a-f]{64}$/);
  assert.notEqual(alice.value,bob.value);
  const req=post({cookie:'other=1; '+alice.name+'='+alice.value});
  assert.deepEqual(assistantVisitor(req,'hosted'),{...alice,isNew:false});
  assert.equal(assistantVisitor(req,'local').isNew,true);
  const malformed=post({cookie:alice.name+'=anonymous'});
  assert.equal(assistantAccess(malformed,prod),'hosted');
  assert.equal(assistantVisitor(malformed,'hosted').isNew,true);
});
