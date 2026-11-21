import test from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../src/core/job-queue.js';
const tick=() => new Promise(resolve => setTimeout(resolve,0));
test('runs multiple downloads, queues overflow, cancels independently and advances after completion', async () => {
  const running=new Map(),started=[];
  const queue=new JobQueue(async (job,signal) => {
    started.push(job.id);
    await new Promise(resolve => {running.set(job.id,resolve);signal.addEventListener('abort',resolve,{once:true});});
  },{limit:2});
  for(const id of ['one','two','three','four']) queue.add({id});
  await tick();assert.deepEqual(started,['one','two']);
  assert.equal(queue.cancel('four'),'queued');
  assert.equal(queue.cancel('one'),'active');
  await tick();assert.deepEqual(started,['one','two','three']);
  assert.ok(queue.active.has('two'),'Cancelling one download must not affect another');
  running.get('two')();running.get('three')();await tick();
  assert.equal(queue.active.size,0);assert.equal(queue.pending.length,0);
});
