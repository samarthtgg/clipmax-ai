import express from "express";
import cors from "cors";
import multer from "multer";
import archiver from "archiver";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const app = express();
const port = Number(process.env.PORT || 8080);
const maxBytes = Number(process.env.MAX_UPLOAD_MB || 1024) * 1024 * 1024;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
app.use(cors({ origin(origin, cb) { if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true); cb(new Error("Origin not allowed")); }}));
app.get("/health", (_req, res) => res.json({ ok: true, service: "clipmax-worker" }));

const upload = multer({ dest: tmpdir(), limits: { fileSize: maxBytes, files: 1 }, fileFilter: (_req, file, cb) => {
  const allowed = new Set(["video/mp4","video/quicktime","video/webm","video/x-matroska","video/x-msvideo"]);
  cb(allowed.has(file.mimetype) ? null : new Error("Upload an MP4, MOV, WebM, MKV or AVI video."), allowed.has(file.mimetype));
}});
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", chunk => { error = (error + chunk.toString()).slice(-6000); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(error || "FFmpeg processing failed.")));
  });
}
app.post("/api/clips", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "A video file is required." });
  const ratio = String(req.body.ratio || "original");
  const filters = {
    "9:16": "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    "16:9": "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
    "1:1": "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080"
  };
  if (ratio !== "original" && !filters[ratio]) { await rm(req.file.path, { force: true }); return res.status(400).json({ error: "Unsupported output ratio." }); }
  const work = await mkdtemp(path.join(tmpdir(), "clipmax-"));
  try {
    const input = path.join(work, "source");
    const output = path.join(work, "clips");
    await mkdir(output);
    const ext = path.extname(req.file.originalname).toLowerCase();
    await (await import("node:fs/promises")).copyFile(req.file.path, input + ([".mp4",".mov",".webm",".mkv",".avi"].includes(ext) ? ext : ".mp4"));
    const source = input + ([".mp4",".mov",".webm",".mkv",".avi"].includes(ext) ? ext : ".mp4");
    const probe = await new Promise((resolve, reject) => {
      const child = spawn("ffprobe", ["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",source]);
      let data = ""; child.stdout.on("data", x => data += x); child.on("error", reject); child.on("close", code => code === 0 ? resolve(Number(data.trim())) : reject(new Error("Could not read video duration.")));
    });
    if (!Number.isFinite(probe) || probe < 1) throw new Error("Could not read video duration.");
    const count = Math.ceil(probe / 30);
    if (count > 240) throw new Error("This job exceeds the 240-clip limit. Split the source into smaller jobs.");
    for (let i = 0; i < count; i++) {
      const start = i * 30;
      const duration = Math.min(30, probe - start);
      const name = "clipmax-part-" + String(i + 1).padStart(3, "0") + ".mp4";
      const args = ["-hide_banner","-loglevel","error","-y","-ss",String(start),"-i",source,"-t",String(duration),"-map","0:v:0","-map","0:a?"];
      if (filters[ratio]) args.push("-vf", filters[ratio]);
      args.push("-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-movflags","+faststart",path.join(output,name));
      await runFfmpeg(args);
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="clipmax-all-clips.zip"');
    const zip = archiver("zip", { zlib: { level: 1 } });
    zip.on("error", err => res.destroy(err));
    zip.pipe(res);
    for (const name of (await readdir(output)).sort()) zip.file(path.join(output,name), { name });
    await zip.finalize();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message || "Video processing failed." });
    else res.destroy(err);
  } finally {
    await rm(req.file.path, { force: true }).catch(() => {});
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
});
app.use((err, _req, res, _next) => res.status(err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.message || "Request failed." }));
app.listen(port, "0.0.0.0", () => console.log("ClipMax worker listening on " + port));
