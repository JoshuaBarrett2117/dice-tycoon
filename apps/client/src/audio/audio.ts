// @ts-nocheck
/**
 * 程序化合成的占位音频（原创）：对局 BGM + 24 个音效。
 * 正式版替换为外包作曲的 OGG/M4A 资源，接口保持不变即可。
 */
export type SfxName = 'click'|'turn'|'charge'|'zone'|'dice'|'diceLand'|'hit'|'miss'|'double'|'hop'|'land'|'coin'|'cash'|'build'|'salary'|'ouch'|'pay'|'gain'|'sheet'|'takeover'|'island'|'card'|'tax'|'win';
export interface AudioApi { play(n: SfxName, ...a: number[]): void; unlock(): void; startBGM(): void; stopBGM(): void; setMood(m: 'normal'|'tense'): void; toggleMusic(): boolean; toggleSfx(): boolean }
const AU_IMPL=(()=>{const AC=window.AudioContext||window.webkitAudioContext;const ctx=new AC();
 const master=ctx.createGain();master.gain.value=.9;const comp=ctx.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=4;
 master.connect(comp);comp.connect(ctx.destination);
 const music=ctx.createGain();music.gain.value=.42;const sfx=ctx.createGain();sfx.gain.value=.8;
 // light room reverb via feedback delays
 const rv=ctx.createGain();rv.gain.value=.18;[0.043,0.071,0.097].forEach((d,i)=>{const dl=ctx.createDelay();dl.delayTime.value=d;const fb=ctx.createGain();fb.gain.value=.38;const lp=ctx.createBiquadFilter();lp.frequency.value=3200;rv.connect(dl);dl.connect(lp);lp.connect(fb);fb.connect(dl);lp.connect(master)});
 music.connect(master);sfx.connect(master);music.connect(rv);sfx.connect(rv);
 const rec=ctx.createMediaStreamDestination();comp.connect(rec);
 const nb=(()=>{const b=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return b})();
 const hz=m=>440*Math.pow(2,(m-69)/12);
 function env(g,t,a,peak,dec,sus=0.0001){g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(Math.max(sus,0.0001),t+a+dec)}
 function osc(type,f,t,dur,peak,out,a=.004,dec){const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(f,t);env(g,t,a,peak,dec||dur);o.connect(g);g.connect(out);o.start(t);o.stop(t+(dec||dur)+.05);return o}
 function noise(t,dur,peak,out,type='bandpass',f=2000,q=1,a=.002){const s=ctx.createBufferSource();s.buffer=nb;const fl=ctx.createBiquadFilter();fl.type=type;fl.frequency.setValueAtTime(f,t);fl.Q.value=q;const g=ctx.createGain();env(g,t,a,peak,dur);s.connect(fl);fl.connect(g);g.connect(out);s.start(t,Math.random()*.5);s.stop(t+dur+.05);return fl}
 // instruments
 const I={
  marimba(m,t,v=.5,out=music){const f=hz(m);osc('sine',f,t,0,v,out,.003,.55);osc('sine',f*4,t,0,v*.22,out,.002,.08);osc('triangle',f*2,t,0,v*.12,out,.002,.18)},
  pizz(m,t,v=.25,out=music){const f=hz(m);const o=ctx.createOscillator(),g=ctx.createGain(),lp=ctx.createBiquadFilter();o.type='sawtooth';o.frequency.value=f;lp.type='lowpass';lp.frequency.setValueAtTime(f*6,t);lp.frequency.exponentialRampToValueAtTime(f*1.2,t+.18);env(g,t,.004,v,.22);o.connect(lp);lp.connect(g);g.connect(out);o.start(t);o.stop(t+.3)},
  bass(m,t,v=.5,dur=.28,out=music){const f=hz(m);osc('triangle',f,t,0,v,out,.006,dur);osc('sine',f/2,t,0,v*.6,out,.006,dur)},
  bell(m,t,v=.3,out=sfx,dec=.9){const f=hz(m);const c=ctx.createOscillator(),md=ctx.createOscillator(),mg=ctx.createGain(),g=ctx.createGain();c.frequency.value=f;md.frequency.value=f*3.5;mg.gain.setValueAtTime(f*2.2,t);mg.gain.exponentialRampToValueAtTime(1,t+dec);md.connect(mg);mg.connect(c.frequency);env(g,t,.002,v,dec);c.connect(g);g.connect(out);c.start(t);md.start(t);c.stop(t+dec+.05);md.stop(t+dec+.05)},
  brass(m,t,dur,v=.22,out=sfx){const f=hz(m);[0,-7,6].forEach(dt=>{const o=ctx.createOscillator(),g=ctx.createGain(),lp=ctx.createBiquadFilter();o.type='sawtooth';o.frequency.value=f;o.detune.value=dt;lp.type='lowpass';lp.frequency.setValueAtTime(f*1.5,t);lp.frequency.linearRampToValueAtTime(f*5,t+.06);lp.frequency.exponentialRampToValueAtTime(f*2.5,t+dur);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(v/3,t+.03);g.gain.setValueAtTime(v/3,t+dur*.7);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(lp);lp.connect(g);g.connect(out);o.start(t);o.stop(t+dur+.05)})},
  kick(t,v=.6,out=music){const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.setValueAtTime(140,t);o.frequency.exponentialRampToValueAtTime(48,t+.12);env(g,t,.002,v,.18);o.connect(g);g.connect(out);o.start(t);o.stop(t+.25)},
  hat(t,v=.06,out=music){noise(t,.04,v,out,'highpass',8000,.7)},
  clap(t,v=.16,out=music){noise(t,.12,v,out,'bandpass',1600,.9);noise(t+.012,.1,v*.7,out,'bandpass',1300,.9)},
  wood(m,t,v=.3,out=sfx){const f=hz(m);osc('sine',f,t,0,v,out,.001,.06);noise(t,.02,v*.4,out,'bandpass',f*2,6)},
  shaker(t,v=.05,out=music){noise(t,.05,v,out,'bandpass',6000,1.5,.01)}
 };
 // ---------- BGM: bright island-travel bounce, F major, 126 BPM, 16 bars ----------
 const BPM=126,SP=60/BPM/2; // eighth note
 const CH=[[53,[65,69,72]],[50,[62,65,69]],[46,[62,65,70]],[48,[64,67,70]],[53,[65,69,72]],[57,[64,69,73]],[50,[62,65,69]],[48,[64,67,70]]]; // F Dm Bb C | F A Dm C
 // melody: [eighth index within 4-bar phrase(0..31), midi, len in eighths]
 const MA=[[0,72,2],[2,77,1],[3,76,1],[4,77,2],[6,79,2],[8,81,3],[11,79,1],[12,77,2],[14,74,2],[16,74,2],[18,77,1],[19,76,1],[20,74,2],[22,72,2],[24,70,1],[25,72,1],[26,74,1],[27,76,1],[28,79,4]];
 const MB=[[0,81,2],[2,79,1],[3,77,1],[4,79,2],[6,81,2],[8,82,3],[11,81,1],[12,79,2],[14,77,2],[16,76,2],[18,77,1],[19,79,1],[20,81,2],[22,76,2],[24,74,1],[25,76,1],[26,77,1],[27,79,1],[28,77,4]];
 let on=true,sfxOn=true,next=0,step=0,timer=null,mood='normal';
 function schedule(){while(next<ctx.currentTime+.25){const s=step%128,bar=Math.floor(s/8),e=s%8,t=next;const [root,tri]=CH[bar%8];
   // drums
   if(e===0||e===4)I.kick(t,.5);if(e===2||e===6)I.clap(t,.1);I.hat(t,e%2?.035:.06);if(mood==='tense'&&e%2)I.shaker(t,.06);
   // bass oom-pah
   if(e===0)I.bass(root,t,.42);if(e===3)I.bass(root+7,t,.28,.16);if(e===4)I.bass(root+12,t,.32);if(e===6)I.bass(root+7,t,.3);
   // pizz chord stabs on offbeats
   if(e===2||e===6){tri.forEach(n=>I.pizz(n-12,t,.07))}
   // melody (A A' B A'') with variation
   const ph=Math.floor(s/32),pos=s%32,M=(ph===2)?MB:MA;
   M.forEach(([i,n,l])=>{if(i===pos){const nn=(ph===1&&i>=28)?n-2:(ph===3&&i>=28)?77:n;I.marimba(nn,t,.34);if(ph>=2)I.marimba(nn-12,t,.12)}});
   // sparkle every 4 bars
   if(pos===0)I.bell(84,t,.04,music,1.4);
   next+=SP;step++}}
 function startBGM(){if(timer)return;next=ctx.currentTime+.08;step=0;timer=setInterval(schedule,25)}
 function stopBGM(){clearInterval(timer);timer=null}
 const T=()=>ctx.currentTime+.005;
 const S={
  click(){const t=T();I.wood(84,t,.25);},
  turn(){const t=T();I.bell(84,t,.18);I.bell(88,t+.12,.18)},
  charge(){const t=T();osc('triangle',hz(60),t,0,.08,sfx,.02,.3)},
  zone(i){const t=T();I.wood(72+i*4,t,.22);I.bell(84+i*4,t,.05,sfx,.2)},
  dice(){const t0=T();for(let i=0;i<9;i++){const t=t0+i*.075+Math.random()*.02;noise(t,.035,.35-.025*i,sfx,'bandpass',2400+Math.random()*1800,3);I.wood(79+Math.floor(Math.random()*8),t,.08)}},
  diceLand(){const t=T();noise(t,.05,.4,sfx,'bandpass',1800,2);I.wood(67,t,.35);I.wood(74,t+.06,.25)},
  hit(){const t=T();[72,76,79,84].forEach((n,i)=>I.bell(n,t+i*.06,.14,sfx,.5))},
  miss(){const t=T();I.marimba(62,t,.3,sfx);I.marimba(58,t+.13,.3,sfx)},
  double(){const t=T();I.brass(65,t,.14);I.brass(69,t+.12,.14);I.brass(72,t+.24,.14);I.brass(77,t+.36,.45);I.bell(89,t+.36,.12)},
  hop(i){const t=T();const f=hz(67+Math.min(i,10));const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(f*.7,t);o.frequency.exponentialRampToValueAtTime(f*1.35,t+.09);env(g,t,.004,.22,.14);o.connect(g);g.connect(sfx);o.start(t);o.stop(t+.2);I.wood(79+(i%2)*5,t+.2,.12)},
  land(){const t=T();noise(t,.12,.22,sfx,'lowpass',500,.7);I.marimba(65,t,.25,sfx)},
  coin(){const t=T();I.bell(95,t,.08,sfx,.35);I.bell(100,t+.06,.08,sfx,.45)},
  cash(){const t=T();noise(t,.08,.25,sfx,'highpass',3000,.7);I.bell(88,t+.05,.16,sfx,.6);I.bell(93,t+.05,.12,sfx,.6);I.bell(100,t+.12,.1,sfx,.8)},
  build(){const t=T();I.kick(t,.6,sfx);noise(t,.2,.25,sfx,'lowpass',700,.8);[72,76,79,84,88].forEach((n,i)=>I.marimba(n,t+.12+i*.055,.22,sfx))},
  salary(){const t=T();[79,84,88,91].forEach((n,i)=>I.bell(n,t+i*.07,.12,sfx,.5))},
  ouch(){const t=T();I.brass(62,t,.18,.18);I.brass(57,t+.2,.4,.18)},
  pay(){const t=T();[84,79,76,72].forEach((n,i)=>I.marimba(n,t+i*.07,.2,sfx))},
  gain(){const t=T();[76,79,84].forEach((n,i)=>I.bell(n,t+i*.05,.1,sfx,.4))},
  sheet(){const t=T();const f=noise(t,.28,.12,sfx,'bandpass',600,1.2,.08);f.frequency.exponentialRampToValueAtTime(3500,t+.25)},
  takeover(){const t=T();I.brass(60,t,.12,.25);I.brass(60,t+.14,.12,.25);I.brass(67,t+.28,.5,.25);I.kick(t+.28,.6,sfx)},
  island(){const t=T();const o=ctx.createOscillator(),g=ctx.createGain();o.type='triangle';o.frequency.setValueAtTime(hz(72),t);o.frequency.exponentialRampToValueAtTime(hz(55),t+.7);env(g,t,.01,.25,.8);o.connect(g);g.connect(sfx);o.start(t);o.stop(t+.9)},
  card(){const t=T();noise(t,.12,.15,sfx,'bandpass',4000,1);[79,83,86,91].forEach((n,i)=>I.bell(n,t+.05+i*.05,.09,sfx,.5))},
  tax(){const t=T();I.marimba(57,t,.3,sfx);I.marimba(53,t+.15,.3,sfx);I.bass(41,t+.3,.4,.4,sfx)},
  win(){const t=T();[[65,0],[69,.15],[72,.3],[77,.45]].forEach(([n,d])=>I.brass(n,t+d,.18,.24));I.brass(77,t+.65,.9,.26);I.brass(81,t+.65,.9,.2);[89,93,96].forEach((n,i)=>I.bell(n,t+.65+i*.08,.12))}
 };
 function play(n,...a){if(!sfxOn)return;if(ctx.state!=='running')ctx.resume();try{S[n](...a)}catch(e){}}
 function unlock(){if(ctx.state!=='running')ctx.resume();if(on)startBGM()}
 return {ctx,rec,play,unlock,startBGM,stopBGM,setMood:m=>mood=m,
  toggleMusic(){on=!on;music.gain.setTargetAtTime(on?.42:0,ctx.currentTime,.05);if(on)startBGM();return on},
  toggleSfx(){sfxOn=!sfxOn;return sfxOn}}})();

export const AU: AudioApi = AU_IMPL;
