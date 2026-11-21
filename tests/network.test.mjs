import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchResource, orderedDownload } from '../src/core/network.js';

test('sliding window preserves order and bounds concurrency even if the first segment is slow', async () => {
  let active = 0, max = 0, fetched = 0, consumed = 0, furthest = 0;
  const order = [];
  await orderedDownload(Array.from({length:15},(_,i) => i), async item => {
    active++; max = Math.max(active,max); fetched++;
    furthest = Math.max(furthest, fetched - consumed);
    await new Promise(resolve => setTimeout(resolve,item === 0 ? 30 : 1));
    active--; return new Uint8Array([item]);
  }, data => { order.push(data[0]); consumed++; });
  assert.deepEqual(order, Array.from({length:15},(_,i) => i));
  assert.ok(max <= 4); assert.ok(furthest <= 4);
});

test('failure aborts outstanding requests and does not consume later segments', async () => {
  const consumed = [];
  await assert.rejects(orderedDownload([0,1,2,3,4], async (item,index,signal) => {
    if (item === 1) throw new Error('segment failed');
    if (item > 1) await new Promise(resolve => signal.addEventListener('abort',resolve,{once:true}));
    return new Uint8Array([item]);
  }, data => consumed.push(data[0])), /segment failed/);
  assert.deepEqual(consumed,[0]);
});

test('cancellation prevents consumption and propagates to in-flight fetches', async () => {
  const controller = new AbortController();
  let consumed = false;
  const task = orderedDownload([0,1], async (_,index,signal) => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once:true }));
    return new Uint8Array([index]);
  }, () => { consumed = true; }, {signal:controller.signal});
  setTimeout(() => controller.abort(),5);
  await assert.rejects(task,{name:'AbortError'}); assert.equal(consumed,false);
});

test('authenticated fetch includes credentials and uses the final redirect URL for relative paths', async () => {
  const result = await fetchResource('https://example.com/start', { text:true, fetcher:async (url,options) => {
    assert.equal(options.credentials,'include');
    return { ok:true, url:'https://cdn.example/path/master.m3u8', text:async () => '#EXTM3U' };
  } });
  assert.equal(result.url,'https://cdn.example/path/master.m3u8');
});

test('403 is not retried and does not expose a signed URL in errors', async () => {
  let attempts = 0;
  await assert.rejects(fetchResource('https://media.example/video?token=secret', { fetcher:async () => {
    attempts++; return {ok:false,status:403};
  } }), error => /denied/.test(error.message) && !error.message.includes('secret'));
  assert.equal(attempts,1);
});

test('transient failures are retried', async () => {
  let attempts = 0;
  const bytes = await fetchResource('https://example.com/a.ts',{fetcher:async () => {
    if (++attempts === 1) return {ok:false,status:503};
    return new Response(new Uint8Array([1,2,3]));
  }});
  assert.deepEqual(bytes,new Uint8Array([1,2,3])); assert.equal(attempts,2);
});

test('range fetch rejects full responses and validates partial response length', async () => {
  const options = {range:{start:10,end:12},retries:0};
  await assert.rejects(fetchResource('https://example.com/file',{...options,fetcher:async () => new Response(new Uint8Array([1,2,3]))}), /byte range/);
  const bytes = await fetchResource('https://example.com/file',{...options,fetcher:async (url,init) => {
    assert.equal(init.headers.Range,'bytes=10-12');
    return new Response(new Uint8Array([1,2,3]),{status:206,headers:{'content-range':'bytes 10-12/20'}});
  }});
  assert.equal(bytes.length,3);
});
