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
      const count=Math.min(10,Math.max(5,Number(clipCount)||5));
      const maxStart=Math.max(0,duration-30);
      const starts=Array.from({length:count},(_,i)=>count===1?0:Math.round((maxStart*i/(count-1))*10)/10);
      const results=[];
      for(let i=0;i<starts.length;i++){
        const out='clipmax-short-'+(i+1)+'.mp4';
        const args=['-ss',String(starts[i]),'-i',inputName,'-t','30','-map','0:v:0','-map','0:a?'];
        if(ratio==='9:16')args.push('-vf','scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
        else if(ratio==='1:1')args.push('-vf','scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080');
        else if(ratio==='16:9')args.push('-vf','scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080');
        args.push('-c:v','libx264','-preset','ultrafast','-crf','23','-c:a','aac','-movflags','+faststart',out);
        setStatus('Creating short clip '+(i+1)+' of '+count+'…');
        await ff.exec(args);
        const data=await ff.readFile(out);
        results.push({id:i+1,start:starts[i],url:URL.createObjectURL(new Blob([data],{type:'video/mp4'})),name:'clipmax-short-'+(i+1)+'.mp4'});
        await ff.deleteFile(out).catch(()=>{});
        setProgress(Math.round((i+1)/count*100));
      }
      setGeneratedClips(results);setStatus(count+' short clips are ready');
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
      {tab==='cutter'&&<><section className="link-first-panel">
        <div className="link-first-copy"><div className="eyebrow"><span className="eyebrow-line"/> CLIPMAX LINK STUDIO</div><h2>Turn a video into <span>shorts.</span></h2><p>Paste a video URL to check the source. For supported video files, ClipMax can create vertical MP4 clips on your device.</p></div>
        <div className="universal-link-row"><input aria-label="Paste social media or video URL" type="url" placeholder="Paste YouTube, Instagram, TikTok or direct video link…" value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')handleSourceUrl();}}/><button className="export-button" onClick={handleSourceUrl} disabled={linkLoading}>{linkLoading?<LoaderCircle className="spin" size={17}/>:<Sparkles size={17}/>} Check link</button></div>
        <div className="source-status"><span className="status-dot"/>{sourceStatus}</div>
        {sourceChecked&&<div className="link-create-action">
          <button className="export-button" disabled={busy} onClick={()=>{
            if(!sourceCanClip||!file){
              setSourceStatus('This link is only a preview; it does not provide the actual video file. ClipMax cannot create downloadable clips from this link. Import a video file you own or use an authorized direct MP4/WebM link.');
              return;
            }
            if(duration<30){setSourceStatus('Please wait for the video to load and make sure it is at least 30 seconds long.');return;}
            generateShortClips();
          }}>
            {busy?<><LoaderCircle className="spin" size={17}/> Creating clips…</>:<><Scissors size={17}/> Create clips <span className="create-count">{clipCount} × 30 sec</span><ArrowDownToLine size={16}/></>}
          </button>
          {!sourceCanClip&&<small>Clip creation becomes available when the link provides an accessible video file. YouTube and social post links may show a preview, but do not provide the downloadable source to this app.</small>}
          {sourceCanClip&&file&&duration>0&&duration<30&&<small>This source is shorter than 30 seconds. Choose a longer video.</small>}
          {sourceCanClip&&file&&duration===0&&<small>Loading video details…</small>}
        </div>}
        <div className="link-feature-row"><span><Check size={14}/> 9:16 vertical output</span><span><Check size={14}/> 5–10 clips</span><span><Check size={14}/> 30 sec target</span><span><LockKeyhole size={14}/> Local processing</span></div>
      </section><section className="steps"><div className="step active-step"><span>01</span><div><b>Import</b><small>Choose a video</small></div></div><div className="step-line"/><div className={file?'step active-step':'step'}><span>02</span><div><b>Trim</b><small>Pick your moment</small></div></div><div className="step-line"/><div className={outputUrl?'step active-step':'step'}><span>03</span><div><b>Export</b><small>Save your clip</small></div></div></section>
        <section className="workspace-grid"><div className="editor-card"><div className="card-head"><div><div className="card-kicker">01 — SOURCE VIDEO</div><h2>Bring your video</h2></div>{file&&<button className="change-file" onClick={()=>inputRef.current?.click()}><FolderOpen size={15}/> Change</button>}</div><input ref={inputRef} className="hidden-input" type="file" accept="video/*" onChange={e=>chooseFile(e.target.files?.[0])}/>{!file?<><button className="dropzone" onClick={()=>inputRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();chooseFile(e.dataTransfer.files?.[0]);}}><span className="upload-icon"><Upload size={23}/></span><strong>Drop your video here</strong><span>or <u>browse files</u> from your device</span><small>MP4, MOV, WEBM · Up to 1 GB</small></button><div className="link-import"><div className="link-import-label">OR PASTE A DIRECT VIDEO LINK</div><div className="link-import-row"><input aria-label="Direct video URL" type="url" placeholder="https://example.com/video.mp4" value={videoLink} onChange={e=>setVideoLink(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')loadVideoLink();}}/><button className="change-file" onClick={loadVideoLink} disabled={linkLoading}>{linkLoading?<LoaderCircle className="spin" size={14}/>:<Video size={14}/>} {linkLoading?'Loading…':'Load link'}</button></div><small>Direct video-file URLs only. The host must allow browser access.</small></div><div className="youtube-import">
          <div className="link-import-label">OR PREVIEW A YOUTUBE VIDEO</div>
          <div className="link-import-row"><input aria-label="YouTube video URL" type="url" placeholder="https://www.youtube.com/watch?v=…" value={youtubeLink} onChange={e=>{const value=e.target.value;setYoutubeLink(value);const id=getYouTubeId(value);setYoutubeId(id);if(!id)setError('');}} onKeyDown={e=>{if(e.key==='Enter')previewYouTube();}}/><button className="change-file" onClick={previewYouTube}><Play size={14}/> Preview</button></div>
          <div className="youtube-times"><label>START (SECONDS)<input type="number" min="0" value={youtubeStart} onChange={e=>setYoutubeStart(e.target.value)}/></label><label>END (SECONDS)<input type="number" min="1" value={youtubeEnd} onChange={e=>setYoutubeEnd(e.target.value)}/></label></div>
          {youtubeId&&<><div className="youtube-preview"><iframe title="YouTube video preview" src={`https://www.youtube-nocookie.com/embed/${youtubeId}?start=${Math.max(0,Math.floor(Number(youtubeStart)||0))}&end=${Math.max(0,Math.floor(Number(youtubeEnd)||0))}&rel=0`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div><button className="youtube-source-button" onClick={selectYoutubeSource}><Scissors size={14}/> Create this clip from my video file</button></>}
          <small>For export, select the original video file you own or are authorized to edit. ClipMax applies your chosen start/end times locally.</small>
        </div></>:<div className="video-wrap"><video ref={videoRef} src={videoUrl} controls onLoadedMetadata={e=>{const d=e.currentTarget.duration;setDuration(d);if(applyYoutubeRange){const from=Math.min(d,Math.max(0,Number(youtubeStart)||0));const to=Math.min(d,Math.max(from+0.1,Number(youtubeEnd)||from+30));setStart(String(from));setEnd(String(to));e.currentTarget.currentTime=from;setApplyYoutubeRange(false);}else{setEnd(String(Math.floor(d)));}}}/><div className="video-meta"><span><Film size={14}/>{file.name}</span><span>{formatTime(duration)} · {(file.size/1048576).toFixed(1)} MB</span></div></div>}<div className="privacy-note"><LockKeyhole size={14}/><span><b>Local processing.</b> Your selected video is not uploaded to ClipMax servers.</span></div></div>
        <div className="editor-card trim-card"><div className="card-head"><div><div className="card-kicker">02 — MAKE IT YOURS</div><h2>Trim your moment</h2></div><span className="tiny-chip"><Scissors size={12}/> PRECISE CUT</span></div><div className="trim-preview"><div className="trim-track"><div className="track-fill" style={{left:duration?`${Math.max(0,Number(start))/duration*100}%`:'0%',right:duration?`${100-Math.min(100,Number(end||duration)/duration*100)}%`:'0%'}}/><span className="track-start"/><span className="track-end"/></div><div className="track-labels"><span>START · {formatTime(Number(start))}</span><span>END · {formatTime(Number(end||duration))}</span></div></div><div className="time-fields"><label><span>START TIME</span><div><input type="number" min="0" step=".1" value={start} disabled={(!file&&!youtubeId)||busy} onChange={e=>{setStart(e.target.value);if(file)seek(e.target.value);}}/><small>sec</small></div></label><span className="time-divider">→</span><label><span>END TIME</span><div><input type="number" min="0" step=".1" value={end} disabled={(!file&&!youtubeId)||busy} onChange={e=>{setEnd(e.target.value);if(file)seek(e.target.value);}}/><small>sec</small></div></label></div><div className="duration-row"><span>CLIP LENGTH</span><b>{formatTime(Math.max(0,Number(end||duration)-Number(start)))}</b></div><button className="export-button" disabled={(!file&&!youtubeId)||busy||Boolean(file&&!duration)} onClick={()=>{if(!file&&youtubeId){selectYoutubeSource();return;}exportClip();}}>{busy?<><LoaderCircle className="spin" size={17}/> Working…</>:!file&&youtubeId?<><Scissors size={17}/> Choose source video to create clip <ArrowDownToLine size={16}/></>:<><Scissors size={17}/> Create my clip <ArrowDownToLine size={16}/></>}</button>{busy&&<Progress status={status} progress={progress}/>}<p className="engine-note"><Gauge size={14}/>{engineReady?'Local engine ready':'Free browser-based video engine'}</p></div></section>
        {file&&duration>=30&&<section className="editor-card feature-panel auto-clips-panel"><PanelHead icon={Sparkles} kicker="AUTOMATIC SHORTS" title="Generate short clips" subtitle="Create 5–10 separate 30-second MP4 clips from your selected source video."/><div className="feature-actions"><label className="clip-count-control">NUMBER OF CLIPS <select value={clipCount} onChange={e=>setClipCount(Number(e.target.value))}><option value={5}>5 clips</option><option value={6}>6 clips</option><option value={7}>7 clips</option><option value={8}>8 clips</option><option value={9}>9 clips</option><option value={10}>10 clips</option></select></label><button className="export-button" disabled={busy||!file||duration<30} onClick={generateShortClips}>{busy?<><LoaderCircle className="spin"/> Generating…</>:<><Sparkles size={17}/> Generate clips</>}</button></div><p className="fine-print">Exports are 9:16 vertical by default. This first version splits the video into evenly spaced 30-second sections; it does not yet understand the video's meaning or automatically rank viral moments.</p>{generatedClips.length>0&&<div className="suggestion-list">{generatedClips.map(c=><div className="suggestion" key={c.id}><div><b>Short clip {c.id}</b><small>30 seconds · starts at {formatTime(c.start)} · MP4 vertical</small></div><a className="download-button" href={c.url} download={c.name}><Download size={15}/> Download</a></div>)}</div>}</section>}
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
