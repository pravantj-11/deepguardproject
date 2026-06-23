(function(){
  'use strict';

  let siLastIntel = null;
  const DB_NAME = 'DeepGuardAuditDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'sessionRecords';
  let siDb = null;

  window.siPromptApiKey = function(){
    const current = localStorage.getItem('deepguard_api_key') || '';
    const key = prompt('Enter your DeepGuard Backend API key (DEEPGUARD_API_KEY):', current);
    if(key !== null){
      localStorage.setItem('deepguard_api_key', key);
      alert(key ? 'API key saved. Video scans will use this key.' : 'API key cleared.');
    }
  };

  window.siFetchIntel = async function(){
    const btn = document.getElementById('siFetchBtn');
    const pill = document.getElementById('siIntelPill');
    btn.disabled = true; btn.textContent = '\u23F3 Fetching real data...';
    pill.className = 'rt-live-pill off';
    pill.innerHTML = '<span class="rt-live-dot"></span>FETCHING...';

    const ua = navigator.userAgent || 'unknown';
    const screenRes = screen.width+'\u00D7'+screen.height+' @'+(window.devicePixelRatio||1)+'x';
    let browserName = 'Unknown';
    if(ua.includes('Chrome') && !ua.includes('Edg')) browserName='Chrome';
    else if(ua.includes('Firefox')) browserName='Firefox';
    else if(ua.includes('Safari') && !ua.includes('Chrome')) browserName='Safari';
    else if(ua.includes('Edg')) browserName='Edge';
    document.getElementById('siBrowser').textContent = browserName+' \u00B7 '+(navigator.platform||'?');
    document.getElementById('siScreen').textContent = screenRes;

    try{
      const res = await fetch('https://ipapi.co/json/');
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      if(data.error) throw new Error(data.reason||'API returned error');

      document.getElementById('siIp').textContent = data.ip || '\u2014';
      document.getElementById('siLoc').textContent = (data.city||'?')+', '+(data.country_name||'?');
      document.getElementById('siIsp').textContent = data.org || data.asn || '\u2014';
      document.getElementById('siTz').textContent = data.timezone || '\u2014';

      siLastIntel = {
        ip: data.ip||'unknown', city: data.city||'unknown', country: data.country_name||'unknown',
        org: data.org||'unknown', timezone: data.timezone||'unknown',
        browser: browserName, platform: navigator.platform||'unknown', screen: screenRes,
        fetchedAt: new Date().toISOString(),
      };

      pill.className = 'rt-live-pill';
      pill.innerHTML = '<span class="rt-live-dot"></span>LIVE DATA FETCHED';
      btn.textContent = '\u26A1 Re-fetch Session Data';
    }catch(err){
      pill.className = 'rt-live-pill off';
      pill.innerHTML = '<span class="rt-live-dot"></span>FETCH FAILED';
      document.getElementById('siIp').textContent = 'error';
      document.getElementById('siLoc').textContent = (err.message||'network error').slice(0,40);
      btn.textContent = '\u26A1 Retry Fetch';
    }finally{
      btn.disabled = false;
    }
  };

  function siOpenDb(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e)=>{
        const db = e.target.result;
        if(!db.objectStoreNames.contains(STORE_NAME)){
          const store = db.createObjectStore(STORE_NAME, {keyPath:'id', autoIncrement:true});
          store.createIndex('byTime','timestamp',{unique:false});
        }
      };
      req.onsuccess = (e)=>resolve(e.target.result);
      req.onerror   = (e)=>reject(e.target.error);
    });
  }

  async function siInitDb(){
    try{
      siDb = await siOpenDb();
      document.getElementById('siDbPill').innerHTML = '<span class="rt-live-dot"></span>DB READY';
      await siRenderRecords();
    }catch(err){
      document.getElementById('siDbPill').className = 'rt-live-pill off';
      document.getElementById('siDbPill').innerHTML = '<span class="rt-live-dot"></span>DB UNAVAILABLE';
    }
  }

  async function siSaveToBackend(record){
    const apiKey = localStorage.getItem('deepguard_api_key') || '';
    if(!apiKey) return false;
    try{
      const body = {
        video_trust_score: record.videoTrustScore,
        audio_trust_score: record.audioTrustScore,
        intel: record.intel ? {
          ip: record.intel.ip,
          city: record.intel.city,
          country: record.intel.country,
          org: record.intel.org,
          timezone: record.intel.timezone,
          browser: record.intel.browser,
          platform: record.intel.platform,
          screen: record.intel.screen,
        } : null,
      };
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch(e) {
      return false;
    }
  }

  window.siSaveSessionRecord = async function(){
    if(!siDb){ alert('Database not ready yet.'); return; }
    const record = {
      timestamp: new Date().toISOString(),
      videoTrustScore: (typeof window.__rtVScore !== 'undefined' && window.__rtVScore!==null) ? window.__rtVScore : null,
      audioTrustScore: (typeof window.__rtAScore !== 'undefined' && window.__rtAScore!==null) ? Math.round(window.__rtAScore) : null,
      intel: siLastIntel,
    };
    const tx = siDb.transaction([STORE_NAME],'readwrite');
    tx.objectStore(STORE_NAME).add(record);
    tx.oncomplete = () => {
      siRenderRecords();
      siSaveToBackend(record).then(ok => {
        const pill = document.getElementById('siIntelPill');
        if(ok) {
          pill.innerHTML = '<span class="rt-live-dot"></span>SAVED TO SERVER';
        }
      });
    };
    tx.onerror = (e) => console.error('IndexedDB write failed', e);
  };

  window.siClearDb = async function(){
    if(!siDb) return;
    if(!confirm('Clear all stored audit records from this browser\'s database? This cannot be undone.')) return;
    const tx = siDb.transaction([STORE_NAME],'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => siRenderRecords();
  };

  async function siRenderRecords(){
    if(!siDb) return;
    const tx = siDb.transaction([STORE_NAME],'readonly');
    const store = tx.objectStore(STORE_NAME);
    const records = [];
    await new Promise((resolve)=>{
      const cursorReq = store.openCursor(null,'prev');
      cursorReq.onsuccess = (e)=>{
        const cursor = e.target.result;
        if(cursor && records.length<50){ records.push(cursor.value); cursor.continue(); }
        else resolve();
      };
      cursorReq.onerror = ()=>resolve();
    });

    document.getElementById('siRecordCount').textContent = records.length;
    const list = document.getElementById('siRecordList');

    if(records.length===0){
      list.innerHTML = '';
      const empty=document.createElement('div');
      empty.style.cssText='font-family:var(--font-mono);font-size:.7rem;color:var(--muted);text-align:center;padding:20px';
      empty.textContent='No records yet \u2014 fetch session data, then save a record.';
      list.appendChild(empty);
      return;
    }

    list.innerHTML = '';
    records.forEach(r=>{
      const row = document.createElement('div');
      row.className = 'log-row info';
      const t = new Date(r.timestamp);
      const timeStr = t.toLocaleTimeString();
      const ipStr = r.intel ? r.intel.ip : 'not fetched';
      const vScore = r.videoTrustScore!==null ? r.videoTrustScore+'%' : '\u2014';
      const aScore = r.audioTrustScore!==null ? r.audioTrustScore+'%' : '\u2014';
      row.style.flexWrap='wrap';
      const timeSpan=document.createElement('span'); timeSpan.className='log-time'; timeSpan.textContent=timeStr;
      const msgSpan=document.createElement('span'); msgSpan.className='log-msg';
      msgSpan.textContent = 'IP: '+ipStr+' \u00B7 Video: '+vScore+' \u00B7 Voice: '+aScore;
      row.appendChild(timeSpan); row.appendChild(msgSpan);
      list.appendChild(row);
    });
  }

  if('indexedDB' in window){
    siInitDb();
  } else {
    document.getElementById('siDbPill').className='rt-live-pill off';
    document.getElementById('siDbPill').innerHTML='<span class="rt-live-dot"></span>NOT SUPPORTED';
  }
})();
