# ClipMax AI backend (Cloud Run)

This service runs FFmpeg on the server and returns a ZIP containing consecutive 30-second MP4 clips.

## Deploy

Create a Google Cloud project, enable billing, and enable Cloud Run + Artifact Registry. Then, from the repository root:

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud run deploy clipmax-worker --source ./backend --region asia-south1 --allow-unauthenticated --memory 4Gi --cpu 4 --timeout 3600 --concurrency 1 --max-instances 2 --set-env-vars ALLOWED_ORIGINS=https://YOUR-FRONTEND.vercel.app
```

Copy the deployed service URL and set this Vercel environment variable:

```
VITE_CLIPMAX_API_URL=https://YOUR-CLOUD-RUN-SERVICE-URL
```

Redeploy the frontend after setting the variable.

## API

- `GET /health`
- `POST /api/clips` as multipart form data: `video` (MP4/MOV/WebM/MKV/AVI) and optional `ratio` (`original`, `9:16`, `16:9`, `1:1`).
- Response: `application/zip` with clips named `clipmax-part-001.mp4`, etc.

## Important deployment limits

Cloud Run's normal HTTP request size limit is 32 MiB. This first version therefore suits small test videos, not large long-form uploads. For larger videos, add a Google Cloud Storage resumable-upload flow and have the worker process the stored object. The service currently accepts an uploaded video file; it does not fetch YouTube/Instagram/TikTok share URLs. Use only videos you own or are authorised to process. Add authentication and quotas before public production use.
