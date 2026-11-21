# Video Helper 0.3

A Manifest V3 video downloader for Brave and Chrome. The toolbar popup shows media from the current page, with titles, thumbnails, duration, quality selection, filename editing, and download controls. Downloads run in a hidden offscreen document; there is no workspace tab.

## Use

1. Open a video page and briefly play the video if it has not loaded yet.
2. Click the pinned Video Helper icon.
3. Choose a quality and click **Download**, or use **Download all** when the page has multiple media items.
4. Switch tabs or move to the next episode. Existing jobs continue; the popup detects media from the newly selected page.
5. Use **Downloads** to view progress, cancel individual jobs, or show a saved file in its folder.

Three jobs can run concurrently; additional jobs queue automatically. The popup can close at any time. Browser save prompts still follow browser preferences. Keep Brave running; browser/extension restart resume is not implemented.

For a manual scan, use the refresh icon. Use **Enable all websites** to allow media discovery across websites and their CDNs. This is optional broad host access; without it, the original course site and local fixtures remain enabled. Individual missing media origins can also be granted from the error notice. Poster images or a frame from the player supply thumbnails where browser permissions and video CORS settings permit.

## Install / develop

```sh
npm ci
npm test
npm run build
```

Open `brave://extensions`, enable Developer mode, click **Load unpacked**, and select this project's `dist/` folder. Pin Video Helper. After changing code, rebuild and reload the extension; do not reload it during active downloads.

## Supported

- Direct media files, unencrypted HLS, and supported static DASH video on demand.
- Separate audio/video merging for HLS and DASH.
- YouTube SABR support using the current page’s format metadata and observed playback request; H.264/AAC only.
- Network detection through URL and MIME type, including Fetch/XHR.
- Automatic discovery, cached-resource rescanning, and navigation-aware page metadata.
- HLS quality variants grouped into one media card.
- H.264/AAC MPEG-TS and single-playlist fragmented MP4 input.
- Finalized MP4 output with complete sample tables. H.264/AAC are copied without re-encoding; incompatible DASH codecs such as Instagram VP9 are converted locally to H.264 using browser WebCodecs.
- Bounded segment concurrency, ordered output, retries, cancellation, independent job progress, and temporary disk storage.

Not implemented: live recording, encrypted streams/DRM, subtitles, discontinuities, multiple DASH periods, browser restart resume, general-purpose transcoding, and Firefox packaging. YouTube support depends on the current playback session; expired URLs or rejected playback attestation require playing and scanning the video again. Detection does not guarantee every site's download compatibility.

## Background request handling

Each job snapshots its source URL, title, thumbnail, selected quality, and observed Origin/Referer context. Downloads do not execute fetches inside the original page, so changing or closing that page does not remove their execution context.

Session-only declarative request rules preserve Origin/Referer on the extension's own requests, limited to the relevant media directories and already-enabled hosts. Rules are reference-counted across jobs and removed when jobs finish or cancel. Conflicting contexts are rejected rather than changing another job's requests. Cookies remain in the browser and are included subject to browser cookie policy; cookies and Authorization values are not exported or stored. For YouTube SABR, only the observed media playback configuration, client version, and playback proof token are retained in browser session storage; no arbitrary POST bodies are retained. Job playback metadata is discarded when a job finishes.

The offscreen document owns the queue, request controllers, local OPFS files, MP4 finalization, and output Blob URLs. The service worker handles detection, session state, permissions, request rules, and browser file saves. Closing the popup or navigating the source tab does not cancel jobs. A service worker restart can reconnect to the existing offscreen document.

Default host access: `100xdevs.com`, `transcoded-video.b-cdn.net`, `localhost`, and `127.0.0.1`. Other hosts are optional. There is no analytics, remote processing, remote code loading, or automatic course crawling. Session state contains local media URLs and thumbnails; URL query strings are not shown in the popup.

## Verification

```sh
npm test
npm run test:media
npm run fixture
```

The fixture runs at `http://127.0.0.1:4173`. Click **Load HLS request history** to expose the manifests. The popup should show a direct file and one HLS card with 360p/180p options. Use **Download all** to test two independent saves.

Media integration tests generate short H.264/AAC streams, download and finalize them, check populated MP4 sample tables, fully decode the results with FFmpeg, and verify cleanup/cancellation. FFmpeg is a development dependency and is not shipped in the extension.

On macOS, `scripts/verify-apple.swift` checks native AVFoundation decoding at the beginning, middle, and end. Compile with `swiftc -parse-as-library scripts/verify-apple.swift -o /tmp/verify-apple`, then run `/tmp/verify-apple video.mp4`. Native decoding needs normal OS access; sandbox restrictions can block VideoToolbox.

### Version 0.3 verification status

Local checks: static DASH parsing/rejection, SABR format selection, separate DASH audio/video downloads, MP4 merging, complete-duration validation, full FFmpeg decoding, and temporary-file cleanup. Real-site tests completed in Brave on November 20–21, 2026, with broad website access explicitly enabled:

| Site | Verified saved output | Playback checks |
| --- | --- | --- |
| YouTube | User’s `QcuoOgv2LI0`, 29:28, 640×360 H.264 + AAC from SABR | Full FFmpeg decode; native Apple decoding at start/middle/end |
| Reddit | `r/aww/comments/1t3tdkg`, 59 seconds, packaged MP4 | Full FFmpeg decode; native Apple decoding at start/middle/end |
| X | NASA post `2123435938848067841`, 36 seconds, 1280×720 H.264 + AAC from HLS with separate audio | Full FFmpeg decode; native Apple decoding at start/middle/end |
| Instagram | Reel `Df3Rp0bKNdr`, 15.6 seconds, 1080×1920 H.264 converted locally from VP9 DASH | Full FFmpeg decode; native Apple decoding at start/middle/end |

The Instagram test reel’s manifest declares video only, so its output is silent. A first VP9-in-MP4 output failed native Apple playback; the compatibility conversion fixed this, and the incompatible intermediate was moved into `.test-output/`. Instagram manifests are read from the visible player’s React props with bounded traversal; getters and React owner/state references are skipped. Only media manifests and metadata leave that collector.

YouTube continued downloading while the active tab changed to Reddit. The popup groups Instagram’s visible reel and suppresses X file fragments when an HLS variant of the same asset exists. Browser save dialogs follow the user’s existing download preferences.

All 36 automated checks and four media integration cases pass. These are specific tested examples, not a guarantee for every video on each platform. No universal site compatibility is claimed.

### Version 0.2 verified in Brave on November 20, 2026

- Popup displayed the actual lesson thumbnail, title, duration, and quality choices.
- Started a Week 2 download, closed the popup, moved to Week 3, detected its media, and started it concurrently.
- Both lesson jobs progressed after navigation. Cancelling Week 3 left Week 2 running; both test jobs were then cancelled and temporary files cleaned up.
- **Download all** saved the direct and HLS synthetic clips. Both outputs passed Apple's native decoder at the start, middle, and end.
- All 28 unit checks and three media integration cases passed.

Version 0.1.0 wrote streaming fragments that FFmpeg accepted but QuickTime could not play. Version 0.1.1 added proper MP4 finalization, preserved here. Existing 0.1.0 files can be repaired without downloading again:

```sh
node scripts/repair-mp4.mjs old-video.mp4 repaired-video.mp4
```

## Source layout

| File | Purpose |
| --- | --- |
| `src/popup.js` | Compact media and downloads UI |
| `src/background.js` | Discovery, state, rules, browser saves |
| `src/engine.js` | Offscreen queue and independent downloads |
| `src/watch.js`, `src/collect.js` | Automatic discovery, metadata, thumbnails |
| `src/core/job-queue.js`, `src/core/contexts.js` | Concurrency and request-context isolation |
| `src/download.js`, `src/core/` | HLS parsing, segment fetching, MP4 processing |
| `src/storage.js` | Temporary disk storage |

Independent implementation; no proprietary DownloadHelper extension code was copied. Media libraries: [GoogleVideo](https://github.com/LuanRT/googlevideo), [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser), [mux.js](https://github.com/videojs/mux.js) and [Mediabunny](https://mediabunny.dev/). Dependency license notices ship in `dist/licenses/`.
