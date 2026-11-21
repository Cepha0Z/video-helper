import { httpUrl } from './media.js';

export function requestContext(pageUrl, resourceUrl, observed = {}) {
  if (!httpUrl(pageUrl) || !httpUrl(resourceUrl)) throw new Error('Invalid source page.');
  const page = new URL(pageUrl), resource = new URL(resourceUrl);
  const referrer = httpUrl(observed.referer) || (page.origin === resource.origin ? page.href : page.origin + '/');
  const origin = observed.origin && httpUrl(observed.origin) ? new URL(observed.origin).origin
    : page.origin !== resource.origin ? page.origin : null;
  return { referer: referrer, origin };
}

export function addContext(records, owner, url, headers) {
  if (!httpUrl(url)) throw new Error('Invalid media server.');
  const scope = new URL('.', url).href;
  const same = (a,b) => a.referer === b.referer && a.origin === b.origin;
  for (const record of records) {
    if ((scope.startsWith(record.scope) || record.scope.startsWith(scope)) && !same(record.headers, headers)) {
      throw new Error('This server needs a different session. Finish its active download, then retry.');
    }
  }
  const result = structuredClone(records);
  const existing = result.find(record => record.scope === scope && same(record.headers, headers));
  if (existing) existing.owners = [...new Set([...existing.owners, owner])];
  else result.push({ scope, headers, owners: [owner] });
  if (result.length > 128) throw new Error('Too many media servers are active. Retry after a download finishes.');
  return result;
}

export function removeContext(records, owner) {
  return records.map(record => ({...record, owners: record.owners.filter(id => id !== owner)})).filter(record => record.owners.length);
}

export function contextRules(records, extensionId) {
  return records.map((record,index) => ({
    id: 1000 + index, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [
      { header: 'Referer', operation: 'set', value: record.headers.referer },
      ...(record.headers.origin ? [{ header: 'Origin', operation: 'set', value: record.headers.origin }] : [])
    ] },
    condition: {
      regexFilter: '^' + record.scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      initiatorDomains: [extensionId], resourceTypes: ['xmlhttprequest', 'media', 'other']
    }
  }));
}
