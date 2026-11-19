import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import {
  Aperture, ArrowDownToLine, Captions, Check, Clapperboard, Film,
  FolderOpen, Gauge, LoaderCircle, LockKeyhole, MonitorUp, Pause,
  Play, Scissors, Sparkles, Upload, WandSparkles, X, Video,
  Download, Crop, Mic2, Radio, RefreshCw, Plus, Trash2, FileText
} from 'lucide-react';
import './style.css';

const CORE_VERSION = '0.12.10';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;
const MODEL_ID = 'onnx-community/whisper-tiny';

function formatTime(value = 0) {
  if (!Number.isFinite(value)) return '00:00';
  const total = Math.max(0, Math.floor(value));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? [h,m,s].map(v => String(v).padStart(2,'0')).join(':') : [m,s].map(v => String(v).padStart(2,'0')).join(':');
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function makeSrt(items) {
  return items.map((c,i) => `${i+1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}\n`).join('\n');
}
function formatSrtTime(t) {
  const ms = Math.max(0, Math.round(t*1000));
  const h = Math.floor(ms/3600000), m = Math.floor(ms%3600000/60000), s = Math.floor(ms%60000/1000), milli = ms%1000;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(milli).padStart(3,'0')}`;
}
function parseSrt(text) {
  const blocks = text.replace(/\r/g,'').trim().split(/\n\s*\n/);
  return blocks.map((block,i) => {
    const lines = block.split('\n');
    const time = lines.find(x => x.includes('-->'));
    if (!time) return null;
    const [a,b] = time.split('-->').map(x => x.trim());
    const toSeconds = x => { const p=x.replace(',','.').split(':').map(Number); return p[0]*3600+p[1]*60+p[2]; };
    return {id:Date.now()+i,start:toSeconds(a),end:toSeconds(b),text:lines.slice(lines.indexOf(time)+1).join(' ').trim()};
  }).filter(Boolean);
}
function App() {
  const [tab,setTab] = useState('cutter');
  const [file,setFile] = useState(null), [videoUrl,setVideoUrl] = useState('');
  const [duration,setDuration] = useState(0), [start,setStart] = useState('0'), [end,setEnd] = useState('');
  const [busy,setBusy] = useState(false), [progress,setProgress] = useState(0), [status,setStatus] = useState('Ready when you are');
  const [error,setError] = useState(''), [outputUrl,setOutputUrl] = useState(''), [outputName,setOutputName] = useState('');
  const [engineReady,setEngineReady] = useState(false), [ratio,setRatio] = useState('original');
  const [highlights,setHighlights] = useState([]), [captions,setCaptions] = useState([]);
  const [transcribing,setTranscribing] = useState(false), [modelProgress,setModelProgress] = useState('');
  const [recording,setRecording] = useState(false), [recordSeconds,setRecordSeconds] = useState(0);
  const [recordedUrl,setRecordedUrl] = useState('');
  const inputRef=useRef(null), videoRef=useRef(null), analysisVideoRef=useRef(null), ffmpegRef=useRef(null), asrRef=useRef(null);
  const mediaRecorderRef=useRef(null), streamRef=useRef(null), chunksRef=useRef([]);

  useEffect(()=>{ if(!videoUrl)return; return ()=>URL.revokeObjectURL(videoUrl); },[videoUrl]);
  useEffect(()=>{ if(!outputUrl)return; return ()=>URL.revokeObjectURL(outputUrl); },[outputUrl]);
  useEffect(()=>{ if(!recordedUrl)return; return ()=>URL.revokeObjectURL(recordedUrl); },[recordedUrl]);

  function chooseFile(f) {
    setError(''); setOutputUrl(''); setHighlights([]); setCaptions([]);
    if(!f)return;
    if(!f.type.startsWith('video/')) {setError('Choose a video file.');return;}
    if(f.size>1024*1024*1024){setError('This browser version supports files up to 1 GB.');return;}
    setFile(f); setVideoUrl(URL.createObjectURL(f)); setDuration(0); setStart('0'); setEnd('');
    setStatus('Video ready to edit'); setTab('cutter');
  }
  async function loadEngine() {
    if(ffmpegRef.current?.loaded)return ffmpegRef.current;
    setStatus('Loading local video engine…');
    const ff=new FFmpeg();
    ff.on('progress',({progress:p})=>setProgress(Math.max(0,Math.min(100,Math.round(p*100)))));
    ff.on('log',({message})=>{if(message?.includes('frame='))setStatus('Processing video locally…');});
    await ff.load({
      coreURL:await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`,'text/javascript'),
      wasmURL:await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`,'application/wasm')
    });
    ffmpegRef.current=ff; setEngineReady(true); return ff;
  }
  async function exportClip(from=Number(start),to=Number(end||duration)) {
    if(!file)return;
    if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from||to>duration){setError('Choose a valid time range inside your video.');return;}
    setBusy(true);setProgress(0);setError('');setOutputUrl('');
    let ff,inputName,outputFile='clipmax-export.mp4';
    try {
      ff=await loadEngine();
      const ext=(file.name.split('.').pop()||'mp4').toLowerCase().replace(/[^a-z0-9]/g,'')||'mp4';
      inputName=`clipmax-source.${ext}`;
      await ff.writeFile(inputName,await fetchFile(file));
      const filters=[];
      if(ratio==='9:16')filters.push('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
      if(ratio==='1:1')filters.push('scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080');
      if(ratio==='16:9')filters.push('scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080');
      const args=['-ss',String(from),'-i',inputName,'-t',String(to-from),'-map','0:v:0','-map','0:a?'];
      if(filters.length)args.push('-vf',filters.join(','));
      args.push('-c:v','libx264','-preset','ultrafast','-crf','23','-c:a','aac','-movflags','+faststart',outputFile);
      setStatus('Exporting your clip…'); await ff.exec(args);
      const data=await ff.readFile(outputFile);
      setOutputUrl(URL.createObjectURL(new Blob([data],{type:'video/mp4'})));
      setOutputName(`${file.name.replace(/\.[^.]+$/,'')}-clip.mp4`);
      setStatus('Your clip is ready');
    } catch(e){setError(e.message||'Export failed. Try a shorter or smaller video.');setStatus('Export did not finish');}
    finally {if(ff&&inputName)await ff.deleteFile(inputName).catch(()=>{});if(ff)await ff.deleteFile(outputFile).catch(()=>{});setBusy(false);}
  }
  async function detectHighlights() {
    if(!file||!analysisVideoRef.current)return;
    setBusy(true);setError('');setStatus('Scanning video frames on this device…');
    try {
      const v=analysisVideoRef.current, canvas=document.createElement('canvas'), ctx=canvas.getContext('2d',{willReadFrequently:true});
      canvas.width=96;canvas.height=54;
      const step=Math.max(1,duration/90), samples=[];let previous=null;
      for(let t=0;t<duration;t+=step){
        if(Math.abs(v.currentTime-t)>0.05){v.currentTime=t;await new Promise(resolve=>{let settled=false;const done=()=>{if(settled)return;settled=true;v.removeEventListener('seeked',done);resolve();};v.addEventListener('seeked',done,{once:true});setTimeout(done,1200);});}
        ctx.drawImage(v,0,0,96,54);const pixels=ctx.getImageData(0,0,96,54).data;
        let diff=0;
        if(previous){for(let i=0;i<pixels.length;i+=16)diff+=Math.abs(pixels[i]-previous[i])+Math.abs(pixels[i+1]-previous[i+1])+Math.abs(pixels[i+2]-previous[i+2]);diff/=pixels.length/16;}
        samples.push({time:t,score:diff});previous=new Uint8ClampedArray(pixels);
      }
      const ranked=samples.filter(x=>x.time>2&&x.time<duration-2).sort((a,b)=>b.score-a.score);
      const picks=[];
      for(const s of ranked){if(picks.every(p=>Math.abs(p.time-s.time)>Math.max(8,duration*.08)))picks.push(s);if(picks.length===5)break;}
      setHighlights(picks.sort((a,b)=>a.time-b.time).map((p,i)=>({id:i+1,start:Math.max(0,p.time-7),end:Math.min(duration,p.time+8),score:Math.round(p.score)})));
      setStatus('Suggested moments ready'); if(!picks.length)setError('No clear scene changes found. Try a video with more visual activity.');
    }catch(e){setError('Could not scan this video in the current browser.');}
    finally{setBusy(false);}
  }
  async function transcribe() {
    if(!file)return;
    setTranscribing(true);setError('');setModelProgress('Preparing free Whisper model…');
    let ff,inputName;
    try {
      ff=await loadEngine();inputName='clipmax-audio.wav';
      await ff.writeFile('clipmax-input.mp4',await fetchFile(file));
      setModelProgress('Extracting audio locally…');
      await ff.exec(['-i','clipmax-input.mp4','-vn','-ac','1','-ar','16000','-f','wav',inputName]);
      const audio=await ff.readFile(inputName);
      const audioContext=new AudioContext({sampleRate:16000});
      const decoded=await audioContext.decodeAudioData(audio.buffer.slice(0));
      const samples=decoded.getChannelData(0);await audioContext.close();
      if(!asrRef.current){
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowLocalModels=false;
        asrRef.current=await pipeline('automatic-speech-recognition',MODEL_ID,{
          dtype:'q8',device:'wasm',
          progress_callback:p=>setModelProgress(p.status==='progress'? `Downloading speech model ${Math.round(p.progress||0)}%` : (p.status||'Loading speech model…'))
        });
      }
      setModelProgress('Transcribing on your device…');
      const result=await asrRef.current(samples,{sampling_rate:16000,chunk_length_s:25,stride_length_s:5,return_timestamps:true});
      const chunks=(result.chunks||[]).map((c,i)=>({id:Date.now()+i,start:c.timestamp?.[0]||0,end:c.timestamp?.[1]||Math.min(duration,(c.timestamp?.[0]||0)+3),text:(c.text||'').trim()})).filter(c=>c.text);
      if(!chunks.length&&result.text)chunks.push({id:Date.now(),start:0,end:duration,text:result.text.trim()});
      setCaptions(chunks);setModelProgress('Captions generated');setStatus('Local transcription complete');
    } catch(e){setError('Local transcription could not start. The first run needs internet to download the free Whisper model; try again on a supported browser with enough memory.');setModelProgress('Transcription unavailable');}
    finally{if(ff){await ff.deleteFile('clipmax-input.mp4').catch(()=>{});await ff.deleteFile('clipmax-audio.wav').catch(()=>{});}setTranscribing(false);}
  }
  function updateCaption(id,key,value){setCaptions(cs=>cs.map(c=>c.id===id?{...c,[key]:value}:c));}
  function addCaption(){setCaptions(cs=>[...cs,{id:Date.now(),start:0,end:3,text:'Your caption'}]);}
  async function startRecording(){
    try{
      const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
      streamRef.current=stream;chunksRef.current=[];
      const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')?'video/webm;codecs=vp9,opus':'video/webm';
      const recorder=new MediaRecorder(stream,{mimeType:mime});
      mediaRecorderRef.current=recorder;
      recorder.ondataavailable=e=>{if(e.data.size)chunksRef.current.push(e.data);};
      recorder.onstop=()=>{const blob=new Blob(chunksRef.current,{type:'video/webm'});setRecordedUrl(URL.createObjectURL(blob));stream.getTracks().forEach(t=>t.stop());setRecording(false);};
      recorder.start(1000);setRecording(true);setRecordSeconds(0);
      const started=Date.now();const tick=()=>{if(mediaRecorderRef.current?.state==='recording'){setRecordSeconds(Math.floor((Date.now()-started)/1000));setTimeout(tick,1000);}};tick();
    }catch(e){setError('Screen recording was cancelled or is not supported in this browser.');}
  }
  function stopRecording(){if(mediaRecorderRef.current?.state==='recording')mediaRecorderRef.current.stop();}
  function useRecording(){if(!recordedUrl)return;fetch(recordedUrl).then(r=>r.blob()).then(b=>chooseFile(new File([b],'clipmax-recording.webm',{type:'video/webm'})));setRecordedUrl('');}
  function seek(t){if(videoRef.current)videoRef.current.currentTime=t;}
  const nav=[['cutter','Video cutter',Scissors],['highlights','AI highlights',Sparkles],['captions','Smart captions',Captions],['studio','Live studio',Radio],['editor','Clip editor',Crop]];
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#"><span className="brand-mark"><Aperture size={21}/></span><span>clipmax<span className="brand-ai">.ai</span></span></a>
      <div className="side-label">WORKSPACE</div>
      {nav.map(([id,label,Icon])=><button key={id} className={`nav-item ${tab===id?'active':''}`} onClick={()=>setTab(id)}><Icon size={17}/>{label}{tab===id&&<span className="nav-dot"/>}</button>)}
      <div className="sidebar-bottom"><div className="privacy-card"><LockKeyhole size={17}/><div><strong>Your videos stay yours</strong><p>Video and audio analysis runs on your device. The speech model downloads from Hugging Face.</p></div></div><div className="version">CLIPMAX AI <span>v1.1 · LOCAL STUDIO</span></div></div>
    </aside>
    <main className="main-content">
      {videoUrl&&<video ref={analysisVideoRef} className="analysis-video" src={videoUrl} muted playsInline preload="auto"/>}
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> {nav.find(x=>x[0]===tab)?.[1]}</div><div className="top-right"><span className="free-pill"><span/> FREE-FIRST</span><div className="avatar">C</div></div></header>
      <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> YOUR CREATIVE WORKSPACE</div><h1>Make every moment <span>count.</span></h1><p>One local-first studio for clips, captions and creator workflows.</p></div><div className="heading-spark"><Sparkles size={25}/></div></section>
      {error&&<div className="alert"><X size={17}/>{error}<button onClick={()=>setError('')} aria-label="Dismiss"><X size={14}/></button></div>}
      {tab==='cutter'&&<><section className="steps"><div className="step active-step"><span>01</span><div><b>Import</b><small>Choose a video</small></div></div><div className="step-line"/><div className={file?'step active-step':'step'}><span>02</span><div><b>Trim</b><small>Pick your moment</small></div></div><div className="step-line"/><div className={outputUrl?'step active-step':'step'}><span>03</span><div><b>Export</b><small>Save your clip</small></div></div></section>
        <section className="workspace-grid"><div className="editor-card"><div className="card-head"><div><div className="card-kicker">01 — SOURCE VIDEO</div><h2>Bring your video</h2></div>{file&&<button className="change-file" onClick={()=>inputRef.current?.click()}><FolderOpen size={15}/> Change</button>}</div><input ref={inputRef} className="hidden-input" type="file" accept="video/*" onChange={e=>chooseFile(e.target.files?.[0])}/>{!file?<button className="dropzone" onClick={()=>inputRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();chooseFile(e.dataTransfer.files?.[0]);}}><span className="upload-icon"><Upload size={23}/></span><strong>Drop your video here</strong><span>or <u>browse files</u> from your device</span><small>MP4, MOV, WEBM · Up to 1 GB</small></button>:<div className="video-wrap"><video ref={videoRef} src={videoUrl} controls onLoadedMetadata={e=>{setDuration(e.currentTarget.duration);setEnd(String(Math.floor(e.currentTarget.duration)));}}/><div className="video-meta"><span><Film size={14}/>{file.name}</span><span>{formatTime(duration)} · {(file.size/1048576).toFixed(1)} MB</span></div></div>}<div className="privacy-note"><LockKeyhole size={14}/><span><b>Local processing.</b> Your selected video is not uploaded to ClipMax servers.</span></div></div>
        <div className="editor-card trim-card"><div className="card-head"><div><div className="card-kicker">02 — MAKE IT YOURS</div><h2>Trim your moment</h2></div><span className="tiny-chip"><Scissors size={12}/> PRECISE CUT</span></div><div className="trim-preview"><div className="trim-track"><div className="track-fill" style={{left:duration?`${Math.max(0,Number(start))/duration*100}%`:'0%',right:duration?`${100-Math.min(100,Number(end||duration)/duration*100)}%`:'0%'}}/><span className="track-start"/><span className="track-end"/></div><div className="track-labels"><span>START · {formatTime(Number(start))}</span><span>END · {formatTime(Number(end||duration))}</span></div></div><div className="time-fields"><label><span>START TIME</span><div><input type="number" min="0" step=".1" value={start} disabled={!file||busy} onChange={e=>{setStart(e.target.value);seek(e.target.value);}}/><small>sec</small></div></label><span className="time-divider">→</span><label><span>END TIME</span><div><input type="number" min="0" step=".1" value={end} disabled={!file||busy} onChange={e=>{setEnd(e.target.value);seek(e.target.value);}}/><small>sec</small></div></label></div><div className="duration-row"><span>CLIP LENGTH</span><b>{formatTime(Math.max(0,Number(end||duration)-Number(start)))}</b></div><button className="export-button" disabled={!file||busy||!duration} onClick={()=>exportClip()}>{busy?<><LoaderCircle className="spin" size={17}/> Working…</>:<><Scissors size={17}/> Create my clip <ArrowDownToLine size={16}/></>}</button>{busy&&<Progress status={status} progress={progress}/>}<p className="engine-note"><Gauge size={14}/>{engineReady?'Local engine ready':'Free browser-based video engine'}</p></div></section>
        {outputUrl&&<Result url={outputUrl} name={outputName}/>}</>}
      {tab==='highlights'&&<section className="editor-card feature-panel"><PanelHead icon={Sparkles} kicker="AI-ASSISTED MOMENTS" title="Find the interesting parts" subtitle="Scan frames locally for scene changes and suggest moments worth clipping."/><div className="feature-actions"><button className="export-button" disabled={!file||busy} onClick={detectHighlights}>{busy?<><LoaderCircle className="spin"/> Scanning…</>:<><WandSparkles size={17}/> Find highlights</>}</button><span className="engine-note">Visual scene-change heuristic · no cloud API</span></div>{highlights.length>0&&<div className="suggestion-list">{highlights.map(h=><div className="suggestion" key={h.id}><div><b>Suggested moment {h.id}</b><small>{formatTime(h.start)} – {formatTime(h.end)} · visual activity score {h.score}</small></div><button className="change-file" onClick={()=>{setStart(String(h.start));setEnd(String(h.end));setTab('cutter');}}>Use this clip</button></div>)}</div>}<p className="fine-print">These are heuristic suggestions, not semantic AI understanding. Results depend on lighting, motion and the source video.</p></section>}
      {tab==='captions'&&<section className="editor-card feature-panel"><PanelHead icon={Captions} kicker="LOCAL SPEECH-TO-TEXT" title="Create and edit captions" subtitle="Run the free Whisper Tiny model in your browser, then edit and export subtitle files."/><div className="feature-actions"><button className="export-button" disabled={!file||transcribing} onClick={transcribe}>{transcribing?<><LoaderCircle className="spin"/> Transcribing…</>:<><Mic2 size={17}/> Generate captions</>}</button><span className="engine-note">{modelProgress||'First run downloads a model; no paid API required.'}</span></div>{captions.length>0&&<><div className="caption-toolbar"><b>{captions.length} subtitle segments</b><div><label className="change-file import-srt">Import SRT<input type="file" accept=".srt,text/plain" onChange={async e=>{const f=e.target.files?.[0];if(f){setCaptions(parseSrt(await f.text()));e.target.value="";}}}/></label><button className="change-file" onClick={addCaption}><Plus size={14}/> Add line</button><button className="change-file" onClick={()=>downloadBlob(new Blob([makeSrt(captions)],{type:'text/plain'}), 'clipmax-captions.srt')}><Download size={14}/> Export SRT</button></div></div><div className="caption-list">{captions.map(c=><div className="caption-row" key={c.id}><div className="caption-times"><input type="number" step=".1" value={c.start} onChange={e=>updateCaption(c.id,'start',Number(e.target.value))}/><span>to</span><input type="number" step=".1" value={c.end} onChange={e=>updateCaption(c.id,'end',Number(e.target.value))}/></div><textarea value={c.text} onChange={e=>updateCaption(c.id,'text',e.target.value)}/><button className="icon-button" onClick={()=>setCaptions(cs=>cs.filter(x=>x.id!==c.id))}><Trash2 size={15}/></button></div>)}</div></> }<p className="fine-print">Whisper Tiny is a free downloadable model. Model files are fetched from Hugging Face on first use; transcription runs in your browser and may be slow on phones. Model availability and memory depend on your device.</p></section>}
      {tab==='studio'&&<section className="editor-card feature-panel"><PanelHead icon={Radio} kicker="CREATOR STUDIO" title="Record your screen or tab" subtitle="Capture a browser tab, window or screen using your browser's recording permission."/><div className="record-stage"><div className={recording?'record-pulse':'record-symbol'}><MonitorUp size={34}/></div><strong>{recording?'Recording in progress': 'Ready to record'}</strong><span>{recording?`Elapsed ${formatTime(recordSeconds)} · Stop when finished`:'Your browser will ask what you want to share.'}</span>{!recording?<button className="export-button" onClick={startRecording}><Play size={17}/> Start screen recording</button>:<button className="stop-button" onClick={stopRecording}><Pause size={17}/> Stop recording</button>}</div>{recordedUrl&&<div className="recorded-result"><video src={recordedUrl} controls/><div><button className="change-file" onClick={useRecording}><Scissors size={15}/> Edit this recording</button><a className="download-button" href={recordedUrl} download="clipmax-recording.webm"><Download size={15}/> Download WEBM</a></div></div>}<p className="fine-print">This records media selected in the browser's share picker. It is not an RTMP ingest server and does not connect to YouTube or Twitch live streams.</p></section>}
      {tab==='editor'&&<section className="editor-card feature-panel"><PanelHead icon={Crop} kicker="EXPORT SETTINGS" title="Choose your video format" subtitle="Pick an aspect ratio, then export the selected section from the Video cutter tab."/><div className="ratio-grid">{[['original','Original','Keep source dimensions'],['9:16','Vertical 9:16','Shorts, Reels, TikTok'],['1:1','Square 1:1','Square social posts'],['16:9','Landscape 16:9','YouTube and widescreen']].map(([v,t,d])=><button key={v} className={ratio===v?'ratio-option selected':'ratio-option'} onClick={()=>setRatio(v)}><span className={`ratio-icon ratio-${v.replace(':','-')}`}/><b>{t}</b><small>{d}</small>{ratio===v&&<Check size={15}/>}</button>)}</div><div className="feature-actions"><button className="export-button" onClick={()=>setTab('cutter')}><Scissors size={17}/> Continue to video cutter</button></div><p className="fine-print">Aspect-ratio exports crop to fill the chosen frame. Keep the original setting if you do not want cropping.</p></section>}
      <section className="bottom-row"><div className="feature-note"><span><LockKeyhole size={16}/></span><div><b>Private by design</b><p>Media processing is local to your browser.</p></div></div><div className="feature-note"><span><Sparkles size={16}/></span><div><b>Free-first tools</b><p>Open models and open-source browser processing.</p></div></div></section>
      <footer><span>© 2026 CLIPMAX AI</span><span>MADE FOR CREATORS <span className="footer-star">✦</span></span></footer>
    </main>
  </div>;
}
function Progress({status,progress}){return <div className="progress-area"><div className="progress-label"><span>{status}</span><b>{progress}%</b></div><div className="progress-bar"><span style={{width:`${progress}%`}}/></div></div>;}
function PanelHead({icon:Icon,kicker,title,subtitle}){return <div className="feature-panel-head"><span className="panel-icon"><Icon size={22}/></span><div><div className="card-kicker">{kicker}</div><h2>{title}</h2><p>{subtitle}</p></div></div>;}
function Result({url,name}){return <section className="result-card"><div className="result-icon"><Check size={20}/></div><div className="result-copy"><strong>Your clip is ready!</strong><span>{name} · MP4 video</span></div><a className="download-button" href={url} download={name}><ArrowDownToLine size={16}/> Download clip</a></section>;}
createRoot(document.getElementById('root')).render(<App/>);
