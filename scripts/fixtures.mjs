import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
export const fixtureDirectory = path.resolve('.test-output/fixture');

export async function generateFixtures() {
  const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
  chmodSync(ffmpeg, 0o755);
  chmodSync(require('@ffprobe-installer/ffprobe').path, 0o755);
  await mkdir(fixtureDirectory, { recursive: true });
  for (const [width, height, name] of [[320,180,'180p'], [640,360,'360p']]) {
    await mkdir(path.join(fixtureDirectory, name), { recursive: true });
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f','lavfi','-i',`testsrc2=size=${width}x${height}:rate=24`,
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
      '-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','48','-sc_threshold','0',
      '-c:a','aac','-b:a','64k','-f','hls','-hls_time','2','-hls_playlist_type','vod',
      '-hls_segment_filename',path.join(fixtureDirectory,name,'segment-%03d.ts'),
      path.join(fixtureDirectory,name,'playlist.m3u8')], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Fixture generation failed: ${result.stderr || result.error}`);
  }
  // Both the folder name and label intentionally differ from the actual height,
  // matching the resolution metadata issue observed on the lesson site.
  await writeFile(path.join(fixtureDirectory,'master.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=320x180\n180p/playlist.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360\n360p/playlist.m3u8\n');
  const mp4 = spawnSync(ffmpeg, ['-hide_banner','-loglevel','error','-y','-i',path.join(fixtureDirectory,'360p/playlist.m3u8'),'-c','copy',path.join(fixtureDirectory,'direct.mp4')], { encoding:'utf8' });
  if (mp4.status !== 0) throw new Error(mp4.stderr || String(mp4.error));
  await mkdir(path.join(fixtureDirectory,'fmp4'),{recursive:true});
  const fragmented = spawnSync(ffmpeg, ['-hide_banner','-loglevel','error','-y','-i',path.join(fixtureDirectory,'direct.mp4'),
    '-c','copy','-f','hls','-hls_time','2','-hls_playlist_type','vod','-hls_segment_type','fmp4',
    '-hls_fmp4_init_filename','init.mp4','-hls_segment_filename',path.join(fixtureDirectory,'fmp4/segment-%03d.m4s'),
    path.join(fixtureDirectory,'fmp4/playlist.m3u8')],{encoding:'utf8'});
  if (fragmented.status !== 0) throw new Error(fragmented.stderr || String(fragmented.error));
  return fixtureDirectory;
}

export async function fixtureText(name) { return readFile(path.join(fixtureDirectory, name), 'utf8'); }
