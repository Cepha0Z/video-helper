const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function abortError() { return new DOMException('Download cancelled.', 'AbortError'); }

export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || abortError());
    const done = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(done, ms);
    const cancel = () => { clearTimeout(timer); reject(signal.reason || abortError()); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

export async function fetchResource(url, { signal, range, text = false, fetcher = fetch, retries = 2, timeout = 30000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason || abortError());
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('The media server took too long to respond.')), timeout);
    let retryable = true;
    try {
      const response = await fetcher(url, { credentials: 'include', signal: controller.signal,
        headers: range ? { Range: `bytes=${range.start}-${range.end}` } : {} });
      if (!response.ok) {
        retryable = RETRY_STATUS.has(response.status);
        throw new Error([401, 403].includes(response.status)
          ? `Media access was denied (${response.status}). Keep the lesson open, reload it, and detect the stream again.`
          : `The media server returned HTTP ${response.status}.`);
      }
      if (range) {
        const expected = `bytes ${range.start}-${range.end}/`;
        if (response.status !== 206 || !response.headers.get('content-range')?.startsWith(expected)) {
          retryable = false; throw new Error('The media server did not honor the requested byte range.');
        }
      }
      if (text) {
        const value = await response.text();
        if (value.length > 8 * 1024 * 1024) throw new Error('The playlist is too large.');
        return { text: value, url: response.url || url };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength || range && bytes.byteLength !== range.end - range.start + 1) {
        throw new Error('The media server returned an empty or incomplete segment.');
      }
      return bytes;
    } catch (error) {
      signal?.throwIfAborted();
      if (!retryable || attempt === retries) throw error;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
    await wait(400 * 2 ** attempt, signal);
  }
}

// A sliding window bounds both network concurrency and out-of-order buffered data.
export async function orderedDownload(items, fetchItem, consume, { concurrency = 4, signal, onProgress = () => {} } = {}) {
  const pending = new Map();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason || abortError());
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const launch = index => {
    // Wrap rejection immediately; later slots may fail before their turn is awaited.
    pending.set(index, Promise.resolve().then(() => fetchItem(items[index], index, controller.signal))
      .then(value => ({ value }), error => ({ error })));
  };
  try {
    for (let i = 0; i < Math.min(concurrency, items.length); i++) launch(i);
    for (let i = 0; i < items.length; i++) {
      controller.signal.throwIfAborted();
      const result = await pending.get(i);
      pending.delete(i);
      if (result.error) throw result.error;
      controller.signal.throwIfAborted();
      await consume(result.value, items[i], i);
      onProgress(i + 1, items.length, result.value.byteLength);
      const next = i + concurrency;
      if (next < items.length) launch(next);
    }
  } finally {
    controller.abort();
    await Promise.all(pending.values());
    signal?.removeEventListener('abort', abort);
  }
}
