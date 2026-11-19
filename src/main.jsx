import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import {
  Aperture, ArrowDownToLine, Check, Clapperboard, Film, FolderOpen,
  Gauge, LoaderCircle, LockKeyhole, Pause, Play, Scissors, Sparkles,
  Upload, WandSparkles, X
} from 'lucide-react';
import './style.css';

const CORE_VERSION = '0.12.10';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

function formatTime(value = 0) {
  if (!Number.isFinite(value)) return '00:00';
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? [hours, minutes, seconds].map(v => String(v).padStart(2, '0')).join(':') : [minutes, seconds].map(v => String(v).padStart(2, '0')).join(':');
}

function App() {
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Ready when you are');
  const [error, setError] = useState('');
  const [outputUrl, setOutputUrl] = useState('');
  const [outputName, setOutputName] = useState('');
  const [engineReady, setEngineReady] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const ffmpegRef = useRef(null);

  useEffect(() => {
    if (!videoUrl) return;
    return () => URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    if (!outputUrl) return;
    return () => URL.revokeObjectURL(outputUrl);
  }, [outputUrl]);

  function chooseFile(nextFile) {
    setError('');
    setOutputUrl('');
    setOutputName('');
    if (!nextFile) return;
    if (!nextFile.type.startsWith('video/')) {
      setError('Please choose a video file.');
      return;
    }
    if (nextFile.size > 1024 * 1024 * 1024) {
      setError('This first version supports files up to 1 GB. Try a shorter or smaller video.');
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(nextFile);
    setFile(nextFile);
    setVideoUrl(url);
    setDuration(0);
    setStart('0');
    setEnd('');
    setStatus('Video ready to edit');
  }

  async function loadEngine() {
    if (ffmpegRef.current?.loaded) return ffmpegRef.current;
    setEngineLoading(true);
    setError('');
    setStatus('Preparing the local video engine…');
    try {
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress: value }) => setProgress(Math.max(0, Math.min(100, Math.round(value * 100)))));
      ffmpeg.on('log', ({ message }) => {
        if (message?.includes('frame=')) setStatus('Processing your clip…');
      });
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm')
      });
      ffmpegRef.current = ffmpeg;
      setEngineReady(true);
      setStatus('Local engine ready');
      return ffmpeg;
    } catch (e) {
      throw new Error('Could not load the free video engine. Check your internet connection and try again.');
    } finally {
      setEngineLoading(false);
    }
  }

  async function makeClip() {
    if (!file) return;
    const from = Number(start);
    const to = Number(end || duration);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > duration) {
      setError('Enter a valid start and end time within your video.');
      return;
    }
    setLoading(true);
    setProgress(0);
    setError('');
    setOutputUrl('');
    try {
      const ffmpeg = await loadEngine();
      setStatus('Reading your video locally…');
      const inputExt = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
      const inputName = `source.${inputExt}`;
      const outputFile = 'clipmax-export.mp4';
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      setStatus('Cutting and exporting your clip…');
      await ffmpeg.exec([
        '-ss', String(from), '-i', inputName, '-t', String(to - from),
        '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264',
        '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac',
        '-movflags', '+faststart', outputFile
      ]);
      const data = await ffmpeg.readFile(outputFile);
      const blob = new Blob([data], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setOutputName(`${file.name.replace(/\.[^.]+$/, '')}-clip.mp4`);
      setStatus('Your clip is ready');
      await ffmpeg.deleteFile(inputName).catch(() => {});
      await ffmpeg.deleteFile(outputFile).catch(() => {});
    } catch (e) {
      setError(e.message || 'Something went wrong while exporting. Try another video format.');
      setStatus('Export did not finish');
    } finally {
      setLoading(false);
    }
  }

  function seekTo(value) {
    const time = Number(value);
    if (videoRef.current && Number.isFinite(time)) videoRef.current.currentTime = time;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#"><span className="brand-mark"><Aperture size={21}/></span><span>clipmax<span className="brand-ai">.ai</span></span></a>
        <div className="side-label">WORKSPACE</div>
        <button className="nav-item active"><Scissors size={17}/> Video cutter <span className="nav-dot"/></button>
        <div className="side-label tools-label">YOUR TOOLS</div>
        <div className="nav-item muted"><Sparkles size={17}/> AI highlights <span className="soon">SOON</span></div>
        <div className="nav-item muted"><WandSparkles size={17}/> Smart captions <span className="soon">SOON</span></div>
        <div className="nav-item muted"><Film size={17}/> Clip editor <span className="soon">SOON</span></div>
        <div className="sidebar-bottom">
          <div className="privacy-card"><LockKeyhole size={17}/><div><strong>Your videos stay yours</strong><p>Files are processed in your browser. Nothing is uploaded to our servers.</p></div></div>
          <div className="version">CLIPMAX AI <span>v1.0 · LOCAL BETA</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> Video cutter</div><div className="top-right"><span className="free-pill"><span/> FREE FOREVER</span><div className="avatar">C</div></div></header>
        <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> YOUR CREATIVE WORKSPACE</div><h1>Make every moment <span>count.</span></h1><p>Turn your videos into share-ready clips. No subscriptions. No uploads. Just create.</p></div><div className="heading-spark"><Sparkles size={25}/></div></section>

        <section className="steps">
          <div className="step active-step"><span>01</span><div><b>Import</b><small>Choose a video</small></div></div><div className="step-line"/>
          <div className={file ? 'step active-step' : 'step'}><span>02</span><div><b>Trim</b><small>Pick your moment</small></div></div><div className="step-line"/>
          <div className={outputUrl ? 'step active-step' : 'step'}><span>03</span><div><b>Export</b><small>Save your clip</small></div></div>
        </section>

        <section className="workspace-grid">
          <div className="editor-card">
            <div className="card-head"><div><div className="card-kicker">01 — SOURCE VIDEO</div><h2>Bring your video</h2></div>{file && <button className="change-file" onClick={() => inputRef.current?.click()}><FolderOpen size={15}/> Change</button>}</div>
            <input ref={inputRef} className="hidden-input" type="file" accept="video/*" onChange={e => chooseFile(e.target.files?.[0])}/>
            {!file ? <button className="dropzone" onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => {e.preventDefault();chooseFile(e.dataTransfer.files?.[0]);}}><span className="upload-icon"><Upload size={23}/></span><strong>Drop your video here</strong><span>or <u>browse files</u> from your device</span><small>MP4, MOV, WEBM and more · Up to 1 GB</small></button> :
              <div className="video-wrap"><video ref={videoRef} src={videoUrl} controls onLoadedMetadata={e => {setDuration(e.currentTarget.duration);setEnd(String(Math.floor(e.currentTarget.duration)));}} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}/><div className="video-meta"><span><Film size={14}/>{file.name}</span><span>{formatTime(duration)} · {(file.size / (1024*1024)).toFixed(1)} MB</span></div></div>}
            <div className="privacy-note"><LockKeyhole size={14}/> <span><b>100% local processing.</b> Your original video never leaves your device.</span></div>
          </div>

          <div className="editor-card trim-card">
            <div className="card-head"><div><div className="card-kicker">02 — MAKE IT YOURS</div><h2>Trim your moment</h2></div><span className="tiny-chip"><Scissors size={12}/> PRECISE CUT</span></div>
            <div className="trim-preview"><div className="trim-track"><div className="track-fill" style={{left: duration ? `${Math.max(0,Number(start))/duration*100}%` : '0%', right: duration ? `${100-Math.min(100,Number(end||duration)/duration*100)}%` : '0%'}}/><span className="track-start"/><span className="track-end"/></div><div className="track-labels"><span>START · {formatTime(Number(start))}</span><span>END · {formatTime(Number(end || duration))}</span></div></div>
            <div className="time-fields"><label><span>START TIME</span><div><input type="number" min="0" step="0.1" value={start} disabled={!file || loading} onChange={e => {setStart(e.target.value);seekTo(e.target.value);}}/><small>sec</small></div></label><span className="time-divider">→</span><label><span>END TIME</span><div><input type="number" min="0" step="0.1" value={end} disabled={!file || loading} onChange={e => {setEnd(e.target.value);seekTo(e.target.value);}}/><small>sec</small></div></label></div>
            <div className="duration-row"><span>CLIP LENGTH</span><b>{formatTime(Math.max(0,Number(end||duration)-Number(start)))}</b></div>
            <button className="export-button" disabled={!file || loading || !duration} onClick={makeClip}>{loading ? <><LoaderCircle className="spin" size={17}/> Processing…</> : <><Scissors size={17}/> Create my clip <ArrowDownToLine size={16}/></>}</button>
            {loading && <div className="progress-area"><div className="progress-label"><span>{status}</span><b>{progress}%</b></div><div className="progress-bar"><span style={{width:`${progress}%`}}/></div></div>}
            {!loading && <p className="engine-note"><Gauge size={14}/>{engineReady ? 'Local engine is ready' : 'Free browser-based video engine'}</p>}
          </div>
        </section>

        {error && <div className="alert"><X size={17}/>{error}</div>}
        {outputUrl && <section className="result-card"><div className="result-icon"><Check size={20}/></div><div className="result-copy"><strong>Your clip is ready!</strong><span>{outputName} · MP4 video</span></div><a className="download-button" href={outputUrl} download={outputName}><ArrowDownToLine size={16}/> Download clip</a></section>}

        <section className="bottom-row"><div className="feature-note"><span><LockKeyhole size={16}/></span><div><b>Private by design</b><p>Editing happens on your device, not on a remote server.</p></div></div><div className="feature-note"><span><Sparkles size={16}/></span><div><b>AI tools are coming</b><p>Highlights and captions are planned for future releases.</p></div></div></section>
        <footer><span>© 2026 CLIPMAX AI</span><span>MADE FOR CREATORS <span className="footer-star">✦</span></span></footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
