(function(){
  'use strict';

  const cur = document.getElementById('cursor');
  const ring = document.getElementById('cursor-ring');
  let mx=0,my=0,rx=0,ry=0;
  document.addEventListener('mousemove',e=>{
    mx=e.clientX; my=e.clientY;
    cur.style.left=mx+'px'; cur.style.top=my+'px';
  });
  function lerpCursor(){
    rx+=(mx-rx)*.12; ry+=(my-ry)*.12;
    if(ring){ ring.style.left=rx+'px'; ring.style.top=ry+'px'; }
    requestAnimationFrame(lerpCursor);
  }
  lerpCursor();

  const rc=document.getElementById('ripple-canvas');
  if(rc){
    const rctx=rc.getContext('2d');
    let stars=[];

    function resizeRipple(){rc.width=window.innerWidth;rc.height=window.innerHeight}
    resizeRipple();
    window.addEventListener('resize',resizeRipple);

    const STAR_COLORS=[
      'rgba(255,255,255,', 'rgba(229,231,235,', 'rgba(209,213,219,',
      'rgba(243,244,246,', 'rgba(156,163,175,',
    ];

    function drawStarShape(ctx,cx,cy,outerR,rotation){
      const innerR=outerR*0.45;
      const spikes=5;
      let rot=Math.PI/2*3+rotation;
      const step=Math.PI/spikes;
      ctx.beginPath();
      ctx.moveTo(cx,cy-outerR);
      for(let i=0;i<spikes;i++){
        let x=cx+Math.cos(rot)*outerR; let y=cy+Math.sin(rot)*outerR;
        ctx.lineTo(x,y); rot+=step;
        x=cx+Math.cos(rot)*innerR; y=cy+Math.sin(rot)*innerR;
        ctx.lineTo(x,y); rot+=step;
      }
      ctx.lineTo(cx,cy-outerR);
      ctx.closePath();
    }

    function spawnStarBurst(x,y,count,power){
      const col=STAR_COLORS[Math.floor(Math.random()*STAR_COLORS.length)];
      for(let i=0;i<count;i++){
        const angle=Math.random()*Math.PI*2;
        const speed=(0.8+Math.random()*2.6)*power;
        stars.push({
          x,y,
          vx:Math.cos(angle)*speed,
          vy:Math.sin(angle)*speed,
          size:(2+Math.random()*4)*power,
          rotation:Math.random()*Math.PI*2,
          rotSpeed:(Math.random()-0.5)*0.15,
          alpha:0.85+Math.random()*0.15,
          decay:0.012+Math.random()*0.018,
          twinklePhase:Math.random()*Math.PI*2,
          color:col,
          drag:0.96+Math.random()*0.02,
        });
      }
    }

    document.addEventListener('click',e=>{
      spawnStarBurst(e.clientX,e.clientY,14,1.0);
    });

    let lastStarTime=0;
    document.addEventListener('mousemove',e=>{
      const now=Date.now();
      if(now-lastStarTime>90){
        lastStarTime=now;
        spawnStarBurst(e.clientX,e.clientY,1,0.4);
      }
    });

    function drawStars(){
      rctx.clearRect(0,0,rc.width,rc.height);
      stars=stars.filter(s=>{
        s.x+=s.vx; s.y+=s.vy;
        s.vx*=s.drag; s.vy*=s.drag;
        s.rotation+=s.rotSpeed;
        s.alpha-=s.decay;
        s.twinklePhase+=0.25;
        if(s.alpha<=0.01) return false;
        const twinkle=0.6+0.4*Math.sin(s.twinklePhase);
        const a=Math.max(0,s.alpha*twinkle);
        rctx.save();
        drawStarShape(rctx,s.x,s.y,s.size,s.rotation);
        rctx.fillStyle=s.color+a+')';
        rctx.shadowColor=s.color+'1)';
        rctx.shadowBlur=s.size*1.5;
        rctx.fill();
        rctx.restore();
        return true;
      });
      requestAnimationFrame(drawStars);
    }
    drawStars();
  }

  const pc=document.getElementById('particle-canvas');
  if(pc){
    const pctx=pc.getContext('2d');
    let particles=[];

    function resizeParticle(){
      pc.width=window.innerWidth;
      pc.height=window.innerHeight;
    }
    resizeParticle();
    window.addEventListener('resize',()=>{resizeParticle();initParticles()});

    const PARTICLE_COLORS=['#FFFFFF','#D1D5DB','#9CA3AF','#E5E7EB','#F3F4F6','#71717A','#6B7280'];

    function initParticles(){
      particles=[];
      const count=Math.floor((pc.width*pc.height)/14000);
      for(let i=0;i<count;i++){
        particles.push({
          x:Math.random()*pc.width,
          y:Math.random()*pc.height,
          r:Math.random()*1.8+0.4,
          vx:(Math.random()-.5)*0.3,
          vy:(Math.random()-.5)*0.3,
          color:PARTICLE_COLORS[Math.floor(Math.random()*PARTICLE_COLORS.length)],
          alpha:Math.random()*0.5+0.1,
        });
      }
    }
    initParticles();

    function drawParticles(){
      pctx.clearRect(0,0,pc.width,pc.height);
      particles.forEach(p=>{
        p.x+=p.vx; p.y+=p.vy;
        if(p.x<0)p.x=pc.width;
        if(p.x>pc.width)p.x=0;
        if(p.y<0)p.y=pc.height;
        if(p.y>pc.height)p.y=0;
        pctx.beginPath();
        pctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        pctx.fillStyle=p.color;
        pctx.globalAlpha=p.alpha;
        pctx.fill();
      });
      pctx.globalAlpha=1;
      for(let i=0;i<particles.length;i++){
        for(let j=i+1;j<particles.length;j++){
          const dx=particles[i].x-particles[j].x;
          const dy=particles[i].y-particles[j].y;
          const dist=Math.sqrt(dx*dx+dy*dy);
          if(dist<90){
            pctx.beginPath();
            pctx.moveTo(particles[i].x,particles[i].y);
            pctx.lineTo(particles[j].x,particles[j].y);
            pctx.strokeStyle='rgba(156,163,175,'+(0.08*(1-dist/90))+')';
            pctx.lineWidth=0.5;
            pctx.stroke();
          }
        }
      }
      requestAnimationFrame(drawParticles);
    }
    drawParticles();
  }

  const revealEls = document.querySelectorAll('.reveal');
  revealEls.forEach((el, gIdx) => {
    const side = (gIdx % 2 === 0) ? 1 : -1;
    const sibs = Array.from(el.parentElement.querySelectorAll('.reveal'));
    const lIdx = Math.max(sibs.indexOf(el), 0);
    const tx = side * (36 + lIdx * 14);
    const ty = 24   + lIdx * 6;
    const tz = -(100 + lIdx * 22);
    const rx = 14   + lIdx * 2.5;
    const ry = side * (10 + lIdx * 2);
    const rz = side * (3  + lIdx * 0.8);
    const sc = Math.max(0.80, 0.90 - lIdx * 0.014);
    el.style.setProperty('--tx', tx  + 'px');
    el.style.setProperty('--ty', ty  + 'px');
    el.style.setProperty('--tz', tz  + 'px');
    el.style.setProperty('--rx', rx  + 'deg');
    el.style.setProperty('--ry', ry  + 'deg');
    el.style.setProperty('--rz', rz  + 'deg');
    el.style.setProperty('--sc', sc.toString());
    if (!el.style.transitionDelay) {
      el.style.transitionDelay = (lIdx * 0.075) + 's';
    }
  });

  const elState = new Map();
  revealEls.forEach(el => elState.set(el, {
    seen: false, prevRatio: 0, prevTop: el.getBoundingClientRect().top,
  }));

  function setState(el, state) {
    const remove = ['visible','exit-up','exit-down'];
    const needsReflow = !el.classList.contains('visible') && state !== 'visible';
    remove.forEach(c => el.classList.remove(c));
    if (needsReflow) void el.offsetWidth;
    if (state !== 'hidden') el.classList.add(state);
  }

  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const el    = entry.target;
      const state = elState.get(el);
      const curTop = entry.boundingClientRect.top;
      const vh     = window.innerHeight;
      if (entry.isIntersecting) {
        el.style.transitionDelay = '0s';
        setState(el, 'visible');
        state.seen = true;
      } else if (state.seen) {
        const exitingUpward = curTop < vh * 0.1;
        if (exitingUpward) {
          setState(el, 'exit-down');
        } else {
          setState(el, 'exit-up');
        }
      }
      state.prevRatio = entry.intersectionRatio;
      state.prevTop   = curTop;
    });
  }, {
    threshold:  [0, 0.08, 0.18],
    rootMargin: '0px 0px -20px 0px',
  });

  revealEls.forEach(el => io.observe(el));

  let lastScrollY = window.scrollY;
  let scrollVel   = 0;
  const vignette  = document.getElementById('depth-vignette');
  function scrollFade() {
    const sy    = window.scrollY;
    const delta = Math.abs(sy - lastScrollY);
    scrollVel   = scrollVel * 0.72 + delta * 0.28;
    lastScrollY = sy;
    const boost = Math.min(scrollVel / 26, 0.42);
    if (vignette) vignette.style.opacity = (0.6 + boost).toFixed(3);
    requestAnimationFrame(scrollFade);
  }
  scrollFade();

  document.querySelectorAll('.btn-primary,.btn-ghost,.nav-pill').forEach(btn=>{
    btn.addEventListener('click',e=>{
      if(!rc) return;
      const rect=btn.getBoundingClientRect();
      const cx=rect.left+rect.width/2;
      const cy=rect.top+rect.height/2;
      const rctx=rc.getContext('2d');
      const col=STAR_COLORS[Math.floor(Math.random()*STAR_COLORS.length)];
      for(let i=0;i<22;i++){
        const angle=Math.random()*Math.PI*2;
        const speed=(0.8+Math.random()*2.6)*1.4;
        stars.push({
          x:cx, y:cy,
          vx:Math.cos(angle)*speed,
          vy:Math.sin(angle)*speed,
          size:(2+Math.random()*4)*1.4,
          rotation:Math.random()*Math.PI*2,
          rotSpeed:(Math.random()-0.5)*0.15,
          alpha:0.85+Math.random()*0.15,
          decay:0.012+Math.random()*0.018,
          twinklePhase:Math.random()*Math.PI*2,
          color:col,
          drag:0.96+Math.random()*0.02,
        });
      }
    });
  });

  document.querySelectorAll('.g-card').forEach(card=>{
    card.addEventListener('mouseenter',e=>{
      if(!rc) return;
      const rect=card.getBoundingClientRect();
      const col=STAR_COLORS[Math.floor(Math.random()*STAR_COLORS.length)];
      for(let i=0;i<6;i++){
        const angle=Math.random()*Math.PI*2;
        const speed=(0.8+Math.random()*2.6)*0.6;
        stars.push({
          x:rect.left+rect.width/2, y:rect.top+rect.height/2,
          vx:Math.cos(angle)*speed,
          vy:Math.sin(angle)*speed,
          size:(2+Math.random()*4)*0.6,
          rotation:Math.random()*Math.PI*2,
          rotSpeed:(Math.random()-0.5)*0.15,
          alpha:0.85+Math.random()*0.15,
          decay:0.012+Math.random()*0.018,
          twinklePhase:Math.random()*Math.PI*2,
          color:col,
          drag:0.96+Math.random()*0.02,
        });
      }
    });
  });
})();
