# ClipMax AI

A free-first, local-first video clipping workspace. The first release focuses on a practical browser-based cutter: choose a video, set start/end times, and export an MP4 clip.

## Current features

- Local video selection (the source file is not uploaded to an application server)
- Video preview and duration detection
- Start/end time trimming
- MP4 export powered by FFmpeg WebAssembly
- Download the finished clip to your device
- Responsive desktop and mobile interface

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Production build

```bash
npm run build
npm run preview
```

The production site is a static Vite app and can be deployed to Vercel with the default Vite framework preset and build command `npm run build`, output directory `dist`.

## Privacy and processing

The selected video is read by the browser and processed with FFmpeg WebAssembly. The app does not send video files to a ClipMax backend. The FFmpeg engine is downloaded from the public unpkg CDN on first use, so an internet connection is needed to initialize it. Once loaded, video processing runs locally in the browser.

Large videos can use substantial device memory and processing time. This initial release limits input files to 1 GB; actual practical limits depend on the device and browser.

## Roadmap

- Local transcription and subtitle generation
- AI-assisted highlight suggestions
- Timeline editing and aspect-ratio presets
- Authorized integrations for creator-owned media
- Optional self-hosted processing workers

## Important source-access note

A public video URL is not automatically a downloadable media file. Integrations must use official APIs and respect each platform's permissions and terms. Live RTMP ingestion requires a server-side streaming component; it cannot be done by a browser-only page.

## Cost promise

ClipMax is designed to run without paid APIs, subscriptions, or hidden billing. This version uses open-source browser tooling and a public CDN for the FFmpeg runtime.
