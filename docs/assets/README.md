# Real extension captures

These assets show the actual Video Helper 0.3 popup in Brave, detecting and saving the public NASA/Chandra video on X at `https://x.com/NASA/status/2123435938848067841`.

- `hero.png`: cropped screenshot of the live media card.
- `saved.png`: cropped screenshot of the successful saved-file result.
- `live-window.mp4`: actual captured popup frames, resampled to a consistent frame rate and cut to the relevant actions. No replacement UI is drawn.
- `workflow.mp4`: the same real captures with eased zooms toward the cursor’s quality-picker and Download-button clicks, plus short captions.
- `workflow.gif`: looping preview for GitHub’s README.
- `workflow.png`: preview still from the edited video.

The demo is silent. Setup, waiting, the save dialog, unrelated history, and account details are omitted. The successful take used 720p and saved a 36-second H.264/AAC MP4. The final UI states are not fabricated.

Original recordings and uncropped captures stay outside Git. Only the privacy-cropped extension-window captures are published.

Regenerate the edit with `npm run docs:assets`. To import a new direct capture, pass `--capture-dir /path/to/captures` with the frame sequence and `capture-log.json` generated during capture. Review every crop before publishing.
