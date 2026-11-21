import test from 'node:test';
import assert from 'node:assert/strict';

test('network detection, deduplication, cached rescanning and navigation clearing', async () => {
  const listeners = {};
  const event = name => ({ addListener:fn => { listeners[name] = fn; } });
  const values = {};
  const pageUrl='https://100xdevs.com/new-courses/23/video/4167';
  const engineMessages=[];
  globalThis.chrome = {
    runtime: {id:'test-extension',getURL:path => `chrome-extension://test-extension/${path}`,onMessage:event('message'),getContexts:async () => [{}],
      sendMessage:async message => {engineMessages.push(message);return message.type==='INSPECT' ? {result:{variants:[{url:message.context.url,height:480}]}} : {ok:true};}},
    action: {setBadgeText:async () => {},setBadgeBackgroundColor:async () => {}},
    webRequest: {onBeforeRequest:event('request'),onBeforeSendHeaders:event('before'),onHeadersReceived:event('headers')},
    permissions:{getAll:async () => ({origins:['https://100xdevs.com/*']}),contains:async () => true,onAdded:event('added'),onRemoved:event('permissionsRemoved')},
    tabs: {get:async id => ({id,url:pageUrl,title:'Lesson'}),onUpdated:event('updated'),onRemoved:event('removed')},
    storage: {session:{get:async key => ({[key]:values[key]}),set:async data => Object.assign(values,structuredClone(data)),remove:async key => {delete values[key];}}},
    declarativeNetRequest:{getSessionRules:async () => [],updateSessionRules:async () => {}},
    scripting: {getRegisteredContentScripts:async () => [],registerContentScripts:async () => {},executeScript:async options => options.world==='MAIN' ? [] : [{frameId:0,result:{url:pageUrl,title:'Neural Networks',thumbnail:'data:image/jpeg;base64,AAAA',entries:[{url:'https://transcoded-video.b-cdn.net/4165/master.m3u8',source:'page history'}]}}]}
  };
  await import('../src/background.js');
  const message = (type,extra={}) => new Promise(resolve => listeners.message({type,tabId:7,...extra},{id:'test-extension',url:'chrome-extension://test-extension/popup.html'},resolve));
  const request = { tabId:7,url:'https://transcoded-video.b-cdn.net/4165/master.m3u8',statusCode:200,frameId:0,
    responseHeaders:[{name:'Content-Type',value:'application/vnd.apple.mpegurl'}],type:'xmlhttprequest' };
  listeners.headers(request); listeners.headers(request);
  let response = await message('GET_STATE');
  assert.equal(response.state.candidates.length,1);
  assert.deepEqual(response.state.candidates[0].sources,['network']);
  response = await message('SCAN');
  assert.equal(response.state.candidates.length,1);
  assert.deepEqual(response.state.candidates[0].sources,['network','page history']);
  assert.equal(response.state.title,'Neural Networks');
  const candidate=response.state.candidates[0];
  await message('INSPECT',{candidateId:candidate.id});
  const started=await message('START_JOB',{candidateId:candidate.id,url:candidate.url,filename:'Episode one'});
  assert.ok(started.id);
  assert.equal(engineMessages.at(-1).type,'ENQUEUE');
  assert.equal((await message('GET_STATE')).jobs[0].title,'Episode one');
  const duplicate=await message('START_JOB',{candidateId:candidate.id,url:candidate.url});
  assert.equal(duplicate.id,started.id);
  listeners.headers({...request,url:'https://transcoded-video.b-cdn.net/4165/1080p_00000.ts',responseHeaders:[{name:'Content-Type',value:'video/mp2t'}]});
  assert.equal((await message('GET_STATE')).state.candidates.length,1);
  let leaked = false;
  assert.equal(listeners.message({type:'GET_STATE',tabId:7},{id:'test-extension',tab:{id:7},url:'https://100xdevs.com/'},() => {leaked = true;}),undefined);
  assert.equal(leaked,false);
  listeners.updated(7,{status:'loading'});
  assert.equal((await message('GET_STATE')).state.candidates.length,0);
  assert.equal((await message('GET_STATE')).jobs.length,1,'Source navigation must not clear active downloads');
  listeners.headers(request);
  assert.equal((await message('GET_STATE')).state.candidates.length,1);
  listeners.updated(7,{url:'https://100xdevs.com/new-courses/23/video/next'});
  assert.equal((await message('GET_STATE')).state.candidates.length,0);
  delete globalThis.chrome;
});
