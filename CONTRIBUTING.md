# Contributing

Start with `npm ci`, `npm test`, and `npm run build`. Load `dist/` as an unpacked extension in Brave or Chrome. Use `npm run fixture` for synthetic media and `npm run test:media` for decoding and cleanup checks.

For a site compatibility issue, include the site, browser version, extension version, stream type if known, and what failed: detection, download, audio, seeking, or playback. A public, authorized-to-test example is ideal.

Do not attach cookies, authorization headers, signed media URLs, playback tokens, private course content, or unredacted account screenshots. Redact these from logs before posting.

Changes to detection or media handling should include a focused regression test and, when possible, a generated fixture. Verify the saved file’s video, audio, duration, seeking, cancellation, and temporary-file cleanup. A detector returning a URL is not enough to claim that a site works.

README visuals are generated from synthetic media using `npm run docs:assets`; they must remain labeled as illustrations rather than live download recordings.
