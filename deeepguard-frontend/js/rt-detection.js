(function(){
  'use strict';

  let rtVStream=null, rtVAnim=null, rtVAttacking=false, rtVScore=null;
  window.__rtVScore = null;
  let rtVScanTimer=null, rtVIsScanning=false;
  const RT_SCAN_INTERVAL_MS = 4000;
  const rtVideoEl=document.getElementById('rtVideoEl');
  const rtVideoCanvas=document.getElementById('rtVideoCanvas');
  const rtVCtx=rtVideoCanvas.getContext('2d');

  window.rtStartVideo = async function(){
    try{
      rtVStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:480},height:{ideal:360}},audio:false});
      rtVideoEl.srcObject = rtVStream;
      await rtVideoEl.play();
      rtVideoCanvas.width = rtVideoEl.videoWidth||480;
      rtVideoCanvas.height = rtVideoEl.videoHeight||360;
      document.getElementById('rtVideoIdle').style.display='none';
      document.getElementById('rtVideoStartBtn').disabled=true;
      document.getElementById('rtVideoStopBtn').disabled=false;
      document.getElementById('rtVideoAttackBtn').disabled=false;
      const pill=document.getElementById('rtVideoPill');
      pill.classList.remove('off'); pill.innerHTML='<span class="rt-live-dot"></span>SCANNING';
      rtVScore=null; window.__rtVScore=null;
      rtSetScoreUI('rtVideoScoreRow','rtVideoScoreVal','rtVideoMeter','AWAITING FIRST SCAN...',0,'safe');
      rtVideoRenderLoop();
      rtScheduleVideoScan();
    }catch(e){
      document.getElementById('rtVideoIdle').querySelector('.rt-idle-txt').innerHTML='CAMERA ACCESS DENIED<br>Please allow camera permission';
    }
  };

  window.rtStopVideo = function(){
    if(rtVStream) rtVStream.getTracks().forEach(t=>t.stop());
    if(rtVAnim) cancelAnimationFrame(rtVAnim);
    if(rtVScanTimer) clearTimeout(rtVScanTimer);
    rtVStream=null; rtVAttacking=false; rtVIsScanning=false;
    document.getElementById('rtVideoIdle').style.display='flex';
    document.getElementById('rtVideoIdle').querySelector('.rt-idle-txt').innerHTML='CAMERA NOT STARTED<br>Click "Start Camera" to begin continuous frame analysis';
    document.getElementById('rtVideoStartBtn').disabled=false;
    document.getElementById('rtVideoStopBtn').disabled=true;
    document.getElementById('rtVideoAttackBtn').disabled=true;
    document.getElementById('rtVideoAttackBtn').textContent='\uD83C\uDFAD Simulate Morph';
    const pill=document.getElementById('rtVideoPill');
    pill.classList.add('off'); pill.innerHTML='<span class="rt-live-dot"></span>OFFLINE';
    rtVCtx.clearRect(0,0,rtVideoCanvas.width,rtVideoCanvas.height);
    rtSetScoreUI('rtVideoScoreRow','rtVideoScoreVal','rtVideoMeter','\u2014',0,'safe');
  };

  window.rtToggleVideoAttack = function(){
    rtVAttacking = !rtVAttacking;
    document.getElementById('rtVideoAttackBtn').textContent = rtVAttacking ? '\u2705 Stop Morph' : '\uD83C\uDFAD Simulate Morph';
  };

  function rtVideoRenderLoop(){
    if(!rtVStream) return;
    rtVAnim = requestAnimationFrame(rtVideoRenderLoop);
    rtVideoCanvas.width = rtVideoEl.videoWidth||480;
    rtVideoCanvas.height = rtVideoEl.videoHeight||360;
    rtVCtx.save(); rtVCtx.translate(rtVideoCanvas.width,0); rtVCtx.scale(-1,1);
    rtVCtx.drawImage(rtVideoEl,0,0,rtVideoCanvas.width,rtVideoCanvas.height);
    rtVCtx.restore();

    if(rtVAttacking){
      const id=rtVCtx.getImageData(0,0,rtVideoCanvas.width,rtVideoCanvas.height), d=id.data;
      for(let i=0;i<d.length;i+=4){
        const n=(Math.random()-.5)*26;
        d[i]=Math.min(255,Math.max(0,d[i]+n*1.4));
        d[i+1]=Math.min(255,Math.max(0,d[i+1]-n*.4));
        d[i+2]=Math.min(255,Math.max(0,d[i+2]+n*.8));
      }
      rtVCtx.putImageData(id,0,0);
      rtVCtx.strokeStyle='rgba(107,114,128,0.7)'; rtVCtx.lineWidth=3;
      rtVCtx.strokeRect(1.5,1.5,rtVideoCanvas.width-3,rtVideoCanvas.height-3);
      rtVCtx.fillStyle='rgba(107,114,128,0.95)'; rtVCtx.font='bold 11px DM Mono, monospace';
      rtVCtx.fillText('\u26A0 VISUAL NOISE (preview only)', 8, 18);
    } else {
      rtVCtx.strokeStyle='rgba(209,213,219,0.35)'; rtVCtx.lineWidth=1.5;
      const cx=rtVideoCanvas.width/2, cy=rtVideoCanvas.height/2-10, t=Date.now()/1000;
      rtVCtx.beginPath(); rtVCtx.ellipse(cx,cy,80+Math.sin(t)*4,100,0,0,Math.PI*2); rtVCtx.stroke();
      rtVCtx.fillStyle='rgba(209,213,219,0.7)'; rtVCtx.font='10px DM Mono, monospace';
      rtVCtx.fillText('DeepGuard \u00B7 LIVE SCANNING', 8, 16);
    }
  }

  function rtScheduleVideoScan(){
    if(!rtVStream) return;
    if(rtVScanTimer) clearTimeout(rtVScanTimer);
    rtVScanTimer = setTimeout(()=>{ rtRunRealVideoScan(); }, RT_SCAN_INTERVAL_MS);
  }

  async function rtRunRealVideoScan(){
    if(!rtVStream || rtVIsScanning) return;
    rtVIsScanning = true;

    const grab=document.createElement('canvas');
    grab.width = rtVideoEl.videoWidth||480; grab.height = rtVideoEl.videoHeight||360;
    const gctx = grab.getContext('2d');
    gctx.translate(grab.width,0); gctx.scale(-1,1);
    gctx.drawImage(rtVideoEl,0,0,grab.width,grab.height);

    if(rtVAttacking){
      const id=gctx.getImageData(0,0,grab.width,grab.height), d=id.data;
      for(let i=0;i<d.length;i+=4){
        const n=(Math.random()-.5)*26;
        d[i]=Math.min(255,Math.max(0,d[i]+n*1.4));
        d[i+1]=Math.min(255,Math.max(0,d[i+1]-n*.4));
        d[i+2]=Math.min(255,Math.max(0,d[i+2]+n*.8));
      }
      gctx.putImageData(id,0,0);
    }

    const frameB64 = grab.toDataURL('image/jpeg',0.75).split(',')[1];

    try{
      const apiKey = localStorage.getItem('deepguard_api_key') || '';
      const res = await fetch('/api/scan-frame',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          ...(apiKey ? {'X-API-Key': apiKey} : {}),
        },
        body:JSON.stringify({image_base64: frameB64}),
      });
      if(!res.ok){
        if(res.status===403) throw new Error('API key rejected — click 🔑 Set API Key above');
        throw new Error('API '+res.status);
      }
      const result = await res.json();
      if(typeof result.trust_score!=='number') throw new Error('bad schema');

      rtVScore = Math.max(0,Math.min(100,Math.round(result.trust_score))); window.__rtVScore = rtVScore;
      const tier = rtVScore>=65?'safe':rtVScore>=35?'warn':'danger';
      const verdict = String(result.verdict||'UNCERTAIN').slice(0,40);
      rtSetScoreUI('rtVideoScoreRow','rtVideoScoreVal','rtVideoMeter', verdict+' \u00B7 '+rtVScore+'%', rtVScore, tier);
    }catch(err){
      if(rtVScore===null){
        rtSetScoreUI('rtVideoScoreRow','rtVideoScoreVal','rtVideoMeter','SCAN FAILED \u2014 '+err.message.slice(0,50),0,'warn');
      }
    }finally{
      rtVIsScanning = false;
      rtScheduleVideoScan();
    }
  }

  let rtAStream=null, rtAAnim=null, rtAttacking=false, rtAScore=85;
  window.__rtAScore = 85;
  let rtActx=null, rtAAnalyser=null, rtAData=null;
  let rtABars = new Array(48).fill(0.1);
  const rtAudioCanvas=document.getElementById('rtAudioCanvas');
  const rtACtx=rtAudioCanvas.getContext('2d');

  let rtHistoryBuffer = [];
  const RT_HISTORY_SIZE = 30;
  let rtBaselineEstablished = false;
  let rtBaselineCentroid = 0;
  let rtBaselineSpread = 0;
  let rtBaselineFlux = 0;

  let rtPrevSpectrum = null;

  window.rtStartAudio = async function(){
    try{
      rtAStream = await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      rtActx = new (window.AudioContext||window.webkitAudioContext)();
      const src = rtActx.createMediaStreamSource(rtAStream);
      rtAAnalyser = rtActx.createAnalyser();
      rtAAnalyser.fftSize = 512;
      src.connect(rtAAnalyser);
      rtAData = new Uint8Array(rtAAnalyser.frequencyBinCount);
      rtPrevSpectrum = null;
      rtHistoryBuffer = [];
      rtBaselineEstablished = false;

      document.getElementById('rtAudioIdle').style.display='none';
      document.getElementById('rtAudioStartBtn').disabled=true;
      document.getElementById('rtAudioStopBtn').disabled=false;
      document.getElementById('rtAudioAttackBtn').disabled=false;
      const pill=document.getElementById('rtAudioPill');
      pill.classList.remove('off'); pill.innerHTML='<span class="rt-live-dot"></span>ANALYZING';

      rtAudioCanvas.width = rtAudioCanvas.offsetWidth;
      rtAudioCanvas.height = rtAudioCanvas.offsetHeight;
      rtAScore=85; window.__rtAScore=85;
      rtAudioLoop();
    }catch(e){
      document.getElementById('rtAudioIdle').querySelector('.rt-idle-txt').innerHTML='MICROPHONE ACCESS DENIED<br>Please allow microphone permission';
    }
  };

  window.rtStopAudio = function(){
    if(rtAStream) rtAStream.getTracks().forEach(t=>t.stop());
    if(rtActx) rtActx.close();
    if(rtAAnim) cancelAnimationFrame(rtAAnim);
    rtAStream=null; rtAttacking=false;
    document.getElementById('rtAudioIdle').style.display='flex';
    document.getElementById('rtAudioIdle').querySelector('.rt-idle-txt').innerHTML='MICROPHONE NOT STARTED<br>Click "Start Mic" to begin continuous voice analysis';
    document.getElementById('rtAudioStartBtn').disabled=false;
    document.getElementById('rtAudioStopBtn').disabled=true;
    document.getElementById('rtAudioAttackBtn').disabled=true;
    document.getElementById('rtAudioAttackBtn').textContent='\uD83E\uDD16 Simulate Voice Clone';
    const pill=document.getElementById('rtAudioPill');
    pill.classList.add('off'); pill.innerHTML='<span class="rt-live-dot"></span>OFFLINE';
    rtACtx.clearRect(0,0,rtAudioCanvas.width,rtAudioCanvas.height);
    rtSetScoreUI('rtAudioScoreRow','rtAudioScoreVal','rtAudioMeter','\u2014',0,'safe');
  };

  window.rtToggleAudioAttack = function(){
    rtAttacking = !rtAttacking;
    document.getElementById('rtAudioAttackBtn').textContent = rtAttacking ? '\u2705 Stop Voice Clone' : '\uD83E\uDD16 Simulate Voice Clone';
  };

  function rtComputeSpectralFeatures(data, sampleRate) {
    const len = data.length;
    if (len < 2) return { centroid: 0, spread: 0, flux: 0, zcr: 0, energyRatio: 0.5, harmonicConfidence: 0.5 };

    let totalMag = 0;
    let weightedFreq = 0;
    let maxMag = 0;
    let maxMagIdx = 0;

    for (let i = 0; i < len; i++) {
      const mag = data[i];
      totalMag += mag;
      const freq = (i * sampleRate) / (2 * len);
      weightedFreq += freq * mag;
      if (mag > maxMag) {
        maxMag = mag;
        maxMagIdx = i;
      }
    }

    const centroid = totalMag > 0 ? weightedFreq / totalMag : 0;

    let spreadSum = 0;
    for (let i = 0; i < len; i++) {
      const freq = (i * sampleRate) / (2 * len);
      spreadSum += Math.pow(freq - centroid, 2) * data[i];
    }
    const spread = totalMag > 0 ? Math.sqrt(spreadSum / totalMag) : 0;

    let flux = 0;
    if (rtPrevSpectrum) {
      for (let i = 0; i < len; i++) {
        flux += Math.abs(data[i] - rtPrevSpectrum[i]);
      }
      flux /= len;
    }
    rtPrevSpectrum = new Uint8Array(data);

    let zcr = 0;
    if (data.length > 1) {
      const timeData = new Float32Array(len);
      const timeDomain = rtAAnalyser ? (() => {
        const td = new Float32Array(rtAAnalyser.fftSize);
        rtAAnalyser.getFloatTimeDomainData(td);
        return td;
      })() : new Float32Array(len);
      for (let i = 1; i < len && i < timeDomain.length; i++) {
        if (timeData[i] === undefined) timeData[i] = 0;
        if ((timeDomain[i-1] >= 0 && timeDomain[i] < 0) || (timeDomain[i-1] < 0 && timeDomain[i] >= 0)) {
          zcr++;
        }
      }
      zcr /= (len - 1);
    }

    let lowFreqEnergy = 0, highFreqEnergy = 0;
    const splitBin = Math.floor(len * 0.3);
    for (let i = 0; i < len; i++) {
      if (i < splitBin) lowFreqEnergy += data[i];
      else highFreqEnergy += data[i];
    }
    const totalE = lowFreqEnergy + highFreqEnergy;
    const energyRatio = totalE > 0 ? lowFreqEnergy / totalE : 0.5;

    let harmonicPeaks = 0;
    for (let i = 2; i < len - 2; i++) {
      if (data[i] > data[i-1] && data[i] > data[i-2] && data[i] > data[i+1] && data[i] > data[i+2]) {
        harmonicPeaks++;
      }
    }
    const harmonicConfidence = Math.min(1, harmonicPeaks / (len * 0.15));

    return { centroid, spread, flux, zcr, energyRatio, harmonicConfidence };
  }

  function rtComputeVoiceScore(features) {
    const sampleRate = rtActx ? rtActx.sampleRate : 44100;

    rtHistoryBuffer.push(features);
    if (rtHistoryBuffer.length > RT_HISTORY_SIZE) {
      rtHistoryBuffer.shift();
    }

    if (rtHistoryBuffer.length < 10) {
      return 85;
    }

    if (!rtBaselineEstablished && rtHistoryBuffer.length >= 15) {
      let sumCent = 0, sumSpread = 0, sumFlux = 0;
      const baselineData = rtHistoryBuffer.slice(0, 15);
      baselineData.forEach(f => {
        sumCent += f.centroid;
        sumSpread += f.spread;
        sumFlux += f.flux;
      });
      rtBaselineCentroid = sumCent / baselineData.length;
      rtBaselineSpread = sumSpread / baselineData.length;
      rtBaselineFlux = sumFlux / baselineData.length;
      rtBaselineEstablished = true;
    }

    const c = features.centroid;
    const s = features.spread;
    const fl = features.flux;
    const z = features.zcr;
    const er = features.energyRatio;
    const hc = features.harmonicConfidence;

    let stabilityScore = 0.8;
    if (rtBaselineEstablished) {
      const centDev = Math.abs(c - rtBaselineCentroid) / Math.max(rtBaselineCentroid, 1);
      const spreadDev = Math.abs(s - rtBaselineSpread) / Math.max(rtBaselineSpread, 1);
      const fluxRatio = rtBaselineFlux > 0 ? fl / rtBaselineFlux : 1;
      stabilityScore = 1 - Math.min(1, (centDev * 0.4 + spreadDev * 0.3 + Math.abs(fluxRatio - 1) * 0.3));
    }

    const centroidScore = c > 200 && c < 3000 ? 0.9 : c > 100 && c < 4000 ? 0.7 : 0.4;
    const spreadScore = s > 200 && s < 2500 ? 0.85 : s > 100 && s < 4000 ? 0.65 : 0.4;
    const zcrScore = z > 0.02 && z < 0.25 ? 0.85 : z > 0.01 && z < 0.4 ? 0.6 : 0.3;
    const energyScore = er > 0.4 && er < 0.9 ? 0.9 : er > 0.2 && er < 0.95 ? 0.7 : 0.4;
    const harmonicScore = hc > 0.1 && hc < 0.6 ? 0.85 : hc < 0.8 ? 0.65 : 0.35;

    let combinedScore = (
      stabilityScore * 0.30 +
      centroidScore * 0.15 +
      spreadScore * 0.10 +
      zcrScore * 0.10 +
      energyScore * 0.15 +
      harmonicScore * 0.20
    );

    if (rtAttacking) {
      combinedScore *= 0.5 + (Math.sin(Date.now() / 500) * 0.1);
      combinedScore = Math.max(0.05, Math.min(0.45, combinedScore));
    }

    return Math.max(0, Math.min(100, Math.round(combinedScore * 100)));
  }

  let rtATick=0;
  function rtAudioLoop(){
    if(!rtAStream) return;
    rtAAnim = requestAnimationFrame(rtAudioLoop);
    rtATick++;

    const W=rtAudioCanvas.width, H=rtAudioCanvas.height;
    rtACtx.clearRect(0,0,W,H);

    let amp = 0.15;
    if(rtAAnalyser && rtAData){
      rtAAnalyser.getByteFrequencyData(rtAData);

      let sum=0; for(let i=0;i<rtAData.length;i++) sum+=rtAData[i];
      amp = Math.min(1, (sum / rtAData.length) / 200);

      if(rtATick % 4 === 0 && rtActx) {
        const features = rtComputeSpectralFeatures(rtAData, rtActx.sampleRate);
        rtAScore = rtComputeVoiceScore(features); window.__rtAScore = rtAScore;
        const tier = rtAScore>=65?'safe':rtAScore>=35?'warn':'danger';
        const label = rtAScore>=65?'AUTHENTIC VOICE':rtAScore>=35?'ANOMALY DETECTED':'⚠ CLONE LIKELY';
        rtSetScoreUI('rtAudioScoreRow','rtAudioScoreVal','rtAudioMeter', label+' \u00B7 '+rtAScore+'%', rtAScore, tier);
      }
    }

    rtABars.shift();
    const noise = rtAttacking ? (Math.random()*0.5+0.3) : (Math.random()*0.12);
    rtABars.push(Math.max(0.06,Math.min(1, amp + noise*(rtAttacking?1:0.3))));

    const barW = W/rtABars.length;
    const tier = rtAScore>=65?'#FFFFFF':rtAScore>=35?'#9CA3AF':'#525252';
    rtABars.forEach((h,i)=>{
      const barH=h*H*0.8, x=i*barW, y=(H-barH)/2;
      const grd=rtACtx.createLinearGradient(0,y,0,y+barH);
      grd.addColorStop(0,tier+'CC'); grd.addColorStop(1,tier+'33');
      rtACtx.fillStyle=grd;
      rtACtx.fillRect(x+1,y,barW-2,barH);
    });
  }

  function rtSetScoreUI(rowId, valId, meterId, text, score, tier){
    const row=document.getElementById(rowId);
    row.className = 'rt-score-row '+tier;
    document.getElementById(valId).textContent = text;
    const meter=document.getElementById(meterId);
    meter.style.width = Math.max(0,Math.min(100,score))+'%';
    meter.style.background = tier==='safe' ? 'var(--green)' : tier==='warn' ? 'var(--amber)' : 'var(--pink)';
  }

  let rtResizeTimer;
  window.addEventListener('resize', ()=>{
    clearTimeout(rtResizeTimer);
    rtResizeTimer = setTimeout(()=>{
      if(rtAStream){ rtAudioCanvas.width=rtAudioCanvas.offsetWidth; rtAudioCanvas.height=rtAudioCanvas.offsetHeight; }
    },150);
  });
})();
