import test from 'node:test';
import assert from 'node:assert/strict';
import { requestContext, addContext, removeContext, contextRules } from '../src/core/contexts.js';

test('keeps the original page request context independently of subsequent navigation', () => {
  const context=requestContext('https://100xdevs.com/episode/1','https://cdn.example/1/master.m3u8');
  assert.deepEqual(context,{referer:'https://100xdevs.com/',origin:'https://100xdevs.com'});
  assert.equal(requestContext('https://example.com/lesson','https://example.com/video.mp4').referer,'https://example.com/lesson');
  assert.equal(requestContext('https://example.com/lesson','https://cdn.example/video.mp4',{referer:'https://example.com/player',origin:'https://example.com'}).referer,'https://example.com/player');
});
test('rules apply only to extension requests in a media directory and are released per owner', () => {
  const headers={referer:'https://site.example/',origin:'https://site.example'};
  let records=addContext([],'one','https://cdn.example/episode.1/master.m3u8',headers);
  records=addContext(records,'two','https://cdn.example/episode.1/playlist.m3u8',headers);
  const [rule]=contextRules(records,'extension-id');
  assert.deepEqual(rule.condition.initiatorDomains,['extension-id']);
  assert.ok(new RegExp(rule.condition.regexFilter).test('https://cdn.example/episode.1/part.ts'));
  assert.ok(!new RegExp(rule.condition.regexFilter).test('https://cdn.example/episodeX1/part.ts'));
  assert.equal(removeContext(records,'one').length,1);
  assert.equal(removeContext(removeContext(records,'one'),'two').length,0);
});
test('conflicting request contexts cannot silently change an existing download', () => {
  const records=addContext([],'one','https://cdn.example/episode/master.m3u8',{referer:'https://one.example/'});
  assert.throws(() => addContext(records,'two','https://cdn.example/episode/quality/playlist.m3u8',{referer:'https://two.example/'}),/different session/);
  assert.equal(records[0].owners.length,1);
});
