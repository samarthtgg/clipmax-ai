# ClipMax AI

A free-first, local-first creator workspace. The browser app keeps source media on the user's device and uses open-source tooling rather than paid AI APIs.

## Features in this release

- **Video cutter:** import a local video, preview it, choose start/end times, and export MP4 with FFmpeg WebAssembly.
- **Aspect-ratio presets:** original, vertical 9:16, square 1:1, and landscape 16:9.
- **Highlight suggestions:** scan sampled video frames in-browser and suggest moments around visual scene changes. This is a heuristic, not semantic AI.
- **Smart captions:** extract audio locally and run the free Whisper Tiny speech-recognition model in the browser; edit subtitle segments and export SRT.
- **Screen/tab recording:** use the browser's display-capture permission and MediaRecorder, preview the WEBM recording, download it, or send it to the cutter.
- **Responsive studio UI:** desktop and mobile navigation for each workspace tool.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

Vercel settings: framework Vite, build command `npm run build`, output directory `dist`.

## Local processing and free-use notes

- Video files are processed in the browser using FFmpeg WebAssembly. The app does not upload them to a ClipMax backend.
- Whisper Tiny model files are downloaded from Hugging Face on first use, then inference runs in the browser. The initial model download needs internet; browser memory and CPU/GPU capability affect performance.
- FFmpeg's WebAssembly runtime is fetched from the public unpkg CDN on first use.
- Large video files may exceed available browser memory. The app currently limits source files to 1 GB, but practical limits are usually lower on phones.
- No paid APIs, subscriptions, or API keys are required by the current app. Public model/CDN hosting is used for downloads.

## Honest feature boundaries

- Highlight suggestions currently use frame-to-frame visual-change scoring. They are not a trained semantic highlight model.
- Screen recording uses browser display capture. It is not a server-side RTMP ingest service.
- YouTube, Twitch, and Instagram URLs are not treated as downloadable files. Any future integrations must use official, authorized APIs and follow each platform's terms and permissions.
- A reliable public RTMP ingest pipeline and optional cloud worker need separately deployed streaming/processing infrastructure. They are not included in this browser-only release.

## Roadmap

- Better scene and audio-aware highlight ranking
- Subtitle styling and burned-in caption export
- Multi-clip timeline, transitions, and audio controls
- Official creator-account integrations where platform APIs permit
- Optional self-hosted worker for users who operate their own infrastructure

## Privacy

ClipMax does not have a media-upload backend in this version. Media processing runs on-device. The app loads FFmpeg runtime assets and the optional Whisper model from public CDNs/model hosting; those requests download code/model assets, not the user's source video.
