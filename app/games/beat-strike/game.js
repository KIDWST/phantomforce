(function(){
  "use strict";

  const host=(type,data={})=>parent.postMessage({source:"phantomplay-game",type,...data},"*");
  const DIFFICULTIES={
    starter:{label:"STARTER",bpm:92,beats:72,good:.21,perfect:.085},
    groove:{label:"GROOVE",bpm:112,beats:88,good:.17,perfect:.068},
    rush:{label:"RUSH",bpm:128,beats:96,good:.14,perfect:.055}
  };
  const NOTE_SPEEDS={slow:3.1,standard:2.25,fast:1.65};
  const WORD_BANKS=[
    ["CAT","DOG","SUN","MAP","RED","RUN","FUN","HAT","CUP","KEY","TAP","HIT"],
    ["BEAT","MOVE","GLOW","WAVE","FIRE","GAME","SPIN","ROCK","PLAY","JUMP","DASH","NEON","FAST","STAR","MOON","TYPE","CODE"],
    ["POWER","LIGHT","SOUND","QUEST","SCORE","TRACK","COMBO","STORM","FLASH","SHIFT","BRAVE","FOCUS"]
  ];
  const GAMEPAD_KEYS=["gpUp","gpDown","gpLeft","gpRight","gpA","gpB","gpX","gpY"];
  const GAMEPAD_GLYPH={gpUp:"UP",gpDown:"DN",gpLeft:"LT",gpRight:"RT",gpA:"A",gpB:"B",gpX:"X",gpY:"Y"};
  const COLUMN_COLORS=["#58ffac","#38efc7","#4de8ff","#58b7ff","#8f9cff","#c69cff","#ff79bd","#ff6f82","#ffab62","#ffd166"];
  const COLUMN_RGB=["88,255,172","56,239,199","77,232,255","88,183,255","143,156,255","198,156,255","255,121,189","255,111,130","255,171,98","255,209,102"];
  const KEY_POS={};
  const rows=[
    {keys:"qwertyuiop",left:.0,width:1,row:0},
    {keys:"asdfghjkl",left:.04,width:.92,row:1},
    {keys:"zxcvbnm",left:.10,width:.80,row:2}
  ];
  for(const row of rows){
    [...row.keys].forEach((key,index)=>{
      const norm=row.left+row.width*(index+.5)/row.keys.length;
      KEY_POS[key]={norm,row:row.row,column:Math.max(0,Math.min(9,Math.round(norm*10-.5)))};
    });
  }
  const ALPHABET=Object.keys(KEY_POS);

  let selectedDifficulty="groove",noteSpeedName="standard",guideVisible=true;
  try{
    const d=localStorage.getItem("pf.beatstrike.difficulty"),s=localStorage.getItem("pf.beatstrike.notespeed");
    if(DIFFICULTIES[d])selectedDifficulty=d;
    if(NOTE_SPEEDS[s])noteSpeedName=s;
    guideVisible=localStorage.getItem("pf.beatstrike.showguide")!=="0";
  }catch(err){}
  let cfg=DIFFICULTIES[selectedDifficulty],beatSec=60/cfg.bpm,noteTravelSec=NOTE_SPEEDS[noteSpeedName];
  let soundOn=true,reduced=matchMedia("(prefers-reduced-motion: reduce)").matches,gpEnabled=false,usingGamepadMap=false;

  function makeRandom(seed){
    let s=seed>>>0;
    return function(){
      s|=0;s=(s+0x6d2b79f5)|0;
      let t=Math.imul(s^(s>>>15),1|s);
      t=(t+Math.imul(t^(t>>>7),61|t))^t;
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  }
  function chartStep(mode,progress,wordIndex){
    if(mode==="starter")return progress>.72&&wordIndex%4===3?.75:1;
    if(mode==="groove"){
      if(progress<.3)return 1;
      if(progress<.68)return .75;
      return wordIndex%4===3?.5:.75;
    }
    if(progress<.25)return .75;
    return .5;
  }
  function pickWord(rand,pool,lastWord,lastKey){
    let choices=pool.filter(word=>word!==lastWord&&word[0].toLowerCase()!==lastKey);
    if(!choices.length)choices=pool.filter(word=>word!==lastWord);
    return choices[Math.floor(rand()*choices.length)];
  }
  function generateBeatmap(seed,mode=selectedDifficulty){
    const track=DIFFICULTIES[mode]||DIFFICULTIES.groove;
    const sec=60/track.bpm,rand=makeRandom(seed),notes=[],words=[];
    let beat=6,lastWord="",lastKey="",wordIndex=0;
    while(beat<track.beats-4){
      const progress=beat/track.beats;
      const bank=progress<.3?WORD_BANKS[0]:progress<.7?WORD_BANKS[1]:WORD_BANKS[2];
      const word=pickWord(rand,bank,lastWord,lastKey);
      const step=chartStep(mode,progress,wordIndex),gap=mode==="starter"?1.15:mode==="groove"?.8:.55;
      const needed=word.length*step+gap;
      if(beat+needed>track.beats-2)break;
      const meta={word,index:wordIndex,start:beat*sec,end:(beat+(word.length-1)*step)*sec,noteStart:notes.length,noteEnd:0};
      [...word.toLowerCase()].forEach((key,letterIndex)=>{
        notes.push({
          time:(beat+letterIndex*step)*sec,key,inputKey:key,word,wordIndex,letterIndex,wordLength:word.length,
          resolved:false,judgement:null
        });
      });
      meta.noteEnd=notes.length;words.push(meta);
      lastWord=word;lastKey=word[word.length-1].toLowerCase();wordIndex++;
      beat+=needed;
    }
    notes.words=words;notes.duration=track.beats*sec;
    return notes;
  }
  function addGamepadInputs(chart){
    let last="";
    chart.forEach((note,index)=>{
      let slot=(KEY_POS[note.key].column+note.letterIndex+note.wordIndex*2)%GAMEPAD_KEYS.length;
      let key=GAMEPAD_KEYS[slot];
      if(key===last)key=GAMEPAD_KEYS[(slot+3)%GAMEPAD_KEYS.length];
      note.inputKey=key;last=key;
    });
  }

  class SynthTrack{
    constructor(context){
      this.ctx=context;this.timer=0;this.nextTick=0;this.startRef=null;this.tickDur=beatSec/4;
      this.master=context.createGain();this.master.gain.value=soundOn?.44:0;this.master.connect(context.destination);
      const length=Math.floor(context.sampleRate*.18),buffer=context.createBuffer(1,length,context.sampleRate),data=buffer.getChannelData(0);
      for(let i=0;i<length;i++)data[i]=Math.random()*2-1;
      this.noise=buffer;
    }
    setVolume(){this.master.gain.setTargetAtTime(soundOn?.44:0,this.ctx.currentTime,.025)}
    osc(time,freq,duration,type,gain,endFreq=0){
      if(!soundOn)return;
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,time);
      if(endFreq)o.frequency.exponentialRampToValueAtTime(endFreq,time+duration);
      g.gain.setValueAtTime(.0001,time);g.gain.linearRampToValueAtTime(gain,time+.004);g.gain.exponentialRampToValueAtTime(.0001,time+duration);
      o.connect(g).connect(this.master);o.start(time);o.stop(time+duration+.02);
    }
    noiseHit(time,duration,gain,frequency){
      if(!soundOn)return;
      const src=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
      src.buffer=this.noise;filter.type="highpass";filter.frequency.value=frequency;
      g.gain.setValueAtTime(gain,time);g.gain.exponentialRampToValueAtTime(.0001,time+duration);
      src.connect(filter).connect(g).connect(this.master);src.start(time);src.stop(time+duration+.02);
    }
    scheduleTick(time,tick){
      const sub=tick%4,beat=Math.floor(tick/4),barBeat=beat%4;
      const bass=[55,65.41,73.42,49][Math.floor(beat/4)%4];
      const lead=[440,523.25,659.25,587.33,523.25,659.25,783.99,659.25];
      if(sub===0){
        this.osc(time,bass,beatSec*.72,"triangle",barBeat===0?.15:.1);
        if(barBeat===0||barBeat===2)this.osc(time,125,.12,"sine",.3,44);
        if(barBeat===1||barBeat===3)this.noiseHit(time,.105,.13,1100);
      }
      if(sub===0||sub===2)this.noiseHit(time,.034,sub===0?.045:.028,5200);
      if(sub===2)this.osc(time,lead[beat%lead.length],beatSec*.28,"square",.024);
    }
    tick(){
      const horizon=this.ctx.currentTime+.15;
      while(this.startRef.value+this.nextTick*this.tickDur<horizon){
        const time=this.startRef.value+this.nextTick*this.tickDur;
        if(time>=this.ctx.currentTime)this.scheduleTick(time,this.nextTick);
        this.nextTick++;
      }
    }
    start(fromSongTime,startRef){
      this.stop();this.startRef=startRef;this.tickDur=beatSec/4;this.nextTick=Math.ceil(fromSongTime/this.tickDur);
      this.tick();this.timer=setInterval(()=>this.tick(),25);
    }
    stop(){if(this.timer)clearInterval(this.timer);this.timer=0}
    feedback(kind){
      const now=this.ctx.currentTime;
      if(kind==="perfect"){this.osc(now,1046.5,.09,"triangle",.11);this.osc(now+.035,1318.5,.08,"square",.04)}
      else if(kind==="good")this.osc(now,783.99,.085,"triangle",.085);
      else this.osc(now,145,.11,"sine",.04,90);
    }
  }

  const canvas=document.getElementById("stage"),ctx=canvas.getContext("2d");
  const scoreEl=document.querySelector("[data-score]"),streakEl=document.querySelector("[data-streak]"),accEl=document.querySelector("[data-acc]"),trackEl=document.querySelector("[data-track]");
  const startOverlay=document.querySelector("[data-start-overlay]"),pauseOverlay=document.querySelector("[data-pause-overlay]"),startBtn=document.querySelector("[data-start-btn]");
  const startTitle=document.querySelector("[data-start-title]"),startCopy=document.querySelector("[data-start-copy]"),keyboardEl=document.querySelector("[data-keyboard]"),feedbackEl=document.querySelector("[data-feedback]");
  const difficultyBtns=[...document.querySelectorAll("[data-difficulty]")],speedBtns=[...document.querySelectorAll("[data-speed]")],guideBtn=document.querySelector("[data-guide-toggle]");
  const keyEls={};document.querySelectorAll("[data-key]").forEach(el=>keyEls[el.dataset.key]=el);
  let audioCtx=null,synth=null,songStartRef={value:0},notes=[],chartWords=[];
  let running=false,paused=false,pausedSongTime=0,score=0,streak=0,bestStreak=0,resolvedCount=0,hitCount=0,perfectCount=0,lastFrame=0,lastProgress=-1,lastMissTone=-1;
  const sparks=[];let feedbackTimer=0;

  function persist(key,value){try{localStorage.setItem(key,value)}catch(err){}}
  function setDifficulty(name,save=true){
    if(!DIFFICULTIES[name])return;
    selectedDifficulty=name;cfg=DIFFICULTIES[name];beatSec=60/cfg.bpm;
    difficultyBtns.forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.difficulty===name)));
    trackEl.textContent=cfg.label;
    if(save)persist("pf.beatstrike.difficulty",name);
  }
  function setNoteSpeed(name,save=true){
    if(!NOTE_SPEEDS[name])return;
    noteSpeedName=name;noteTravelSec=NOTE_SPEEDS[name];
    speedBtns.forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.speed===name)));
    if(save)persist("pf.beatstrike.notespeed",name);
  }
  function applyGuide(save=true){
    keyboardEl.dataset.hidden=guideVisible?"0":"1";
    guideBtn.setAttribute("aria-pressed",String(guideVisible));guideBtn.textContent=guideVisible?"Shown":"Hidden";
    if(save)persist("pf.beatstrike.showguide",guideVisible?"1":"0");
  }
  difficultyBtns.forEach(b=>b.addEventListener("click",()=>setDifficulty(b.dataset.difficulty)));
  speedBtns.forEach(b=>b.addEventListener("click",()=>setNoteSpeed(b.dataset.speed)));
  guideBtn.addEventListener("click",()=>{guideVisible=!guideVisible;applyGuide()});
  setDifficulty(selectedDifficulty,false);setNoteSpeed(noteSpeedName,false);applyGuide(false);

  for(const [key,el] of Object.entries(keyEls)){
    const color=COLUMN_COLORS[KEY_POS[key].column];el.style.setProperty("--key-color",color);
    el.addEventListener("pointerdown",event=>{event.preventDefault();pressInput(key);el.setPointerCapture?.(event.pointerId)});
    el.addEventListener("pointerup",event=>{event.preventDefault();releaseInput(key)});
    el.addEventListener("pointercancel",()=>releaseInput(key));
  }

  function resize(){
    const dpr=Math.min(2.25,devicePixelRatio||1);
    canvas.width=Math.round(innerWidth*dpr);canvas.height=Math.round(innerHeight*dpr);
    canvas.style.width=innerWidth+"px";canvas.style.height=innerHeight+"px";
    ctx.setTransform(dpr,0,0,dpr,0,0);
    if(!running)render(0,0);
  }
  addEventListener("resize",resize,{passive:true});

  function board(){
    const width=Math.min(900,innerWidth*.94),left=(innerWidth-width)/2;
    const guideH=guideVisible?keyboardEl.getBoundingClientRect().height+20:34;
    const hitY=Math.max(innerHeight*.58,Math.min(innerHeight*.86,innerHeight-guideH-18));
    const topY=Math.min(hitY-120,Math.max(112,innerHeight*.18));
    return{width,left,right:left+width,center:innerWidth/2,hitY,topY};
  }
  function targetFor(key,b){
    const pos=KEY_POS[key],x=b.left+pos.norm*b.width,y=b.hitY+(pos.row-1)*11;
    return{x,y,pos};
  }
  function songTime(){return paused?pausedSongTime:audioCtx.currentTime-songStartRef.value}
  function accuracy(){return resolvedCount?Math.round(hitCount/resolvedCount*100):100}
  function updateHud(){
    scoreEl.textContent=String(Math.round(score));streakEl.textContent=String(streak);accEl.textContent=accuracy()+"%";trackEl.textContent=cfg.label;
  }
  function showFeedback(textValue,kind){
    feedbackEl.textContent=textValue;feedbackEl.className="feedback show "+kind;
    clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>feedbackEl.className="feedback",420);
  }
  function flashKey(key){
    const el=keyEls[key];if(!el)return;
    el.classList.add("active");setTimeout(()=>el.classList.remove("active"),100);
  }
  function spawnSpark(note,kind){
    const b=board(),target=targetFor(note.key,b);
    sparks.push({x:target.x,y:target.y,life:0,max:reduced?.16:.42,color:kind==="perfect"?"88,255,172":kind==="good"?"77,232,255":"255,91,131"});
  }
  function resolveNote(note,judgement,automatic=false){
    if(note.resolved)return;
    note.resolved=true;note.judgement=judgement;resolvedCount++;
    if(judgement){
      hitCount++;streak++;bestStreak=Math.max(bestStreak,streak);
      if(judgement==="perfect"){perfectCount++;score+=300+Math.min(300,streak*5)}
      else score+=150+Math.min(180,streak*3);
      showFeedback(judgement==="perfect"?"PERFECT":"GOOD",judgement);synth?.feedback(judgement);
    }else{
      streak=0;
      if(!automatic||songTime()-lastMissTone>.22){synth?.feedback("miss");lastMissTone=songTime()}
      showFeedback("MISS","miss");
    }
    spawnSpark(note,judgement||"miss");updateHud();
    const progress=Math.min(99,Math.round(resolvedCount/Math.max(1,notes.length)*100));
    host("score",{score:Math.round(score),progress,state:{streak,judgement,word:note.word,difficulty:selectedDifficulty}});
  }
  function judge(delta){
    const abs=Math.abs(delta);if(abs<=cfg.perfect)return"perfect";if(abs<=cfg.good)return"good";return null;
  }
  function pressInput(input){
    if(!running||paused)return;
    if(ALPHABET.includes(input))flashKey(input);
    const now=songTime();let best=null,bestDelta=Infinity;
    for(const note of notes){
      if(note.resolved)continue;
      if(note.inputKey!==input&&note.key!==input)continue;
      const delta=now-note.time;
      if(Math.abs(delta)<Math.abs(bestDelta)&&Math.abs(delta)<=cfg.good+.07){best=note;bestDelta=delta}
    }
    if(best)resolveNote(best,judge(bestDelta));
  }
  function releaseInput(input){if(ALPHABET.includes(input))keyEls[input]?.classList.remove("active")}
  function onKeyDown(event){
    if(event.repeat)return;
    if(event.key==="Escape"){event.preventDefault();setPaused(!paused);return}
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    const key=event.key.toLowerCase();
    if(ALPHABET.includes(key)){event.preventDefault();pressInput(key)}
  }
  function onKeyUp(event){releaseInput(event.key.toLowerCase())}

  function autoMiss(now){
    for(const note of notes)if(!note.resolved&&now>note.time+cfg.good+.025)resolveNote(note,null,true);
  }
  function currentWord(now){
    for(const meta of chartWords){
      const group=notes.slice(meta.noteStart,meta.noteEnd);
      if(group.some(note=>!note.resolved)||now<meta.end+.3)return meta;
    }
    return chartWords[chartWords.length-1]||null;
  }
  function rounded(x,y,w,h,r){
    ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else ctx.rect(x,y,w,h);
  }
  function renderWordRail(now,b){
    const meta=currentWord(now);if(!meta)return;
    const group=notes.slice(meta.noteStart,meta.noteEnd),letterW=Math.min(42,Math.max(27,b.width/(meta.word.length+7))),gap=5,total=meta.word.length*letterW+(meta.word.length-1)*gap;
    const y=Math.max(72,b.topY-52),start=b.center-total/2;
    ctx.textAlign="center";ctx.textBaseline="middle";ctx.font="900 10px ui-monospace,monospace";ctx.fillStyle="#8fa59d";ctx.fillText("CURRENT WORD",b.center,y-16);
    group.forEach((note,index)=>{
      const x=start+index*(letterW+gap),done=note.resolved&&note.judgement;
      ctx.fillStyle=done?"#123a2a":note.resolved?"#32121b":"#0b1217";
      rounded(x,y,letterW,34,6);ctx.fill();
      ctx.strokeStyle=done?"#58ffac":note.resolved?"#ff5b83":"#ffffff35";ctx.lineWidth=1.5;ctx.stroke();
      ctx.fillStyle=done?"#bfffdc":note.resolved?"#ffc0cf":"#effff6";ctx.font="900 17px ui-monospace,monospace";ctx.fillText(note.key.toUpperCase(),x+letterW/2,y+18);
    });
    const next=chartWords[meta.index+1];
    if(next){ctx.font="800 10px ui-monospace,monospace";ctx.fillStyle="#778c85";ctx.fillText("NEXT "+next.word,b.center,y+48)}
  }
  function render(now,visualDt){
    const dpr=Math.min(2.25,devicePixelRatio||1);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,innerWidth,innerHeight);
    const b=board(),gradient=ctx.createLinearGradient(0,0,0,innerHeight);
    gradient.addColorStop(0,"#09131c");gradient.addColorStop(.58,"#080a12");gradient.addColorStop(1,"#030407");
    ctx.fillStyle=gradient;ctx.fillRect(0,0,innerWidth,innerHeight);

    ctx.fillStyle="#05080cb8";ctx.beginPath();ctx.moveTo(b.center-b.width*.09,b.topY);ctx.lineTo(b.center+b.width*.09,b.topY);ctx.lineTo(b.right,b.hitY+20);ctx.lineTo(b.left,b.hitY+20);ctx.closePath();ctx.fill();
    for(let column=0;column<10;column++){
      const targetX=b.left+(column+.5)/10*b.width,topX=b.center+(targetX-b.center)*.18;
      ctx.strokeStyle=`rgba(${COLUMN_RGB[column]},0.19)`;ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(topX,b.topY);ctx.lineTo(targetX,b.hitY+18);ctx.stroke();
    }

    if(running){
      const firstBeat=Math.ceil(now/beatSec);
      for(let beat=firstBeat;beat*beatSec<now+noteTravelSec;beat++){
        const progress=1-(beat*beatSec-now)/noteTravelSec;if(progress<0)continue;
        const y=b.topY+(b.hitY-b.topY)*progress;
        const half=b.width*(.09+.41*progress);
        ctx.strokeStyle=beat%4===0?"#ffffff25":"#ffffff10";ctx.lineWidth=beat%4===0?1.5:1;
        ctx.beginPath();ctx.moveTo(b.center-half,y);ctx.lineTo(b.center+half,y);ctx.stroke();
      }
    }

    const goodPx=cfg?(cfg.good/noteTravelSec)*(b.hitY-b.topY):10,perfectPx=cfg?(cfg.perfect/noteTravelSec)*(b.hitY-b.topY):4;
    ctx.fillStyle="#ffd16613";ctx.fillRect(b.left,b.hitY-goodPx,b.width,goodPx*2);
    ctx.fillStyle="#58ffac18";ctx.fillRect(b.left,b.hitY-perfectPx,b.width,perfectPx*2);
    ctx.strokeStyle="#ffd166";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(b.left,b.hitY);ctx.lineTo(b.right,b.hitY);ctx.stroke();

    renderWordRail(now,b);
    const upcoming=new Set();
    for(const note of notes){
      const delta=note.time-now;
      if(delta>.9||delta<-.1)continue;
      if(!note.resolved)upcoming.add(note.key);
    }
    for(const key of upcoming){
      const target=targetFor(key,b),color=COLUMN_COLORS[target.pos.column];
      ctx.beginPath();ctx.arc(target.x,target.y,15,0,Math.PI*2);ctx.strokeStyle=color;ctx.globalAlpha=.62;ctx.lineWidth=2;ctx.stroke();ctx.globalAlpha=1;
    }

    const radius=Math.max(15,Math.min(22,innerWidth/32));
    for(const note of notes){
      const delta=note.time-now;
      if(delta>noteTravelSec||delta<-.24)continue;
      if(note.resolved&&note.judgement&&delta<-.08)continue;
      const progress=Math.max(0,Math.min(1.06,1-delta/noteTravelSec));
      const target=targetFor(note.key,b),spread=.18+.82*Math.min(1,progress);
      const x=b.center+(target.x-b.center)*spread,y=b.topY+(target.y-b.topY)*progress,scale=.58+.42*Math.min(1,progress);
      const w=radius*2.15*scale,h=radius*1.72*scale,color=COLUMN_COLORS[target.pos.column];
      ctx.save();ctx.translate(x,y);
      if(!reduced){ctx.shadowColor=color;ctx.shadowBlur=note.resolved?6:15}
      ctx.fillStyle=note.resolved?(note.judgement?"#163528":"#3b111c"):color;
      rounded(-w/2,-h/2,w,h,Math.min(8,h*.28));ctx.fill();ctx.shadowBlur=0;
      ctx.strokeStyle=note.resolved&&!note.judgement?"#ff5b83":"#ffffffb0";ctx.lineWidth=1.5;ctx.stroke();
      ctx.fillStyle=note.resolved?"#f1fff7":"#04100d";ctx.font=`900 ${Math.max(12,17*scale)}px ui-monospace,monospace`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(note.key.toUpperCase(),0,-1);
      if(usingGamepadMap){
        ctx.fillStyle=note.resolved?"#a8b9b1":"#04100d";ctx.font="900 7px ui-monospace,monospace";ctx.fillText(GAMEPAD_GLYPH[note.inputKey],0,h*.32);
      }
      ctx.restore();
    }
    for(let i=sparks.length-1;i>=0;i--){
      const spark=sparks[i];spark.life+=visualDt;
      if(spark.life>=spark.max){sparks.splice(i,1);continue}
      const alpha=1-spark.life/spark.max,r=17+spark.life*75;
      ctx.beginPath();ctx.arc(spark.x,spark.y,r,0,Math.PI*2);ctx.strokeStyle=`rgba(${spark.color},${alpha})`;ctx.lineWidth=3;ctx.stroke();
      if(!reduced){for(let p=0;p<5;p++){const a=p*Math.PI*2/5;ctx.fillStyle=`rgba(${spark.color},${alpha*.8})`;ctx.fillRect(spark.x+Math.cos(a)*r,spark.y+Math.sin(a)*r,3,3)}}
    }
  }

  function frame(timestamp){
    if(!running)return;
    const visualDt=Math.min(.033,Math.max(0,(timestamp-lastFrame)/1000));lastFrame=timestamp;
    if(!paused){
      const now=songTime();autoMiss(now);render(now,visualDt);
      const progress=Math.min(99,Math.floor(now/(cfg.beats*beatSec)*100));
      if(progress!==lastProgress&&progress%2===0){lastProgress=progress;host("progress",{score:Math.round(score),progress,state:{streak,accuracy:accuracy(),difficulty:selectedDifficulty}})}
      if(now>cfg.beats*beatSec+1.2){finish();return}
    }
    requestAnimationFrame(frame);
  }
  function finish(){
    running=false;synth?.stop();
    const finalAccuracy=accuracy();
    startTitle.textContent=finalAccuracy>=90?"TRACK CLEAR":"SONG COMPLETE";
    startCopy.textContent=`Score ${Math.round(score)} / ${finalAccuracy}% accuracy / best streak ${bestStreak} / ${perfectCount} perfect hits.`;
    startBtn.textContent="PLAY AGAIN";startOverlay.hidden=false;
    host("complete",{score:Math.round(score),progress:100,state:{accuracy:finalAccuracy,bestStreak,difficulty:selectedDifficulty}});
  }
  function start(){
    if(running)synth?.stop();
    cfg=DIFFICULTIES[selectedDifficulty];beatSec=60/cfg.bpm;noteTravelSec=NOTE_SPEEDS[noteSpeedName];
    audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
    audioCtx.resume();synth=new SynthTrack(audioCtx);
    notes=generateBeatmap(1337,selectedDifficulty);chartWords=notes.words||[];
    usingGamepadMap=gpEnabled&&!!gpPad();if(usingGamepadMap)addGamepadInputs(notes);
    score=0;streak=0;bestStreak=0;resolvedCount=0;hitCount=0;perfectCount=0;lastProgress=-1;lastMissTone=-1;sparks.length=0;
    running=true;paused=false;pauseOverlay.hidden=true;startOverlay.hidden=true;feedbackEl.className="feedback";
    songStartRef={value:audioCtx.currentTime+.7};synth.start(0,songStartRef);lastFrame=performance.now();updateHud();
    host("progress",{score:0,progress:0,state:{streak:0,accuracy:100,difficulty:selectedDifficulty}});
    requestAnimationFrame(frame);
  }
  function setPaused(next){
    if(!running||paused===next)return;
    paused=next;pauseOverlay.hidden=!paused;
    if(paused){
      pausedSongTime=audioCtx.currentTime-songStartRef.value;synth.stop();audioCtx.suspend();
    }else{
      audioCtx.resume().then(()=>{songStartRef.value=audioCtx.currentTime-pausedSongTime;synth.start(pausedSongTime,songStartRef);lastFrame=performance.now()});
    }
    host("paused",{paused});
  }

  document.addEventListener("keydown",onKeyDown);
  document.addEventListener("keyup",onKeyUp);
  document.querySelector("[data-pause-btn]").addEventListener("click",()=>setPaused(true));
  document.querySelector("[data-resume-btn]").addEventListener("click",()=>setPaused(false));
  startBtn.addEventListener("click",start);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)setPaused(true)});

  const gpPrev={};
  function gpPad(){const pads=navigator.getGamepads?navigator.getGamepads():[];for(const pad of pads)if(pad)return pad;return null}
  function pollGamepad(){
    if(usingGamepadMap&&running&&!paused){
      const pad=gpPad();
      if(pad){
        const b=pad.buttons,ax=pad.axes[0]||0,ay=pad.axes[1]||0;
        const state={
          gpUp:!!(b[12]?.pressed)||ay<-.5,gpDown:!!(b[13]?.pressed)||ay>.5,gpLeft:!!(b[14]?.pressed)||ax<-.5,gpRight:!!(b[15]?.pressed)||ax>.5,
          gpA:!!(b[0]?.pressed),gpB:!!(b[1]?.pressed),gpX:!!(b[2]?.pressed),gpY:!!(b[3]?.pressed)
        };
        for(const key of GAMEPAD_KEYS){if(state[key]&&!gpPrev[key])pressInput(key);gpPrev[key]=state[key]}
      }
    }
    requestAnimationFrame(pollGamepad);
  }
  requestAnimationFrame(pollGamepad);

  addEventListener("message",event=>{
    const data=event.data;if(!data||data.source!=="phantomplay-host")return;
    if(data.type==="settings"){
      if("gamepad" in data)gpEnabled=!!data.gamepad;
      if("sound" in data){soundOn=!!data.sound;synth?.setVolume()}
      if("reducedMotion" in data){reduced=!!data.reducedMotion;document.body.classList.toggle("reduced",reduced)}
    }else if(data.type==="pause")setPaused(true);
    else if(data.type==="resume")setPaused(false);
    else if(data.type==="restart")start();
    else if(data.type==="exit"){if(running){running=false;synth?.stop()}}
  });

  resize();render(0,0);host("ready");
  window.__beatStrikeDebug={
    generateBeatmap,
    get score(){return score},
    get resolvedCount(){return resolvedCount},
    get creditedCount(){return hitCount},
    get difficulty(){return selectedDifficulty}
  };
})();
