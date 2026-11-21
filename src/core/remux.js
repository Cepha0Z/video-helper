import muxjs from 'mux.js';
import { setMp4Duration } from './mp4.js';

export class TsRemuxer {
  constructor({ duration } = {}) {
    this.transmuxer = new muxjs.mp4.Transmuxer({ remux: true, keepOriginalTimestamps: false });
    this.initialized = false;
    this.output = [];
    this.transmuxer.on('data', segment => {
      if (segment.type !== 'combined' && segment.type !== 'video' && segment.type !== 'audio') throw new Error('Unsupported MPEG-TS tracks.');
      if (!this.initialized) {
        this.output.push(duration ? setMp4Duration(segment.initSegment, duration) : segment.initSegment);
        this.initialized = true;
      }
      this.output.push(segment.data);
    });
  }
  push(bytes) {
    if (bytes[0] !== 0x47) throw new Error('Expected an MPEG-TS segment. This media format is not supported yet.');
    this.output = [];
    this.transmuxer.push(bytes);
    this.transmuxer.flush();
    if (!this.output.length) throw new Error('No supported audio/video was found. This version supports H.264/AAC MPEG-TS.');
    return this.output;
  }
  dispose() { this.transmuxer.dispose(); }
}
