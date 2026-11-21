export async function createStagingFile() {
  if (!navigator.storage?.getDirectory) throw new Error('Temporary disk storage is unavailable in this browser.');
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle('downloads', { create: true });
  const name = `${Date.now()}-${crypto.randomUUID()}.mp4`;
  const handle = await directory.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  let closed = false;
  return {
    async write(bytes) { await writer.write(bytes); },
    async writeAt(bytes, position) { await writer.write({ type: 'write', position, data: bytes }); },
    async finish() { await writer.close(); closed = true; return handle.getFile(); },
    async remove() {
      if (!closed) await writer.abort().catch(() => {});
      closed = true; await directory.removeEntry(name).catch(() => {});
    }
  };
}

export async function removeAbandonedFiles() {
  if (!navigator.storage?.getDirectory) return;
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle('downloads', { create: true });
  const entries = [];
  for await (const [name] of directory.entries()) entries.push(name);
  // The app is a singleton, so any files here at startup belong to interrupted jobs.
  await Promise.all(entries.map(name => directory.removeEntry(name).catch(() => {})));
}
