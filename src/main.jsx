import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import JSZip from 'jszip';
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
function getYouTubeId(value) {
  try {
    const u = new URL(value.trim());
    let id = '';
    if (u.hostname === 'youtu.be' || u.hostname.endsWith('.youtu.be')) id = u.pathname.split('/').filter(Boolean)[0] || '';
    else if (u.hostname === 'youtube.com' || u.hostname.endsWith('.youtube.com')) id = u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] || '';
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  } catch { return ''; }
}
function App() {
  const [tab,setTab] = useState('cutter');
  const [file,setFile] = useState(null), [videoUrl,setVideoUrl] = useState('');
  const [videoLink,setVideoLink] = useState(''), [linkLoading,setLinkLoading] = useState(false);
  const [youtubeLink,setYoutubeLink] = useState(''), [youtubeId,setYoutubeId] = useState('');
  const [sourceUrl,setSourceUrl] = useState(''), [sourceStatus,setSourceStatus] = useState('Paste a public video link to check whether ClipMax can access it.');
  const [sourceChecked,setSourceChecked] = useState(false), [sourceCanClip,setSourceCanClip] = useState(false);
  const [youtubeStart,setYoutubeStart] = useState('0'), [youtubeEnd,setYoutubeEnd] = useState('30');
  const [applyYoutubeRange,setApplyYoutubeRange] = useState(false);
  const [duration,setDuration] = useState(0), [start,setStart] = useState('0'), [end,setEnd] = useState('');
  const [busy,setBusy] = useState(false), [progress,setProgress] = useState(0), [status,setStatus] = useState('Ready when you are');
  const [error,setError] = useState(''), [outputUrl,setOutputUrl] = useState(''), [outputName,setOutputName] = useState('');
  const [engineReady,setEngineReady] = useState(false), [ratio,setRatio] = useState('9:16');
  const [clipCount,setClipCount] = useState(5), [generatedClips,setGeneratedClips] = useState([]);
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
    setFile(f); setVideoUrl(URL.createObjectURL(f)); setDuration(0); setStart('0'); setEnd(''); setGeneratedClips([]);
    setStatus('Video ready to edit'); setTab('cutter');
  }
  function selectYoutubeSource() {
    if(!youtubeId){setError('Preview a YouTube link first.');return;}
    setApplyYoutubeRange(true);
    inputRef.current?.click();
  }
  function previewYouTube(value) {
    const id = getYouTubeId(value ?? youtubeLink);
    if (!id) { setYoutubeId(''); setError('Paste a valid YouTube video URL.'); return; }
    const from=Math.max(0,Math.floor(Number(youtubeStart)||0));
    const to=Math.max(0,Math.floor(Number(youtubeEnd)||0));
    if(to&&to<=from) { setError('End time must be later than start time.'); return; }
    setYoutubeId(id);setYoutubeStart(String(from));setYoutubeEnd(String(to||from+30));setError('');
  }
  async function loadVideoLink(value) {
    const raw=(value ?? videoLink).trim();
    if(!raw){setError('Paste a direct video file URL first.');return;}
    let parsed;
    try{parsed=new URL(raw);if(!['http:','https:'].includes(parsed.protocol))throw new Error();}
    catch{setError('Enter a valid http or https video URL.');return;}
    setLinkLoading(true);setError('');
    try{
      const response=await fetch(parsed.href);
      if(!response.ok)throw new Error('The video host returned HTTP '+response.status+'.');
      const blob=await response.blob();
      const type=(blob.type||response.headers.get('content-type')||'').split(';')[0].toLowerCase();
      const ext=(parsed.pathname.split('/').pop().split('.').pop()||'mp4').toLowerCase();
      const allowed=['mp4','mov','webm','m4v','ogv'];
      if(!type.startsWith('video/')&&!allowed.includes(ext))throw new Error('That link does not appear to point directly to a video file.');
      if(!blob.size)throw new Error('The video file is empty or unavailable.');
      if(blob.size>1024*1024*1024)throw new Error('This browser version supports files up to 1 GB.');
      const filename=decodeURIComponent(parsed.pathname.split('/').pop()||('clipmax-link.'+ext));
      chooseFile(new File([blob],filename,{type:type.startsWith('video/')?type:('video/'+(ext==='mov'?'quicktime':ext))}));
      setSourceCanClip(true);setSourceStatus('Video file loaded. Wait for its duration, then tap Create clips.');
      setVideoLink('');
    }catch(e){
      setError(e.message?.includes('Failed to fetch')||e instanceof TypeError
        ? 'Could not read that link. The host may block browser access (CORS), or it may not be a direct video-file URL. Try a direct MP4/WebM link from a host that allows access.'
        : (e.message||'Could not load that video link.'));
    }finally{setLinkLoading(false);}
  }
  async function handleSourceUrl() {
    setSourceChecked(true);setSourceCanClip(false);setGeneratedClips([]);
    const raw=sourceUrl.trim();
    if(!raw){setSourceStatus('Paste a video link first.');return;}
    let parsed;
    try{parsed=new URL(raw);if(!['http:','https:'].includes(parsed.protocol))throw new Error();}
    catch{setSourceStatus('That link is not a valid web URL.');return;}
    const host=parsed.hostname.toLowerCase().replace(/^www\./,'');
    if(getYouTubeId(raw)){
      setYoutubeLink(raw);previewYouTube(raw);
      setSourceStatus('YouTube link recognised. Preview is available, but YouTube does not provide this app with the downloadable source video. To make clips, use an authorized video file or a direct video-file link.');
      return;
    }
    const platforms=[
      ['Instagram',/instagram\.com$/],['TikTok',/tiktok\.com$/],['Facebook',/(facebook\.com|fb\.watch)$/],
      ['X',/(x\.com|twitter\.com)$/],['Vimeo',/vimeo\.com$/],['Twitch',/twitch\.tv$/]
    ];
    const platform=platforms.find(([,re])=>re.test(host));
    if(platform){
      setYoutubeId('');setSourceStatus(platform[0]+' link recognised. This platform does not provide a general authorized video-file feed to this app. Export your own video from that platform, or use an authorized direct MP4/WebM link.');
      return;
    }
    if(/\.(mp4|mov|webm|m4v|ogv)(?:$|\?)/i.test(parsed.pathname+parsed.search)){
      setSourceStatus('Direct video file detected. Trying to load it…');
      await loadVideoLink(raw);
      return;
    }
    setSourceStatus('Link received, but it is not a recognised direct video file or supported preview link. Try a direct MP4/WebM URL or import a video you own.');
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
  async function generateShortClips() {
    if(!file||!duration){setError('Choose a video and wait for it to finish loading first.');return;}
    if(duration<30){setError('This video is shorter than 30 seconds.');return;}
    setBusy(true);setProgress(0);setError('');setGeneratedClips([]);
    let ff,inputName;
    try{
      ff=await loadEngine();
      const ext=(file.name.split('.').pop()||'mp4').toLowerCase().replace(/[^a-z0-9]/g,'')||'mp4';
      inputName='clipmax-auto-source.'+ext;
      await ff.writeFile(inputName,await fetchFile(file));
      const count=Math.ceil(duration/30);
      if(count>240){throw new Error('This browser version limits one-hour-plus projects to 240 clips per batch.');}
      const maxStart=Math.max(0,duration-30);
      const starts=Array.from({length:count},(_,i)=>i*30);
      setHighlights(starts.map((start,i)=>({id:i+1,start,end:Math.min(duration,start+30),score:0})));
      const results=[];
      for(let i=0;i<starts.length;i++){
        const out='clipmax-short-'+(i+1)+'.mp4';
        const clipDuration=Math.min(30,duration-starts[i]);
        const args=['-ss',String(starts[i]),'-i',inputName,'-t',String(clipDuration),'-map','0:v:0','-map','0:a?'];
        if(ratio==='9:16')args.push('-vf','scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
        else if(ratio==='1:1')args.push('-vf','scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080');
        else if(ratio==='16:9')args.push('-vf','scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080');
        args.push('-c:v','libx264','-preset','ultrafast','-crf','23','-c:a','aac','-movflags','+faststart',out);
        setStatus('Creating short clip '+(i+1)+' of '+count+'…');
        await ff.exec(args);
        const data=await ff.readFile(out);
        results.push({id:i+1,start:starts[i],url:URL.createObjectURL(new Blob([data],{type:'video/mp4'})),name:'clipmax-part-'+String(i+1).padStart(3,'0')+'.mp4'});
        await ff.deleteFile(out).catch(()=>{});
        setProgress(Math.round((i+1)/count*100));
      }
      setGeneratedClips(results);setStatus(count+' consecutive 30-second clips are ready');
    }catch(e){setError(e.message||'Could not generate the short clips. Try a smaller video.');setStatus('Clip generation did not finish');}
    finally{if(ff&&inputName)await ff.deleteFile(inputName).catch(()=>{});setBusy(false);}
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
  async function downloadAllClips(){
    if(!generatedClips.length)return;
    try{
      setStatus('Preparing ZIP download…');setBusy(true);setProgress(0);
      const zip=new JSZip();
      for(let i=0;i<generatedClips.length;i++){
        const clip=generatedClips[i];
        const response=await fetch(clip.url);
        if(!response.ok)throw new Error('Could not read clip '+clip.id);
        zip.file(clip.name,await response.blob());
        setProgress(Math.round(((i+1)/generatedClips.length)*70));
      }
      const blob=await zip.generateAsync({type:'blob'},meta=>setProgress(70+Math.round(meta.percent*.3)));
      downloadBlob(blob,'clipmax-all-clips.zip');setStatus('All clips downloaded as ZIP.');
    }catch(e){setError('Could not prepare the ZIP. Please download clips individually.');}
    finally{setBusy(false);}
  }
  function seek(t){if(videoRef.current)videoRef.current.currentTime=t;}
  return <div className="app-shell">
    <main className="main-content">
      {videoUrl&&<video ref={analysisVideoRef} className="analysis-video" src={videoUrl} muted playsInline preload="auto"/>}
      <header className="topbar"><div className="brand"><span className="brand-mark"><Aperture size={21}/></span><span>clipmax<span className="brand-ai">.ai</span></span></div><div className="top-right"><span className="free-pill"><span/> CLIP MAKER</span></div></header>
      <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> SIMPLE VIDEO CLIP MAKER</div><h1>Make clips <span>in seconds.</span></h1><p>Paste a supported video link, choose a format and split the full video into 30-second clips.</p></div></section>
      {error&&<div className="alert"><X size={17}/>{error}<button onClick={()=>setError('')} aria-label="Dismiss"><X size={14}/></button></div>}
      <section className="link-first-panel">
        <div className="link-first-copy"><div className="eyebrow"><span className="eyebrow-line"/> 01 — VIDEO LINK</div><h2>Paste your video link</h2><p>YouTube, Instagram, TikTok and direct video links can be checked. A platform link is only usable for clipping when an authorised video source is available.</p></div>
        <div className="universal-link-row"><input aria-label="Paste video URL" type="url" placeholder="Paste YouTube, Instagram, TikTok or MP4 link…" value={sourceUrl} onChange={e=>{setSourceUrl(e.target.value);setSourceChecked(false);setSourceCanClip(false);}} onKeyDown={e=>{if(e.key==='Enter')handleSourceUrl();}}/><button className="export-button" onClick={handleSourceUrl} disabled={linkLoading}>{linkLoading?<LoaderCircle className="spin" size={17}/>:<Video size={17}/>} Check link</button></div>
        {sourceChecked&&<div className="source-status"><span className="status-dot"/>{sourceStatus}</div>}
        <div className="link-first-copy" style={{marginTop:24}}><div className="eyebrow"><span className="eyebrow-line"/> 02 — VIDEO FORMAT</div><h2>Choose output format</h2></div>
        <div className="ratio-grid">
          {[['original','Original','Keep source size'],['9:16','Vertical','Reels / Shorts'],['16:9','Horizontal','YouTube'],['1:1','Square','Square posts']].map(([v,t,d])=><button key={v} className={ratio===v?'ratio-option selected':'ratio-option'} onClick={()=>setRatio(v)}><span className={`ratio-icon ratio-${v.replace(':','-')}`}/><b>{t}</b><small>{d}</small>{ratio===v&&<Check size={15}/>}</button>)}
        </div>
        <div className="link-first-copy" style={{marginTop:24}}><div className="eyebrow"><span className="eyebrow-line"/> 03 — CREATE CLIPS</div><h2>Split the whole video</h2><p>ClipMax makes consecutive 30-second clips from the beginning to the end. A 1-hour video produces 120 clips.</p></div>
        <button className="export-button" disabled={busy||linkLoading} onClick={async()=>{
          if(!file){await handleSourceUrl();return;}
          if(!duration){setSourceStatus('Video is still loading. Please wait a moment.');return;}
          if(duration<30){setSourceStatus('This video is shorter than 30 seconds.');return;}
          generateShortClips();
        }}>
          {busy?<><LoaderCircle className="spin" size={17}/> Creating clips…</>:<><Scissors size={17}/> {file?'Create all clips':'Check link to create clips'} <span className="create-count">30 sec each</span></>}
        </button>
        {!file&&<small className="fine-print">YouTube, Instagram and TikTok share links do not provide a downloadable video file to this app. Use an authorised direct MP4/WebM video URL. ClipMax will not bypass platform restrictions.</small>}
        {file&&<div className="source-status"><span className="status-dot"/>Loaded: {file.name} · {formatTime(duration)} · {Math.ceil(duration/30)} clips planned</div>}
        {busy&&<Progress status={status} progress={progress}/>}
        {generatedClips.length>0&&<><div className="source-status"><span className="status-dot"/>{generatedClips.length} clips created successfully.</div><button className="export-button" disabled={busy} onClick={downloadAllClips}><Download size={17}/> Download all clips (ZIP)</button><div className="suggestion-list">{generatedClips.map(c=><div className="suggestion" key={c.id}><div><b>Clip {c.id}</b><small>Starts at {formatTime(c.start)} · 30-second segment (last may be shorter)</small></div><a className="download-button" href={c.url} download={c.name}><Download size={15}/> Download</a></div>)}</div></>}
      </section>
      {file&&<div className="editor-card" style={{marginTop:20}}><div className="card-head"><div><div className="card-kicker">SOURCE VIDEO</div><h2>{file.name}</h2></div><span>{formatTime(duration)}</span></div><video ref={videoRef} src={videoUrl} controls onLoadedMetadata={e=>{const d=e.currentTarget.duration;setDuration(d);setEnd(String(Math.floor(d)));}} style={{width:'100%',borderRadius:12}}/></div>}
      <footer><span>© 2026 CLIPMAX AI</span><span>30-SECOND VIDEO CLIPS</span></footer>
    </main>
  </div>;
}
function Progress({status,progress}){return <div className="progress-area"><div className="progress-label"><span>{status}</span><b>{progress}%</b></div><div className="progress-bar"><span style={{width:`${progress}%`}}/></div></div>;}
function PanelHead({icon:Icon,kicker,title,subtitle}){return <div className="feature-panel-head"><span className="panel-icon"><Icon size={22}/></span><div><div className="card-kicker">{kicker}</div><h2>{title}</h2><p>{subtitle}</p></div></div>;}
function Result({url,name}){return <section className="result-card"><div className="result-icon"><Check size={20}/></div><div className="result-copy"><strong>Your clip is ready!</strong><span>{name} · MP4 video</span></div><a className="download-button" href={url} download={name}><ArrowDownToLine size={16}/> Download clip</a></section>;}
createRoot(document.getElementById('root')).render(<App/>);
