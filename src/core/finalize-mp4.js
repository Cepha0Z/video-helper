import {
  Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, StreamTarget,
  EncodedPacketSink, EncodedVideoPacketSource, EncodedAudioPacketSource
} from 'mediabunny';

// Convert streaming fragments into a conventional MP4 with complete sample
// tables. Merely patching duration fields leaves some desktop players unable
// to locate the samples. Copy encoded packets: no quality loss or WebCodecs.
export async function finalizeMp4(file, writeAt, { signal, audioFile, onProgress = () => {} } = {}) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const audioInput = audioFile ? new Input({source:new BlobSource(audioFile),formats:ALL_FORMATS}) : input;
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(new WritableStream({
      async write({ data, position }) { signal?.throwIfAborted(); await writeAt(data, position); }
    }), { chunked: true, chunkSize: 1024 * 1024 })
  });
  try {
    signal?.throwIfAborted();
    const tracks = [];
    const video = await input.getPrimaryVideoTrack();
    const audio = await audioInput.getPrimaryAudioTrack();
    for (const [track, Source, add] of [
      [video, EncodedVideoPacketSource, source => output.addVideoTrack(source)],
      [audio, EncodedAudioPacketSource, source => output.addAudioTrack(source)]
    ]) {
      if (!track) continue;
      const codec = await track.getCodec();
      const config = await track.getDecoderConfig();
      if (!codec || !config) throw new Error('The video has incomplete codec information.');
      const source = new Source(codec);
      add(source);
      tracks.push({ track, source, config });
    }
    if (!tracks.length) throw new Error('No audio or video tracks were found to finalize.');
    await output.start();
    await Promise.all(tracks.map(async ({ track, source, config }) => {
      let count = 0;
      try {
        for await (const packet of new EncodedPacketSink(track).packets()) {
          signal?.throwIfAborted();
          await source.add(packet, count++ === 0 ? { decoderConfig: config } : undefined);
          if (count % 200 === 0) onProgress(packet.timestamp);
        }
        if (!count) throw new Error('A media track has no playable samples.');
      } finally { source.close(); }
    }));
    signal?.throwIfAborted();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally { input.dispose(); if(audioInput!==input) audioInput.dispose(); }
}
