import React,{useState,useRef,useEffect,useMemo}from'react'
import{createRoot}from'react-dom/client'

const C={
  bg:"#0a0e1a",surface:"#0f1624",card:"#141b2d",border:"#1a2540",
  accent:"#3B82F6",gold:"#F59E0B",green:"#22C55E",red:"#EF4444",
  muted:"#64748B",sub:"#94A3B8",text:"#E2E8F0",white:"#F8FAFC",purple:"#A855F7"
};
const POSITIONS=["GK","DEF","MDF","FWD"];
const WC_FORMATIONS=[
  {name:'2-2-1',def:2,mdf:2,fwd:1,bias:0},
  {name:'2-1-2',def:2,mdf:1,fwd:2,bias:0},
  {name:'2-0-3',def:2,mdf:0,fwd:3,bias:0},
  {name:'3-1-1',def:3,mdf:1,fwd:1,bias:-4},
];
const posColor=p=>p==="GK"?C.gold:p==="DEF"?C.green:p==="MDF"?C.accent:p==="FWD"?C.red:C.muted;
const MANAGE_PASSWORD='BMLSeditor';
const WC_CAREER_KEY='bmls_wc_career';

const NATION_COLORS=["#e63946","#2a9d8f","#e9c46a","#f4a261","#264653","#6a4c93","#1982c4","#8ac926","#ff595e","#ffca3a","#6a0572","#3a7d44"];
const makeNation=i=>({id:i+1,name:'',color:NATION_COLORS[i%NATION_COLORS.length],crest:null,players:[]});
const makeNationPlayer=()=>({id:Date.now()+Math.random(),name:'',position:'DEF',score:7,mdfAtkScore:7,mdfDefScore:7,age:25,club:'',injured:false,suspended:false});

async function syncFixture(f){try{await fetch(`/api/fixture/${f.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)});}catch(e){console.error('sync:',e);}}
async function deleteFixture(id){try{await fetch(`/api/fixture/${id}`,{method:'DELETE'});}catch(e){console.error('del:',e);}}
async function syncNations(nations){await syncFixture({id:'bmls_nations',type:'nations',nations});}
async function resizeCrest(file){return new Promise(resolve=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{const c=document.createElement('canvas');c.width=100;c.height=100;const ctx=c.getContext('2d');const min=Math.min(img.width,img.height);const sx=(img.width-min)/2,sy=(img.height-min)/2;ctx.drawImage(img,sx,sy,min,min,0,0,100,100);URL.revokeObjectURL(url);resolve(c.toDataURL('image/jpeg',0.75));};img.src=url;});}

async function loadWCState(){
  try{
    const r=await fetch('/api/state');if(!r.ok)return null;
    const data=await r.json();
    const all=data.fixtures||[];
    const nationsRec=all.find(f=>f.id==='bmls_nations');
    const wcMeta=all.find(f=>f.id==='wc_meta');
    const wcBracket=all.find(f=>f.id==='wc_bracket');
    const groupMatches=all.filter(f=>f.type==='wc_group');
    const nations=nationsRec?.nations||Array.from({length:12},(_,i)=>makeNation(i));
    return{teams:data.teams||[],nations,wcMeta:wcMeta||null,groupMatches,wcBracket:wcBracket||null};
  }catch{return null;}
}

function depthMultiplier(n){if(n<=1)return 0.9;if(n>=4)return 1.05;return 1.0;}
function lineupRatings(nation){
  if(!nation)return{atk:0,def:0};
  const ps=nation.players.filter(p=>p.name);
  const fwds=ps.filter(p=>p.position==="FWD"),defs=ps.filter(p=>p.position==="DEF"),mdfs=ps.filter(p=>p.position==="MDF");
  const fwdAvg=fwds.length>0?fwds.reduce((s,p)=>s+p.score,0)/fwds.length:null;
  const defAvg=defs.length>0?defs.reduce((s,p)=>s+p.score,0)/defs.length:null;
  let atkP=[...fwds.map(p=>p.score)];
  mdfs.forEach(p=>{if(fwdAvg===null||p.mdfAtkScore>fwdAvg)atkP.push(p.mdfAtkScore);});
  const atkAvg=atkP.length>0?atkP.reduce((a,b)=>a+b,0)/atkP.length:5;
  const atk=Math.min(10,Math.round(atkAvg*depthMultiplier(fwds.length)));
  let defP=[...defs.map(p=>p.score)];
  mdfs.forEach(p=>{if(defAvg===null||p.mdfDefScore>defAvg)defP.push(p.mdfDefScore);});
  const defAvgF=defP.length>0?defP.reduce((a,b)=>a+b,0)/defP.length:5;
  const def=Math.min(10,Math.round(defAvgF*depthMultiplier(defs.length)));
  return{atk,def};
}

const wcPois=λ=>{const L=Math.exp(-Math.min(λ,8));let k=0,p=1;do{k++;p*=Math.random();}while(p>L);return k-1;};
const wcWPick=(items,wFn)=>{const ws=items.map(wFn),tot=ws.reduce((s,w)=>s+w,0);if(tot<=0)return items[Math.floor(Math.random()*items.length)];let r=Math.random()*tot;for(let i=0;i<items.length;i++){r-=ws[i];if(r<=0)return items[i];}return items[items.length-1];};
// Slot-aware: uses _slot assigned by pickWCLineup, falls back to natural position
const wcScorW=p=>{const s=p._slot||p.position;return s==='FWD'?(p.score||5)*3:s==='MDF'?(p.mdfAtkScore||p.score||5)*1.5:0.1;};
const wcAstW=(p,sid)=>{if(p.id===sid)return 0;const s=p._slot||p.position;return s==='MDF'?(p.mdfAtkScore||p.score||5)*2.5:s==='FWD'?(p.score||5)*1.5:0.3;};

// Optimal lineup selection: exhaustive assignment search across all formations.
// For n≤7 outfield players and 5 slots, P(n,5)≤2520 per formation — fast enough.
function pickWCLineup(nation){
  if(!nation)return{formation:WC_FORMATIONS[0],gk:null,starters:[],bench:[]};
  // Deduplicate by id and normalise string fields — trailing spaces on position
  // cause p.position==='MDF' to silently fail, dropping the player to the
  // last-resort 0.3× branch instead of the correct (mdfAtk+mdfDef)/2 score.
  const seen=new Set();
  const ps=nation.players
    .filter(p=>p.name&&p.name.trim()&&p.id!=null&&!seen.has(p.id)&&seen.add(p.id))
    .map(p=>({...p,name:p.name.trim(),position:(p.position||'').trim()}));
  if(!ps.length)return{formation:WC_FORMATIONS[0],gk:null,starters:[],bench:[]};
  let gk=ps.find(p=>p.position==='GK');
  // Exclude only the selected GK by id, NOT all GK-positioned players.
  // A squad with two GKs would lose the backup entirely from the outfield pool
  // if we filter by position — they'd never be considered for any slot.
  let out;
  if(gk){out=ps.filter(p=>p.id!==gk.id);}
  else if(ps.length){const s=[...ps].sort((a,b)=>(a.score||5)-(b.score||5));gk=s[0];out=ps.filter(p=>p.id!==gk.id);}
  else{out=[];}

  // How good is player p in a given slot type?
  const slotScore=(p,slot)=>{
    if(slot==='DEF')return p.position==='DEF'&&!p.wide?(p.score||5):p.position==='DEF'&&p.wide?(p.score||5)*0.7:p.position==='MDF'?(p.mdfDefScore||5)*0.6:(p.score||5)*0.2;
    if(slot==='MDF')return p.position==='MDF'?((p.mdfAtkScore||5)+(p.mdfDefScore||5))/2:p.position==='FWD'?(p.score||5)*0.55:p.position==='DEF'?(p.score||5)*0.35:(p.score||5)*0.2;
    return p.position==='FWD'?(p.score||5):p.position==='DEF'&&p.wide?(p.score||5)*0.8:p.position==='MDF'?(p.mdfAtkScore||5)*0.65:(p.score||5)*0.2;
  };

  const makeSlots=f=>{const s=[];for(let i=0;i<f.def;i++)s.push('DEF');for(let i=0;i<f.mdf;i++)s.push('MDF');for(let i=0;i<f.fwd;i++)s.push('FWD');return s;};

  // Find the player-to-slot assignment that maximises total slot score
  const bestAssign=(players,slots)=>{
    const n=Math.min(players.length,slots.length);
    if(!n)return{score:0,picks:[]};
    const used=new Array(players.length).fill(false);
    let bestScore=-Infinity,bestPicks=null;
    const cur=[];
    const go=(si,score)=>{
      if(si===n){if(score>bestScore){bestScore=score;bestPicks=[...cur];}return;}
      for(let pi=0;pi<players.length;pi++){
        if(!used[pi]){
          used[pi]=true;cur.push(pi);
          go(si+1,score+slotScore(players[pi],slots[si]));
          used[pi]=false;cur.pop();
        }
      }
    };
    go(0,0);
    return{score:bestScore,picks:bestPicks||[]};
  };

  let best=null;
  for(const f of WC_FORMATIONS){
    const slots=makeSlots(f);
    const{score,picks}=bestAssign(out,slots);
    const total=score+(f.bias||0);
    if(!best||total>best.total)best={total,formation:f,starters:picks.map((pi,si)=>({...out[pi],_slot:slots[si]}))};
  }

  const{formation,starters}=best;
  const starterIds=new Set([...(gk?[gk.id]:[]),...starters.map(p=>p.id)]);
  return{formation,gk,starters,bench:ps.filter(p=>!starterIds.has(p.id))};
}
function lineupRatingsFromSlots(starters){
  const fwds=starters.filter(p=>p._slot==='FWD'),defs=starters.filter(p=>p._slot==='DEF'),mdfs=starters.filter(p=>p._slot==='MDF');
  const fwdAvg=fwds.length?fwds.reduce((s,p)=>s+(p.score||5),0)/fwds.length:null;
  const defAvg=defs.length?defs.reduce((s,p)=>s+(p.score||5),0)/defs.length:null;
  let atkP=[...fwds.map(p=>p.score||5)];
  mdfs.forEach(p=>{if(fwdAvg===null||(p.mdfAtkScore||5)>fwdAvg)atkP.push(p.mdfAtkScore||5);});
  const atk=Math.min(10,Math.round((atkP.length?atkP.reduce((a,b)=>a+b,0)/atkP.length:5)*depthMultiplier(fwds.length)));
  let defP=[...defs.map(p=>p.score||5)];
  mdfs.forEach(p=>{if(defAvg===null||(p.mdfDefScore||5)>defAvg)defP.push(p.mdfDefScore||5);});
  const def=Math.min(10,Math.round((defP.length?defP.reduce((a,b)=>a+b,0)/defP.length:5)*depthMultiplier(defs.length)));
  return{atk,def};
}
function buildWCCareerLineup(nation,savedLineup){
  if(!savedLineup||!savedLineup.length)return pickWCLineup(nation);
  const seen=new Set();
  const ps=nation.players
    .filter(p=>p.name&&p.name.trim()&&p.id!=null&&!seen.has(p.id)&&seen.add(p.id))
    .map(p=>({...p,name:p.name.trim(),position:(p.position||'').trim()}));
  const savedSet=new Set(savedLineup);
  const chosen=ps.filter(p=>savedSet.has(p.id));
  const bench=ps.filter(p=>!savedSet.has(p.id));
  if(!chosen.length)return pickWCLineup(nation);
  let gk=chosen.find(p=>p.position==='GK')||null;
  const out=gk?chosen.filter(p=>p.id!==gk.id):chosen;
  const slotScore=(p,slot)=>{
    if(slot==='DEF')return p.position==='DEF'&&!p.wide?(p.score||5):p.position==='DEF'&&p.wide?(p.score||5)*0.7:p.position==='MDF'?(p.mdfDefScore||5)*0.6:(p.score||5)*0.2;
    if(slot==='MDF')return p.position==='MDF'?((p.mdfAtkScore||5)+(p.mdfDefScore||5))/2:p.position==='FWD'?(p.score||5)*0.55:p.position==='DEF'?(p.score||5)*0.35:(p.score||5)*0.2;
    return p.position==='FWD'?(p.score||5):p.position==='DEF'&&p.wide?(p.score||5)*0.8:p.position==='MDF'?(p.mdfAtkScore||5)*0.65:(p.score||5)*0.2;
  };
  const makeSlots=f=>{
    const s=[];
    for(let i=0;i<f.def;i++)s.push('DEF');
    for(let i=0;i<f.mdf;i++)s.push('MDF');
    for(let i=0;i<f.fwd;i++)s.push('FWD');
    return s;
  };
  const bestAssign=(players,slots)=>{
    const n=Math.min(players.length,slots.length);
    if(!n)return{score:0,picks:[]};
    const used=new Array(players.length).fill(false);
    let bestScore=-Infinity,bestPicks=null;
    const cur=[];
    const go=(si,score)=>{
      if(si===n){if(score>bestScore){bestScore=score;bestPicks=[...cur];}return;}
      for(let pi=0;pi<players.length;pi++){
        if(!used[pi]){used[pi]=true;cur.push(pi);go(si+1,score+slotScore(players[pi],slots[si]));used[pi]=false;cur.pop();}
      }
    };
    go(0,0);
    return{score:bestScore,picks:bestPicks||[]};
  };
  let best=null;
  for(const f of WC_FORMATIONS){
    const slots=makeSlots(f);
    const{score,picks}=bestAssign(out,slots);
    const total=score+(f.bias||0);
    if(!best||total>best.total){
      best={total,formation:f,starters:picks.map((pi,si)=>({...out[pi],_slot:slots[si]}))};
    }
  }
  return{formation:best?.formation||WC_FORMATIONS[0],gk,starters:best?.starters||[],bench};
}

function accumulateWCStats(existing,events,myTeam){
  const stats={...existing};
  events.filter(e=>e.team===myTeam&&e.type==='goal').forEach(e=>{
    const id=e.player.id;
    if(!stats[id])stats[id]={name:e.player.name,position:e.player._slot||e.player.position||'',goals:0,assists:0};
    stats[id].goals++;
    if(e.assist){
      const aid=e.assist.id;
      if(!stats[aid])stats[aid]={name:e.assist.name,position:e.assist._slot||e.assist.position||'',goals:0,assists:0};
      stats[aid].assists++;
    }
  });
  return stats;
}
function simWCMatch(home,away){
  const hr=lineupRatings(home),ar=lineupRatings(away);
  const hxg=Math.max(0.1,hr.atk*0.14+(10-ar.def)*0.09+0.25);
  const axg=Math.max(0.1,ar.atk*0.14+(10-hr.def)*0.09+0.25);
  return{hGoals:wcPois(hxg),aGoals:wcPois(axg)};
}
function simWCMatchWithEvents(home,away){
  const hr=lineupRatings(home),ar=lineupRatings(away);
  const hxg=Math.max(0.1,hr.atk*0.14+(10-ar.def)*0.09+0.25);
  const axg=Math.max(0.1,ar.atk*0.14+(10-hr.def)*0.09+0.25);
  const hGoals=wcPois(hxg),aGoals=wcPois(axg);
  const mnt=()=>Math.floor(Math.random()*90)+1;
  const hLU=pickWCLineup(home),aLU=pickWCLineup(away);
  const genGoals=(n,starters,team)=>{
    if(!starters.length||n===0)return[];
    return Array.from({length:n},()=>{
      const scorer=wcWPick(starters,wcScorW);
      const astCands=starters.filter(p=>p.id!==scorer.id);
      const assist=Math.random()<0.72&&astCands.length?wcWPick(astCands,p=>wcAstW(p,scorer.id)):null;
      return{type:'goal',team,player:scorer,assist,minute:mnt()};
    }).sort((a,b)=>a.minute-b.minute);
  };
  const events=[...genGoals(hGoals,hLU.starters,'home'),...genGoals(aGoals,aLU.starters,'away')].sort((a,b)=>a.minute-b.minute);
  return{hGoals,aGoals,events};
}
function simWCKnockout(home,away){
  const r=simWCMatch(home,away);
  if(r.hGoals===r.aGoals)return Math.random()<0.5?{...r,hGoals:r.hGoals+1,et:true}:{...r,aGoals:r.aGoals+1,et:true};
  return r;
}
function simWCMatchFull(home,away,{knockout=false,homeLineup=null,awayLineup=null}={}){
  const hLU=homeLineup||pickWCLineup(home),aLU=awayLineup||pickWCLineup(away);
  const hStarters=[...(hLU.gk?[{...hLU.gk,_slot:'GK'}]:[]),...hLU.starters];
  const aStarters=[...(aLU.gk?[{...aLU.gk,_slot:'GK'}]:[]),...aLU.starters];
  const hBench=[...hLU.bench],aBench=[...aLU.bench];
  const hr=homeLineup?lineupRatingsFromSlots(hLU.starters):lineupRatings(home);
  const ar=awayLineup?lineupRatingsFromSlots(aLU.starters):lineupRatings(away);
  const hxg=Math.max(0.1,hr.atk*0.14+(10-ar.def)*0.09+0.25);
  const axg=Math.max(0.1,ar.atk*0.14+(10-hr.def)*0.09+0.25);
  const pois=λ=>{const L=Math.exp(-Math.min(λ,8));let k=0,p=1;do{k++;p*=Math.random();}while(p>L);return k-1;};
  const mnt=(a=1,b=90)=>Math.floor(Math.random()*(b-a+1))+a;
  const events=[],redAt={},injuredAt={},subbedOff={},subOnInfo={};
  const outAt=(starters,team,min)=>[
    ...starters.filter(p=>p._slot!=='GK'&&(!redAt[p.id]||redAt[p.id]>min)&&(!injuredAt[p.id]||injuredAt[p.id]>min)&&(!subbedOff[p.id]||subbedOff[p.id]>min)),
    ...Object.values(subOnInfo).filter(s=>s.team===team&&s.minute<=min&&(!redAt[s.player.id]||redAt[s.player.id]>min)&&(!injuredAt[s.player.id]||injuredAt[s.player.id]>min)).map(s=>s.player)
  ];
  const doReds=(starters,team)=>starters.forEach(p=>{if(Math.random()<0.006){const m=mnt();redAt[p.id]=m;events.push({team,type:'red',player:p,minute:m});}});
  const doInj=(starters,team)=>starters.filter(p=>p._slot!=='GK'&&!redAt[p.id]).forEach(p=>{if(Math.random()<0.008){const m=mnt();injuredAt[p.id]=m;events.push({team,type:'injury',player:p,minute:m});}});
  doReds(hStarters,'home');doReds(aStarters,'away');
  doInj(hStarters,'home');doInj(aStarters,'away');
  const doSubs=(starters,bench,team)=>{
    const pool=[...bench];const used=new Set();
    starters.filter(p=>injuredAt[p.id]&&p._slot!=='GK').forEach(inj=>{
      const bi=pool.findIndex(b=>!used.has(b.id));if(bi<0)return;
      const on=pool[bi];used.add(on.id);
      const m=Math.min(90,(injuredAt[inj.id]||1)+Math.floor(Math.random()*5)+1);
      subbedOff[inj.id]=m;subOnInfo[on.id]={player:on,minute:m,team};
      events.push({team,type:'sub',minute:m,playerOn:on,playerOff:inj,injury:true});
    });
    const tac=pool.filter(b=>!used.has(b.id));
    if(tac.length&&Math.random()<0.5){
      const on=tac[0];const offPool=outAt(starters,team,65);
      const off=offPool[Math.floor(Math.random()*offPool.length)];
      if(off){const m=mnt(60,85);subbedOff[off.id]=m;subOnInfo[on.id]={player:on,minute:m,team};events.push({team,type:'sub',minute:m,playerOn:on,playerOff:off});}
    }
  };
  doSubs(hStarters,hBench,'home');doSubs(aStarters,aBench,'away');
  const hGoals=pois(hxg),aGoals=pois(axg);
  const genGoals=(n,starters,team)=>Array.from({length:n},()=>{
    const m=mnt();const pool=outAt(starters,team,m);if(!pool.length)return null;
    const sc=wcWPick(pool,wcScorW);const ac=pool.filter(p=>p.id!==sc.id);
    const ast=Math.random()<0.72&&ac.length?wcWPick(ac,p=>wcAstW(p,sc.id)):null;
    return{team,type:'goal',player:sc,assist:ast,minute:m};
  }).filter(Boolean);
  events.push(...genGoals(hGoals,hStarters,'home'),...genGoals(aGoals,aStarters,'away'));
  outAt(hStarters,'home',90).forEach(p=>{if(Math.random()<0.04)events.push({team:'home',type:'yellow',player:p,minute:mnt()});});
  outAt(aStarters,'away',90).forEach(p=>{if(Math.random()<0.04)events.push({team:'away',type:'yellow',player:p,minute:mnt()});});
  events.sort((a,b)=>a.minute-b.minute);
  const fH=events.filter(e=>e.team==='home'&&e.type==='goal').length;
  const fA=events.filter(e=>e.team==='away'&&e.type==='goal').length;
  let et=false;
  if(knockout&&fH===fA){
    et=true;const etMin=mnt(91,120);const etTeam=Math.random()<0.5?'home':'away';
    const etPool=etTeam==='home'?outAt(hStarters,'home',90):outAt(aStarters,'away',90);
    if(etPool.length){
      const sc=wcWPick(etPool,wcScorW);const ac=etPool.filter(p=>p.id!==sc.id);
      const ast=Math.random()<0.72&&ac.length?wcWPick(ac,p=>wcAstW(p,sc.id)):null;
      events.push({team:etTeam,type:'goal',player:sc,assist:ast,minute:etMin});
      events.sort((a,b)=>a.minute-b.minute);
    }
  }
  const tH=events.filter(e=>e.team==='home'&&e.type==='goal').length;
  const tA=events.filter(e=>e.team==='away'&&e.type==='goal').length;
  return{hGoals:tH,aGoals:tA,events,et,maxMinute:et?120:90};
}

// Group match pairs: index into group's nationIds array
const GROUP_PAIRS=[[0,1],[0,2],[1,2]];
const GROUPS=['A','B','C','D'];

function getGroupMatches(gid,groupMatches){return GROUP_PAIRS.map((_,i)=>groupMatches.find(m=>m.id===`wc_gm_${gid}${i+1}`)||null);}

function computeStandings(nationIds,matches,nations){
  const stats={};
  nationIds.forEach(id=>{stats[id]={id,W:0,D:0,L:0,GF:0,GA:0,pts:0};});
  matches.forEach(m=>{
    if(!m||!m.played)return;
    const h=m.homeId,a=m.awayId,hg=m.homeScore,ag=m.awayScore;
    if(!stats[h]||!stats[a])return;
    stats[h].GF+=hg;stats[h].GA+=ag;stats[a].GF+=ag;stats[a].GA+=hg;
    if(hg>ag){stats[h].W++;stats[h].pts+=3;stats[a].L++;}
    else if(ag>hg){stats[a].W++;stats[a].pts+=3;stats[h].L++;}
    else{stats[h].D++;stats[h].pts++;stats[a].D++;stats[a].pts++;}
  });
  return Object.values(stats).map(s=>({...s,GD:s.GF-s.GA,P:s.W+s.D+s.L,nation:nations.find(n=>n.id===s.id)}))
    .sort((a,b)=>b.pts-a.pts||b.GD-a.GD||b.GF-a.GF);
}

function getKnockoutSeeds(wcMeta,groupMatches,nations){
  if(!wcMeta?.groups)return null;
  const groupStandings={};
  wcMeta.groups.forEach(g=>{
    const ms=getGroupMatches(g.id,groupMatches);
    const played=ms.filter(m=>m&&m.played).length;
    if(played<3)return;
    groupStandings[g.id]=computeStandings(g.nationIds,ms,nations);
  });
  const complete=Object.keys(groupStandings).length===4&&GROUPS.every(g=>groupStandings[g]);
  if(!complete)return null;
  return{
    '1A':groupStandings.A[0]?.id,'2A':groupStandings.A[1]?.id,
    '1B':groupStandings.B[0]?.id,'2B':groupStandings.B[1]?.id,
    '1C':groupStandings.C[0]?.id,'2C':groupStandings.C[1]?.id,
    '1D':groupStandings.D[0]?.id,'2D':groupStandings.D[1]?.id,
  };
}

// UI components
const TeamBadge=({color,crest,size=28})=>crest
  ?<img src={crest} style={{width:size,height:size,borderRadius:6,objectFit:'cover',flexShrink:0,display:'inline-block'}} alt=""/>
  :<span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:size,height:size,borderRadius:6,background:color||C.border,fontSize:size*0.45,flexShrink:0}}>⚽</span>;
const Btn=({children,onClick,variant="primary",style:xs})=>{
  const bg=variant==="primary"?C.accent:variant==="danger"?"#7f1d1d":variant==="success"?"#14532d":variant==="gold"?"#78350f":C.border;
  const col=variant==="danger"?"#fca5a5":variant==="success"?"#86efac":variant==="gold"?C.gold:C.white;
  return<button onClick={onClick} style={{background:bg,color:col,border:'none',borderRadius:6,cursor:'pointer',padding:'8px 16px',fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",...xs}}>{children}</button>;
};
const SLabel=({children})=><div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:'uppercase',marginBottom:10}}>{children}</div>;
const Empty=({icon,msg,hint})=><div style={{textAlign:'center',padding:'60px 0',color:C.muted}}><div style={{fontSize:32,marginBottom:12}}>{icon}</div><div style={{fontSize:15,color:C.sub}}>{msg}</div><div style={{fontSize:13,marginTop:6}}>{hint}</div></div>;

function ManagePasswordModal({onSuccess,onCancel}){
  const[pw,setPw]=useState('');const[err,setErr]=useState(false);
  const check=()=>{if(pw===MANAGE_PASSWORD){onSuccess();}else{setErr(true);setPw('');}};
  return(
    <div style={{position:'fixed',inset:0,background:'#000a',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:28,width:'min(340px,90vw)'}}>
        <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:8}}>Manage Password</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:20}}>Enter the password to access settings.</div>
        <input type="password" value={pw} onChange={e=>{setPw(e.target.value);setErr(false);}} onKeyDown={e=>e.key==='Enter'&&check()} autoFocus placeholder="Password" style={{background:C.surface,border:`1px solid ${err?C.red:C.border}`,borderRadius:6,padding:'9px 12px',color:C.text,fontSize:14,fontFamily:"'DM Sans',sans-serif",width:'100%',outline:'none',marginBottom:10}}/>
        {err&&<div style={{fontSize:11,color:C.red,marginBottom:12}}>Incorrect password.</div>}
        <div style={{display:'flex',gap:8}}>
          <Btn onClick={check} style={{flex:1}}>Unlock</Btn>
          <Btn onClick={onCancel} variant="secondary" style={{flex:1}}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}

function PitchView({homeNation,awayNation}){
  if(!homeNation||!awayNation)return null;
  const hLU=pickWCLineup(homeNation);
  const aLU=pickWCLineup(awayNation);
  const isWide=p=>p.wide||(p.position==='DEF'&&p._slot==='FWD');
  // Wide FWDs go on the outside, central FWDs in the middle
  const arrangeFWDs=fwds=>{const w=fwds.filter(isWide),c=fwds.filter(p=>!isWide(p));if(!w.length)return c;if(!c.length)return w;return[w[0],...c,...w.slice(1)];};
  const DotEl=({p,color,mt=0})=>(
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,minWidth:32,marginTop:mt}}>
      <div style={{width:26,height:26,borderRadius:'50%',background:color||'#333',border:'2px solid rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:6,fontWeight:800,color:'#fff',textShadow:'0 1px 2px #0008'}}>
        {p._slot||p.position}
      </div>
      <span style={{fontSize:7.5,color:'rgba(255,255,255,0.65)',maxWidth:40,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textAlign:'center',lineHeight:1.2}}>
        {(p.name.trim().split(/\s+/).filter(Boolean).pop()||p.name.trim()||'—')}
      </span>
    </div>
  );
  const Row=({players,color})=>players.length?(
    <div style={{display:'flex',justifyContent:'center',gap:4,padding:'2px 0',alignItems:'flex-start'}}>{players.map(p=><DotEl key={p.id} p={p} color={color}/>)}</div>
  ):null;
  // DEF row: same as Row but with more horizontal spread
  const DefRow=({players,color})=>players.length?(
    <div style={{display:'flex',justifyContent:'center',gap:18,padding:'2px 0',alignItems:'flex-start'}}>{players.map(p=><DotEl key={p.id} p={p} color={color}/>)}</div>
  ):null;
  // MDF row: for 2 MDFs, sort defensive (higher mdfDefScore) deeper toward keeper,
  // attacking (higher mdfAtkScore) higher toward FWDs — mirrored per side.
  const MdfRow=({players,color,home})=>{
    if(!players.length)return null;
    let arr=players;
    if(players.length===2){
      const[a,b]=players;
      const aDefRating=(a.mdfDefScore||5),bDefRating=(b.mdfDefScore||5);
      // defensive MDF first, attacking MDF second
      arr=aDefRating>=bDefRating?[a,b]:[b,a];
    }
    return(
      <div style={{display:'flex',justifyContent:'center',gap:20,padding:'2px 0',alignItems:'flex-start'}}>
        {arr.map((p,idx)=>{
          const isDefensive=arr.length===2&&idx===0;
          const mt=arr.length===2?(isDefensive?(home?10:0):(home?0:10)):0;
          return <DotEl key={p.id} p={p} color={color} mt={mt}/>;
        })}
      </div>
    );
  };
  // FWD row: wide players a bit to the sides and a bit more withdrawn toward keeper
  // gap:22 gives spread without hitting the edges; marginTop offset for depth
  const FwdRow=({players,color,home})=>{
    if(!players.length)return null;
    const arr=arrangeFWDs(players);
    return(
      <div style={{display:'flex',justifyContent:'center',gap:22,padding:'2px 0',alignItems:'flex-start'}}>
        {arr.map((p,idx)=>{
          // Outer players in any 3+ FWD row always get the "wide" visual —
          // pulled slightly toward keeper — regardless of position type.
          const outer=arr.length>=3&&(idx===0||idx===arr.length-1);
          const wide=isWide(p)||outer;
          return <DotEl key={p.id} p={p} color={color} mt={wide?(home?12:0):(home?0:12)}/>;
        })}
      </div>
    );
  };
  const aGk=aLU.gk?[{...aLU.gk,_slot:'GK'}]:[];
  const aDef=aLU.starters.filter(p=>p._slot==='DEF');
  const aMdf=aLU.starters.filter(p=>p._slot==='MDF');
  const aFwd=aLU.starters.filter(p=>p._slot==='FWD');
  const hFwd=hLU.starters.filter(p=>p._slot==='FWD');
  const hMdf=hLU.starters.filter(p=>p._slot==='MDF');
  const hDef=hLU.starters.filter(p=>p._slot==='DEF');
  const hGk=hLU.gk?[{...hLU.gk,_slot:'GK'}]:[];
  return(
    <div style={{background:'#091a09',border:'1px solid #152e15',borderRadius:8,padding:'8px 4px',marginTop:8,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:2,paddingLeft:8}}>
        <TeamBadge color={awayNation.color||C.border} crest={awayNation.crest} size={10}/>
        <span style={{fontSize:7.5,color:'rgba(255,255,255,0.4)',letterSpacing:1.5,textTransform:'uppercase'}}>{awayNation.name} · {aLU.formation.name}</span>
      </div>
      <Row players={aGk} color={awayNation.color}/>
      <DefRow players={aDef} color={awayNation.color}/>
      <MdfRow players={aMdf} color={awayNation.color} home={false}/>
      <FwdRow players={aFwd} color={awayNation.color} home={false}/>
      <div style={{height:1,background:'rgba(255,255,255,0.1)',margin:'6px 16px'}}/>
      <FwdRow players={hFwd} color={homeNation.color} home={true}/>
      <MdfRow players={hMdf} color={homeNation.color} home={true}/>
      <DefRow players={hDef} color={homeNation.color}/>
      <Row players={hGk} color={homeNation.color}/>
      <div style={{display:'flex',alignItems:'center',gap:4,marginTop:2,justifyContent:'flex-end',paddingRight:8}}>
        <span style={{fontSize:7.5,color:'rgba(255,255,255,0.4)',letterSpacing:1.5,textTransform:'uppercase'}}>{homeNation.name} · {hLU.formation.name}</span>
        <TeamBadge color={homeNation.color||C.border} crest={homeNation.crest} size={10}/>
      </div>
      {(aLU.bench.length>0||hLU.bench.length>0)&&(
        <div style={{borderTop:'1px solid rgba(255,255,255,0.07)',marginTop:6,paddingTop:5,paddingLeft:8,paddingRight:8}}>
          <div style={{fontSize:6,color:'rgba(255,255,255,0.2)',letterSpacing:2,textTransform:'uppercase',marginBottom:4}}>Bench</div>
          <div style={{display:'flex',justifyContent:'space-between',gap:6}}>
            <div style={{display:'flex',gap:4,flexWrap:'wrap',flex:1}}>
              {aLU.bench.map(p=>(
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:3,background:awayNation.color+'1a',border:`1px solid ${awayNation.color}33`,borderRadius:4,padding:'2px 5px'}}>
                  <span style={{fontSize:6.5,color:awayNation.color,fontWeight:700,opacity:0.8}}>{p.position[0]}</span>
                  <span style={{fontSize:7.5,color:'rgba(255,255,255,0.45)'}}>{(p.name.trim().split(/\s+/).filter(Boolean).pop()||p.name.trim()||'—')}</span>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:4,flexWrap:'wrap',flex:1,justifyContent:'flex-end'}}>
              {hLU.bench.map(p=>(
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:3,background:homeNation.color+'1a',border:`1px solid ${homeNation.color}33`,borderRadius:4,padding:'2px 5px'}}>
                  <span style={{fontSize:7.5,color:'rgba(255,255,255,0.45)'}}>{(p.name.trim().split(/\s+/).filter(Boolean).pop()||p.name.trim()||'—')}</span>
                  <span style={{fontSize:6.5,color:homeNation.color,fontWeight:700,opacity:0.8}}>{p.position[0]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WCMatchSimPanel({hNation,aNation,sim,onSimulate,onSave,onResim,knockout}){
  const[minute,setMinute]=useState(0);
  const[shown,setShown]=useState([]);
  const[score,setScore]=useState({h:0,a:0});
  const[speed,setSpeed]=useState(1);
  const[running,setRunning]=useState(false);
  const[done,setDone]=useState(false);
  const iRef=useRef(null);
  const feedRef=useRef(null);
  const maxMin=sim?.maxMinute||90;
  useEffect(()=>{
    if(!sim)return;
    clearInterval(iRef.current);
    setMinute(0);setShown([]);setScore({h:0,a:0});setDone(false);setRunning(true);
  },[sim]);
  useEffect(()=>{
    if(!running||!sim)return;
    clearInterval(iRef.current);
    iRef.current=setInterval(()=>setMinute(m=>m<maxMin?m+1:maxMin),1000/speed);
    return()=>clearInterval(iRef.current);
  },[running,speed,sim]);
  useEffect(()=>{
    if(!sim||minute===0)return;
    const now=sim.events.filter(e=>e.minute===minute);
    if(now.length){
      setShown(p=>[...p,...now]);
      const goals=now.filter(e=>e.type==='goal');
      if(goals.length)setScore(s=>{let h=s.h,a=s.a;goals.forEach(e=>{if(e.team==='home')h++;else a++;});return{h,a};});
    }
    if(minute>=maxMin){clearInterval(iRef.current);setRunning(false);setDone(true);}
  },[minute]);
  useEffect(()=>{if(feedRef.current)feedRef.current.scrollTop=feedRef.current.scrollHeight;},[shown]);
  const ico=t=>t==='goal'?'⚽':t==='yellow'?'🟡':t==='sub'?'🔄':t==='injury'?'🤕':'🟥';
  const evMain=e=>e.type==='goal'?e.player.name:e.type==='sub'?`↑ ${e.playerOn.name}`:e.player.name;
  const evSub=e=>e.type==='sub'?`↓ ${e.playerOff.name}`:e.assist?`↗ ${e.assist.name}`:'';
  const timeLabel=()=>{
    if(done)return sim?.et?'FULL TIME · AET':'FULL TIME';
    if(minute===45)return'HALF TIME';
    if(sim?.et&&minute>90)return`${minute}' AET`;
    if(sim?.et&&minute===90)return'EXTRA TIME';
    if(running)return`${minute}'`;
    return'—';
  };
  return(
    <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:12,marginTop:8}}>
      {!sim?(
        <div style={{textAlign:'center'}}><Btn onClick={onSimulate}>▶ Simulate</Btn></div>
      ):(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:6,marginBottom:4}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:4}}>
              <span style={{fontSize:11,color:C.text,fontWeight:score.h>score.a?700:400,textAlign:'right'}}>{hNation?.name}</span>
              <TeamBadge color={hNation?.color||C.border} crest={hNation?.crest} size={14}/>
            </div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:36,color:C.gold,letterSpacing:3,textAlign:'center',lineHeight:1,padding:'0 6px'}}>{score.h}–{score.a}</div>
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              <TeamBadge color={aNation?.color||C.border} crest={aNation?.crest} size={14}/>
              <span style={{fontSize:11,color:C.text,fontWeight:score.a>score.h?700:400}}>{aNation?.name}</span>
            </div>
          </div>
          <div style={{textAlign:'center',fontSize:10,fontWeight:700,letterSpacing:2,color:done?C.green:running?C.red:C.muted,marginBottom:6}}>{timeLabel()}</div>
          {running&&<div style={{height:2,background:C.surface,borderRadius:1,marginBottom:6,overflow:'hidden'}}><div style={{height:'100%',background:sim?.et&&minute>90?C.gold:C.accent,width:`${(minute/maxMin)*100}%`,transition:'width 0.9s linear'}}/></div>}
          {running&&<div style={{display:'flex',gap:5,marginBottom:8,justifyContent:'center'}}>{[1,2,5].map(s=><button key={s} onClick={()=>setSpeed(s)} style={{background:speed===s?`${C.accent}22`:'transparent',color:speed===s?C.accent:C.muted,border:`1px solid ${speed===s?C.accent:C.border}`,borderRadius:4,padding:'3px 10px',fontSize:10,fontWeight:700,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>{s}×</button>)}</div>}
          <div ref={feedRef} style={{borderTop:`1px solid ${C.border}33`,borderBottom:`1px solid ${C.border}33`,padding:'8px 0',maxHeight:180,overflowY:'auto',marginBottom:10}}>
            {shown.length===0&&<div style={{fontSize:11,color:C.muted,textAlign:'center',padding:'8px 0'}}>—</div>}
            {shown.map((e,i)=>{
              const isH=e.team==='home';
              const hC=hNation?.color||C.text,aC=aNation?.color||C.text;
              const main=evMain(e),sub2=evSub(e);
              return(
                <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 32px 1fr',gap:2,marginBottom:5,alignItems:'start'}}>
                  {isH?<div style={{textAlign:'right',paddingRight:4}}><div style={{fontSize:11,color:e.type==='sub'?C.muted:hC,fontWeight:600}}>{main} {ico(e.type)}</div>{sub2&&<div style={{fontSize:9,color:C.muted}}>{sub2}</div>}</div>:<div/>}
                  <div style={{textAlign:'center',fontSize:9,color:C.muted,fontWeight:700,paddingTop:2}}>{e.minute}'</div>
                  {!isH?<div style={{paddingLeft:4}}><div style={{fontSize:11,color:e.type==='sub'?C.muted:aC,fontWeight:600}}>{ico(e.type)} {main}</div>{sub2&&<div style={{fontSize:9,color:C.muted,paddingLeft:14}}>{sub2}</div>}</div>:<div/>}
                </div>
              );
            })}
          </div>
          <div style={{display:'flex',gap:6}}>
            <Btn onClick={onResim||onSimulate} variant="secondary" style={{flex:1,fontSize:11}}>↺ Re-sim</Btn>
            {done&&<Btn onClick={onSave} variant="success" style={{flex:1,fontSize:11}}>✓ Save Result</Btn>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── NationsManageView ────────────────────────────────────────────────────────
function NationsManageView({nations,setNations,teams,onToast}){
  const[editNation,setEditNation]=useState(null);
  const[addMode,setAddMode]=useState(null);
  const[search,setSearch]=useState('');
  const[newPlayer,setNewPlayer]=useState(null);
  const[expandedPid,setExpandedPid]=useState(null);
  const flagRef=useRef();
  const allBmlsPlayers=(teams||[]).flatMap(t=>t.players.map(p=>({...p,club:t.name,clubColor:t.color})));
  const filtered=allBmlsPlayers.filter(p=>p.name&&p.name.toLowerCase().includes(search.toLowerCase()));
  const saveNation=n=>{const s=new Set();const d={...n,players:n.players.filter(p=>!s.has(p.id)&&s.add(p.id))};const nn=nations.map(x=>x.id===d.id?d:x);setNations(nn);syncNations(nn);};
  const sel={background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:'8px 10px',color:C.text,fontSize:13,fontFamily:"'DM Sans',sans-serif",width:'100%',outline:'none'};
  if(editNation){
    const np=newPlayer||{name:'',position:'DEF',score:7,mdfAtkScore:7,mdfDefScore:7,age:25,club:''};
    return(
      <div>
        <button onClick={()=>{setEditNation(null);setAddMode(null);setNewPlayer(null);}} style={{background:'none',border:'none',color:C.accent,fontSize:13,cursor:'pointer',marginBottom:16,padding:0,fontFamily:"'DM Sans',sans-serif"}}>← Back to Nations</button>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
          <div onClick={()=>flagRef.current.click()} style={{cursor:'pointer'}}>
            <TeamBadge color={editNation.color} crest={editNation.crest} size={52}/>
          </div>
          <input ref={flagRef} type="file" accept="image/*" style={{display:'none'}} onChange={async e=>{const f=e.target.files[0];if(f){const d=await resizeCrest(f);const u={...editNation,crest:d};setEditNation(u);saveNation(u);}e.target.value="";}}/>
          <div style={{flex:1}}>
            <input value={editNation.name} onChange={e=>setEditNation({...editNation,name:e.target.value})} onBlur={()=>saveNation(editNation)} placeholder="Nation name" style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:'8px 10px',color:C.text,fontSize:16,fontWeight:700,fontFamily:"'DM Sans',sans-serif",width:'100%',outline:'none',marginBottom:6,boxSizing:'border-box'}}/>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <label style={{fontSize:11,color:C.muted}}>Color</label>
              <input type="color" value={editNation.color} onChange={e=>{const u={...editNation,color:e.target.value};setEditNation(u);saveNation(u);}} style={{width:32,height:26,border:'none',background:'none',cursor:'pointer',padding:0}}/>
              {editNation.crest&&<button onClick={()=>{const u={...editNation,crest:null};setEditNation(u);saveNation(u);}} style={{background:'none',border:`1px solid ${C.border}`,borderRadius:4,color:C.muted,padding:'3px 8px',fontSize:11,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>Remove Flag</button>}
            </div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
          <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase'}}>Squad</div>
          <div style={{fontSize:11,color:editNation.players.length>=8?C.gold:C.muted}}>{editNation.players.length}/8</div>
        </div>
        {editNation.players.map(p=>{
          const isExp=expandedPid===p.id;
          const updatePlayer=patch=>{const u={...editNation,players:editNation.players.map(x=>x.id===p.id?{...x,...patch}:x)};setEditNation(u);saveNation(u);};
          return(
            <div key={p.id} style={{background:C.card,border:`1px solid ${isExp?C.accent:C.border}`,borderRadius:8,marginBottom:6,overflow:'hidden'}}>
              <div onClick={()=>setExpandedPid(isExp?null:p.id)} style={{padding:'10px 12px',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
                <div style={{background:posColor(p.position)+"22",color:posColor(p.position),borderRadius:4,padding:'2px 6px',fontSize:10,fontWeight:700,flexShrink:0}}>{p.position}{p.wide&&p.position==='DEF'?' W':''}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text}}>{p.name}</div>
                  <div style={{fontSize:11,color:C.muted}}>{p.club||'—'}</div>
                </div>
                <div style={{fontSize:13,fontFamily:"'Bebas Neue',sans-serif",color:C.text,minWidth:20,textAlign:'right'}}>
                  {p.position==='MDF'?`A${p.mdfAtkScore||'?'}/D${p.mdfDefScore||'?'}`:p.position!=='GK'?(p.score||'?'):'GK'}
                </div>
                <button onClick={e=>{e.stopPropagation();const u={...editNation,players:editNation.players.filter(x=>x.id!==p.id)};setExpandedPid(null);setEditNation(u);saveNation(u);}} style={{background:'none',border:'none',color:C.red,fontSize:16,cursor:'pointer',padding:'0 4px'}}>×</button>
              </div>
              {isExp&&(
                <div style={{padding:'0 12px 12px',borderTop:`1px solid ${C.border}`,paddingTop:10}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
                    <div>
                      <label style={{fontSize:10,color:C.muted,display:'block',marginBottom:3}}>Position</label>
                      <select value={p.position} onChange={e=>updatePlayer({position:e.target.value,wide:e.target.value!=='DEF'?false:p.wide})} style={sel}>{POSITIONS.map(pos=><option key={pos}>{pos}</option>)}</select>
                    </div>
                    {p.position==='MDF'?(
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                        <div><label style={{fontSize:10,color:C.muted,display:'block',marginBottom:3}}>ATK</label><input type="number" min="1" max="10" step="0.5" value={p.mdfAtkScore||7} onChange={e=>updatePlayer({mdfAtkScore:+e.target.value})} style={sel}/></div>
                        <div><label style={{fontSize:10,color:C.muted,display:'block',marginBottom:3}}>DEF</label><input type="number" min="1" max="10" step="0.5" value={p.mdfDefScore||7} onChange={e=>updatePlayer({mdfDefScore:+e.target.value})} style={sel}/></div>
                      </div>
                    ):p.position!=='GK'?(
                      <div><label style={{fontSize:10,color:C.muted,display:'block',marginBottom:3}}>Score</label><input type="number" min="1" max="10" step="0.5" value={p.score||7} onChange={e=>updatePlayer({score:+e.target.value})} style={sel}/></div>
                    ):<div/>}
                  </div>
                  {p.position==='DEF'&&(
                    <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,color:C.text}}>
                      <input type="checkbox" checked={!!p.wide} onChange={e=>updatePlayer({wide:e.target.checked})} style={{width:14,height:14,cursor:'pointer'}}/>
                      Wide (plays as winger)
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {addMode==='bmls'&&(
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginTop:10,marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:600,color:C.muted,marginBottom:8}}>Pick from BMLS roster</div>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search player..." style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:'7px 10px',color:C.text,fontSize:13,fontFamily:"'DM Sans',sans-serif",width:'100%',outline:'none',marginBottom:8,boxSizing:'border-box'}}/>
            <div style={{maxHeight:220,overflowY:'auto'}}>
              {filtered.slice(0,30).map(p=>{
                const added=editNation.players.some(x=>x.id===p.id);
                return(
                  <div key={p.id} onClick={()=>{if(added||editNation.players.length>=8)return;const np={...p,club:p.club||''};const u={...editNation,players:[...editNation.players,np]};setEditNation(u);saveNation(u);setAddMode(null);setSearch('');}} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:6,cursor:added?'default':'pointer',opacity:added?0.4:1}} onMouseOver={e=>{if(!added)e.currentTarget.style.background=C.card;}} onMouseOut={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{background:posColor(p.position)+"22",color:posColor(p.position),borderRadius:4,padding:'2px 6px',fontSize:10,fontWeight:700,flexShrink:0}}>{p.position}</div>
                    <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{p.name}</div><div style={{fontSize:11,color:C.muted}}>{p.club}</div></div>
                    {added&&<span style={{fontSize:10,color:C.muted}}>Added</span>}
                  </div>
                );
              })}
              {filtered.length===0&&<div style={{fontSize:12,color:C.muted,textAlign:'center',padding:12}}>No players found</div>}
            </div>
            <button onClick={()=>setAddMode(null)} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer',padding:'8px 0 0',fontFamily:"'DM Sans',sans-serif"}}>Cancel</button>
          </div>
        )}
        {addMode==='new'&&(
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginTop:10,marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:600,color:C.muted,marginBottom:10}}>New player</div>
            <input value={np.name} onChange={e=>setNewPlayer({...np,name:e.target.value})} placeholder="Full name" style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:'7px 10px',color:C.text,fontSize:13,fontFamily:"'DM Sans',sans-serif",width:'100%',outline:'none',marginBottom:8,boxSizing:'border-box'}}/>
            <input value={np.club} onChange={e=>setNewPlayer({...np,club:e.target.value})} placeholder="Club" style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:'7px 10px',color:C.text,fontSize:13,fontFamily:"'DM Sans',sans-serif",width:'100%',outline:'none',marginBottom:8,boxSizing:'border-box'}}/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
              <select value={np.position} onChange={e=>setNewPlayer({...np,position:e.target.value})} style={sel}>
                {POSITIONS.map(p=><option key={p}>{p}</option>)}
              </select>
              <input type="number" min="16" max="40" value={np.age} onChange={e=>setNewPlayer({...np,age:+e.target.value})} placeholder="Age" style={sel}/>
            </div>
            {np.position==='MDF'?(
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
                <div><label style={{fontSize:10,color:C.muted}}>ATK</label><input type="number" min="1" max="10" step="0.5" value={np.mdfAtkScore} onChange={e=>setNewPlayer({...np,mdfAtkScore:+e.target.value})} style={sel}/></div>
                <div><label style={{fontSize:10,color:C.muted}}>DEF</label><input type="number" min="1" max="10" step="0.5" value={np.mdfDefScore} onChange={e=>setNewPlayer({...np,mdfDefScore:+e.target.value})} style={sel}/></div>
              </div>
            ):np.position!=='GK'?(
              <div style={{marginBottom:8}}><label style={{fontSize:10,color:C.muted}}>Score</label><input type="number" min="1" max="10" step="0.5" value={np.score} onChange={e=>setNewPlayer({...np,score:+e.target.value})} style={sel}/></div>
            ):null}
            <div style={{display:'flex',gap:8,marginTop:4}}>
              <Btn onClick={()=>{if(!np.name)return;const p={...makeNationPlayer(),...np,id:Date.now()+Math.random()};const u={...editNation,players:[...editNation.players,p]};setEditNation(u);saveNation(u);setAddMode(null);setNewPlayer(null);}} style={{flex:1}}>Add Player</Btn>
              <Btn onClick={()=>{setAddMode(null);setNewPlayer(null);}} variant="secondary" style={{flex:1}}>Cancel</Btn>
            </div>
          </div>
        )}
        {!addMode&&editNation.players.length<8&&(
          <div style={{display:'flex',gap:8,marginTop:12}}>
            <Btn onClick={()=>setAddMode('bmls')} variant="secondary" style={{flex:1,fontSize:12}}>+ From BMLS</Btn>
            <Btn onClick={()=>{setAddMode('new');setNewPlayer({name:'',position:'DEF',score:7,mdfAtkScore:7,mdfDefScore:7,age:25,club:''});}} variant="secondary" style={{flex:1,fontSize:12}}>+ New Player</Btn>
          </div>
        )}
        {!addMode&&editNation.players.length>=8&&<div style={{fontSize:11,color:C.gold,textAlign:'center',marginTop:12,fontStyle:'italic'}}>Squad full — 8/8</div>}
      </div>
    );
  }
  return(
    <div>
      <SLabel>12 Nations — click to edit squad</SLabel>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        {nations.map(n=>(
          <div key={n.id} onClick={()=>setEditNation({...n,players:[...n.players]})} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14,cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
            <TeamBadge color={n.name?n.color:C.border} crest={n.name?n.crest:null} size={32}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:n.name?C.text:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{n.name||'Empty slot'}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{n.players.length} player{n.players.length!==1?'s':''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── GroupDrawView ────────────────────────────────────────────────────────────
const POT_COLORS=['#F59E0B','#94A3B8','#CD7F32']; // gold, silver, bronze
const POT_LABELS=['Pot 1','Pot 2','Pot 3'];

function GroupDrawView({nations,wcMeta,onSaveGroups,onToast}){
  const named=nations.filter(n=>n.name);
  const scored=useMemo(()=>[...named].map(n=>{const r=lineupRatings(n);return{...n,score:r.atk+r.def,atk:r.atk,def:r.def};}).sort((a,b)=>b.score-a.score),[named.length]);
  const pots=[scored.slice(0,4),scored.slice(4,8),scored.slice(8,12)];
  const[drawn,setDrawn]=useState(null); // {A:[id,id,id], B:..., ...}
  const shuffle=arr=>[...arr].sort(()=>Math.random()-0.5);
  const autoDraw=()=>{
    if(named.length<12){onToast(`Need 12 named nations — only ${named.length} set up.`);return;}
    const[p1,p2,p3]=pots.map(shuffle);
    setDrawn({A:[p1[0].id,p2[0].id,p3[0].id],B:[p1[1].id,p2[1].id,p3[1].id],C:[p1[2].id,p2[2].id,p3[2].id],D:[p1[3].id,p2[3].id,p3[3].id]});
  };
  const confirm=()=>{
    if(!drawn)return;
    onSaveGroups(GROUPS.map(id=>({id,nationIds:drawn[id]})));
  };
  const potOf=id=>pots.findIndex(p=>p.some(n=>n.id===id));
  return(
    <div>
      <div style={{background:'linear-gradient(135deg,#0a1628 0%,#0f2044 50%,#0a1628 100%)',border:`1px solid #1a3060`,borderRadius:12,padding:'20px',marginBottom:20,textAlign:'center'}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:C.gold,letterSpacing:4}}>GROUP DRAW</div>
        <div style={{fontSize:12,color:C.muted,marginTop:4}}>Seeded by ATK + DEF rating · One nation per pot per group</div>
      </div>
      {named.length<12&&<div style={{background:C.surface,border:`1px solid ${C.gold}44`,borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:C.gold}}>⚠ Only {named.length}/12 nations set up — go to Manage → Nations before drawing.</div>}
      {/* Pots */}
      {pots.map((pot,pi)=>(
        <div key={pi} style={{marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:POT_COLORS[pi],letterSpacing:2}}>{POT_LABELS[pi]}</span>
            <div style={{flex:1,height:1,background:POT_COLORS[pi]+'33'}}/>
            <span style={{fontSize:10,color:C.muted}}>Ranked {pi*4+1}–{pi*4+4}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {pot.length>0?pot.map((n,ni)=>(
              <div key={n.id} style={{display:'flex',alignItems:'center',gap:10,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px'}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:POT_COLORS[pi],minWidth:18,textAlign:'center'}}>{pi*4+ni+1}</div>
                <TeamBadge color={n.color} crest={n.crest} size={24}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{n.name}</div>
                  <div style={{display:'flex',gap:6,marginTop:2}}>
                    <span style={{fontSize:10,color:C.red}}>A{n.atk}</span>
                    <span style={{fontSize:10,color:C.green}}>D{n.def}</span>
                    <span style={{fontSize:10,color:POT_COLORS[pi],fontWeight:700}}>{n.score}</span>
                  </div>
                </div>
              </div>
            )):[0,1,2,3].map(i=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,background:C.surface,border:`1px dashed ${C.border}`,borderRadius:8,padding:'8px 10px',opacity:0.4}}>
                <div style={{fontSize:12,color:C.muted}}>—</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {/* Draw button */}
      <div style={{display:'flex',gap:8,marginTop:4,marginBottom:drawn?20:0}}>
        {!drawn?<Btn onClick={autoDraw} style={{flex:1}}>🎲 Draw Groups</Btn>:<Btn onClick={confirm} variant="success" style={{flex:1}}>✓ Confirm & Generate Fixtures</Btn>}
      </div>
      {/* Drawn groups preview */}
      {drawn&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          {GROUPS.map(gid=>(
            <div key={gid} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:12}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.gold,letterSpacing:2,marginBottom:8}}>Group {gid}</div>
              {drawn[gid].map(nid=>{
                const n=nations.find(x=>x.id===nid);
                const pi=potOf(nid);
                return(
                  <div key={nid} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <TeamBadge color={n?.color||C.border} crest={n?.crest} size={20}/>
                    <span style={{fontSize:12,fontWeight:600,color:C.text,flex:1}}>{n?.name||'?'}</span>
                    <span style={{fontSize:9,color:POT_COLORS[pi],fontWeight:700,letterSpacing:1}}>{POT_LABELS[pi]}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── GroupCard ────────────────────────────────────────────────────────────────
function GroupCard({group,nations,groupMatches,onResult}){
  const ms=getGroupMatches(group.id,groupMatches);
  const standings=computeStandings(group.nationIds,ms,nations);
  const[hi,setHi]=useState({});const[ai,setAi]=useState({});
  const[simResult,setSimResult]=useState({});
  const[expanded,setExpanded]=useState({});
  const toggle=mid=>setExpanded(x=>({...x,[mid]:!x[mid]}));
  const inp={background:C.surface,border:`1px solid ${C.border}`,borderRadius:5,padding:'5px 0',color:C.text,fontSize:15,fontFamily:"'Bebas Neue',sans-serif",outline:'none',width:'100%',textAlign:'center'};
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:14,marginBottom:16}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:C.gold,letterSpacing:3,marginBottom:10}}>Group {group.id}</div>
      <table style={{width:'100%',borderCollapse:'collapse',marginBottom:14,fontSize:11}}>
        <thead><tr style={{color:C.muted}}><th style={{textAlign:'left',paddingBottom:6,fontWeight:600}}>Nation</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th style={{color:C.gold}}>Pts</th></tr></thead>
        <tbody>
          {standings.map((s,i)=>{const n=s.nation;return(
            <tr key={s.id} style={{borderTop:`1px solid ${C.border}33`}}>
              <td style={{padding:'5px 0',display:'flex',alignItems:'center',gap:6}}>
                {i<2&&<span style={{fontSize:9,color:C.green,fontWeight:700}}>●</span>}
                <TeamBadge color={n?.color||C.border} crest={n?.crest} size={14}/>
                <span style={{color:C.text,fontWeight:i<2?600:400}}>{n?.name||'?'}</span>
              </td>
              <td style={{textAlign:'center',color:C.muted}}>{s.P}</td>
              <td style={{textAlign:'center',color:s.W>0?C.green:C.muted}}>{s.W}</td>
              <td style={{textAlign:'center',color:s.D>0?C.gold:C.muted}}>{s.D}</td>
              <td style={{textAlign:'center',color:s.L>0?C.red:C.muted}}>{s.L}</td>
              <td style={{textAlign:'center',color:s.GD>0?C.green:s.GD<0?C.red:C.muted}}>{s.GD>0?'+':''}{s.GD}</td>
              <td style={{textAlign:'center',fontWeight:700,color:C.gold}}>{s.pts}</td>
            </tr>
          );})}
        </tbody>
      </table>
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:8}}>Fixtures</div>
        {GROUP_PAIRS.map(([ai2,bi2],idx)=>{
          const m=ms[idx];
          const hNation=nations.find(n=>n.id===group.nationIds[ai2]);
          const aNation=nations.find(n=>n.id===group.nationIds[bi2]);
          const mid=`wc_gm_${group.id}${idx+1}`;
          if(m?.played){return(
            <div key={idx} style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:8,padding:'6px 0',borderBottom:`1px solid ${C.border}22`}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:5,overflow:'hidden'}}>
                <span style={{fontSize:12,fontWeight:m.homeScore>m.awayScore?700:400,color:m.homeScore>m.awayScore?C.text:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{hNation?.name||'?'}</span>
                <TeamBadge color={hNation?.color||C.border} crest={hNation?.crest} size={16}/>
              </div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.gold,letterSpacing:2,textAlign:'center',minWidth:40}}>{m.homeScore}–{m.awayScore}</div>
              <div style={{display:'flex',alignItems:'center',gap:5,overflow:'hidden'}}>
                <TeamBadge color={aNation?.color||C.border} crest={aNation?.crest} size={16}/>
                <span style={{fontSize:12,fontWeight:m.awayScore>m.homeScore?700:400,color:m.awayScore>m.homeScore?C.text:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{aNation?.name||'?'}</span>
              </div>
            </div>
          );}
          const hv=hi[mid]??'',av=ai[mid]??'';
          const canSave=hv!==''&&av!==''&&!isNaN(parseInt(hv))&&!isNaN(parseInt(av));
          const sr=simResult[mid];
          const isOpen=expanded[mid]||!!sr;
          return(
            <div key={idx} style={{background:C.surface,border:`1px solid ${isOpen?C.border+'88':C.border+'44'}`,borderRadius:8,marginBottom:6,overflow:'hidden'}}>
              <div onClick={()=>toggle(mid)} style={{display:'flex',alignItems:'center',padding:'9px 12px',cursor:'pointer',gap:6,userSelect:'none'}}>
                <div style={{display:'flex',alignItems:'center',gap:5,flex:1,minWidth:0}}>
                  <TeamBadge color={hNation?.color||C.border} crest={hNation?.crest} size={14}/>
                  <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{hNation?.name||'?'}</span>
                </div>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:11,color:C.muted,letterSpacing:2,flexShrink:0}}>vs</span>
                <div style={{display:'flex',alignItems:'center',gap:5,flex:1,minWidth:0,flexDirection:'row-reverse'}}>
                  <TeamBadge color={aNation?.color||C.border} crest={aNation?.crest} size={14}/>
                  <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textAlign:'right'}}>{aNation?.name||'?'}</span>
                </div>
                <span style={{color:C.muted,fontSize:10,flexShrink:0,marginLeft:4}}>{isOpen?'▲':'▼'}</span>
              </div>
              {isOpen&&<div style={{padding:'0 12px 12px'}}>
                {hNation&&aNation&&<PitchView homeNation={hNation} awayNation={aNation}/>}
                {!sr&&<>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 20px 1fr',gap:4,alignItems:'center',marginTop:10,marginBottom:8}}>
                    <input type="number" min="0" value={hv} onChange={e=>setHi(x=>({...x,[mid]:e.target.value}))} placeholder="0" style={inp}/>
                    <div style={{textAlign:'center',color:C.muted,fontFamily:"'Bebas Neue',sans-serif"}}>–</div>
                    <input type="number" min="0" value={av} onChange={e=>setAi(x=>({...x,[mid]:e.target.value}))} placeholder="0" style={inp}/>
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    <Btn onClick={()=>{if(canSave)onResult(mid,group.nationIds[ai2],group.nationIds[bi2],parseInt(hv),parseInt(av));}} style={{flex:1,fontSize:11,opacity:canSave?1:0.4}}>Save</Btn>
                  </div>
                </>}
                <WCMatchSimPanel
                  hNation={hNation} aNation={aNation} sim={sr||null}
                  onSimulate={()=>{if(hNation&&aNation)setSimResult(x=>({...x,[mid]:simWCMatchFull(hNation,aNation)}));}}
                  onResim={()=>{if(hNation&&aNation)setSimResult(x=>({...x,[mid]:simWCMatchFull(hNation,aNation)}));}}
                  onSave={()=>{if(sr){onResult(mid,group.nationIds[ai2],group.nationIds[bi2],sr.hGoals,sr.aGoals);setSimResult(x=>({...x,[mid]:null}));}}}
                />
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── GroupsTab ────────────────────────────────────────────────────────────────
function GroupsTab({nations,wcMeta,setWcMeta,groupMatches,setGroupMatches}){
  const[toast,setToast]=useState('');
  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(''),3000);};
  const saveGroups=async gs=>{
    const meta={id:'wc_meta',type:'wc_meta',groups:gs,phase:'group'};
    setWcMeta(meta);
    await syncFixture(meta);
    // generate 12 group match stubs
    const newMatches=[];
    for(const g of gs){
      for(let i=0;i<3;i++){
        const [ai2,bi2]=GROUP_PAIRS[i];
        const fix={id:`wc_gm_${g.id}${i+1}`,type:'wc_group',group:g.id,homeId:g.nationIds[ai2],awayId:g.nationIds[bi2],played:false,homeScore:null,awayScore:null};
        await syncFixture(fix);
        newMatches.push(fix);
      }
    }
    setGroupMatches(newMatches);
    showToast('Groups set! Fixtures generated.');
  };
  const onResult=async(mid,homeId,awayId,homeScore,awayScore)=>{
    const fix={id:mid,type:'wc_group',homeId,awayId,played:true,homeScore,awayScore,group:mid.replace('wc_gm_','')[0]};
    setGroupMatches(ms=>ms.map(m=>m.id===mid?fix:m));
    await syncFixture(fix);
  };
  if(!wcMeta?.groups){return<div style={{paddingBottom:40}}><GroupDrawView nations={nations} wcMeta={wcMeta} onSaveGroups={saveGroups} onToast={showToast}/>{toast&&<div style={{position:'fixed',bottom:80,left:'50%',transform:'translateX(-50%)',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 18px',fontSize:13,color:C.text,zIndex:50,whiteSpace:'nowrap'}}>{toast}</div>}</div>;}
  return(
    <div style={{paddingBottom:40}}>
      <div style={{marginBottom:16}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:C.gold,letterSpacing:3}}>Group Stage</div>
      </div>
      {wcMeta.groups.map(g=><GroupCard key={g.id} group={g} nations={nations} groupMatches={groupMatches} onResult={onResult}/>)}
      {toast&&<div style={{position:'fixed',bottom:80,left:'50%',transform:'translateX(-50%)',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 18px',fontSize:13,color:C.text,zIndex:50,whiteSpace:'nowrap'}}>{toast}</div>}
    </div>
  );
}

// ── KnockoutTab ──────────────────────────────────────────────────────────────
const BRACKET_ROUNDS=[
  {id:'qf',label:'Quarter Finals',matches:[[0,1],[2,3],[4,5],[6,7]],seeds:['1A','2B','1C','2D','1B','2A','1D','2C']},
  {id:'sf',label:'Semi Finals',matches:[[0,1],[2,3]]},
  {id:'final',label:'Final',matches:[[0,1]]},
  {id:'third',label:'3rd Place',matches:[[0,1]]},
];

function KnockoutMatchCard({match,nations,onResult,disabled}){
  const[hi,setHi]=useState('');const[ai,setAi]=useState('');
  const[simResult,setSimResult]=useState(null);
  const[expanded,setExpanded]=useState(false);
  const inp={background:C.surface,border:`1px solid ${C.border}`,borderRadius:5,padding:'5px 0',color:C.text,fontSize:15,fontFamily:"'Bebas Neue',sans-serif",outline:'none',width:'100%',textAlign:'center'};
  const hN=nations.find(n=>n.id===match?.homeId);
  const aN=nations.find(n=>n.id===match?.awayId);
  if(!match?.homeId&&!match?.awayId)return(
    <div style={{background:C.surface,border:`1px solid ${C.border}33`,borderRadius:8,padding:'10px 14px',marginBottom:8,opacity:0.5}}>
      <div style={{fontSize:12,color:C.muted,textAlign:'center'}}>TBD</div>
    </div>
  );
  if(match?.played)return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 14px',marginBottom:8}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:8}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:5,overflow:'hidden'}}>
          <span style={{fontSize:12,fontWeight:match.homeScore>match.awayScore?700:400,color:match.homeScore>match.awayScore?C.text:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{hN?.name||'?'}</span>
          <TeamBadge color={hN?.color||C.border} crest={hN?.crest} size={16}/>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:C.gold,letterSpacing:2}}>{match.homeScore}–{match.awayScore}</div>
          {match.et&&<div style={{fontSize:9,color:C.muted,letterSpacing:1}}>AET</div>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:5,overflow:'hidden'}}>
          <TeamBadge color={aN?.color||C.border} crest={aN?.crest} size={16}/>
          <span style={{fontSize:12,fontWeight:match.awayScore>match.homeScore?700:400,color:match.awayScore>match.homeScore?C.text:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{aN?.name||'?'}</span>
        </div>
      </div>
    </div>
  );
  const canSave=hi!==''&&ai!==''&&!isNaN(parseInt(hi))&&!isNaN(parseInt(ai))&&parseInt(hi)!==parseInt(ai);
  const doSim=()=>{if(hN&&aN)setSimResult(simWCMatchFull(hN,aN,{knockout:true}));};
  const isOpen=expanded||!!simResult;
  return(
    <div style={{background:C.card,border:`1px solid ${isOpen?C.border:C.border+'55'}`,borderRadius:8,marginBottom:8,overflow:'hidden',opacity:disabled?0.6:1}}>
      <div onClick={()=>setExpanded(x=>!x)} style={{display:'flex',alignItems:'center',padding:'10px 14px',cursor:'pointer',gap:6,userSelect:'none'}}>
        <div style={{display:'flex',alignItems:'center',gap:5,flex:1,minWidth:0}}>
          <TeamBadge color={hN?.color||C.border} crest={hN?.crest} size={14}/>
          <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{hN?.name||'TBD'}</span>
        </div>
        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:11,color:C.muted,letterSpacing:2,flexShrink:0}}>vs</span>
        <div style={{display:'flex',alignItems:'center',gap:5,flex:1,minWidth:0,flexDirection:'row-reverse'}}>
          <TeamBadge color={aN?.color||C.border} crest={aN?.crest} size={14}/>
          <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textAlign:'right'}}>{aN?.name||'TBD'}</span>
        </div>
        <span style={{color:C.muted,fontSize:10,flexShrink:0,marginLeft:4}}>{isOpen?'▲':'▼'}</span>
      </div>
      {isOpen&&<div style={{padding:'0 14px 14px'}}>
        {hN&&aN&&<PitchView homeNation={hN} awayNation={aN}/>}
        {!disabled&&!simResult&&<>
          <div style={{display:'grid',gridTemplateColumns:'1fr 20px 1fr',gap:4,alignItems:'center',marginTop:10,marginBottom:8}}>
            <input type="number" min="0" value={hi} onChange={e=>setHi(e.target.value)} placeholder="0" style={inp}/>
            <div style={{textAlign:'center',color:C.muted,fontFamily:"'Bebas Neue',sans-serif"}}>–</div>
            <input type="number" min="0" value={ai} onChange={e=>setAi(e.target.value)} placeholder="0" style={inp}/>
          </div>
          <div style={{fontSize:10,color:C.muted,textAlign:'center',marginBottom:6}}>No draws — scores must differ</div>
          <div style={{display:'flex',gap:6}}>
            <Btn onClick={()=>{if(canSave)onResult(match,parseInt(hi),parseInt(ai));}} style={{flex:1,fontSize:11,opacity:canSave?1:0.4}}>Save</Btn>
          </div>
        </>}
        {!disabled&&<WCMatchSimPanel
          hNation={hN} aNation={aN} sim={simResult} knockout
          onSimulate={doSim} onResim={doSim}
          onSave={()=>{if(simResult){onResult(match,simResult.hGoals,simResult.aGoals,simResult.et);setSimResult(null);}}}
        />}
      </div>}
    </div>
  );
}

function KnockoutTab({nations,wcMeta,groupMatches,wcBracket,setWcBracket}){
  const seeds=useMemo(()=>getKnockoutSeeds(wcMeta,groupMatches,nations),[wcMeta,groupMatches,nations]);
  const[toast,setToast]=useState('');
  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(''),3000);};
  const initBracket=()=>{
    if(!seeds)return null;
    const qf=BRACKET_ROUNDS[0].seeds.map((s,i)=>{
      const isHome=i%2===0;
      const partnerIdx=isHome?i+1:i-1;
      if(isHome)return{homeId:seeds[BRACKET_ROUNDS[0].seeds[i]],awayId:seeds[BRACKET_ROUNDS[0].seeds[i+1]],played:false,homeScore:null,awayScore:null,et:false};
      return null;
    }).filter(Boolean);
    return{id:'wc_bracket',type:'wc_bracket',qf,sf:[{homeId:null,awayId:null,played:false},{homeId:null,awayId:null,played:false}],final:{homeId:null,awayId:null,played:false},third:{homeId:null,awayId:null,played:false}};
  };
  const bracket=wcBracket||(seeds?initBracket():null);
  const saveBracket=async b=>{setWcBracket(b);await syncFixture(b);};
  const winnerId=m=>m?.played?(m.homeScore>m.awayScore?m.homeId:m.awayId):null;
  const loserId=m=>m?.played?(m.homeScore<m.awayScore?m.homeId:m.awayId):null;
  const onResult=async(round,idx,match,hs,as,et=false)=>{
    if(!bracket)return;
    const b=JSON.parse(JSON.stringify(bracket));
    const updated={...match,played:true,homeScore:hs,awayScore:as,et};
    if(round==='qf'){
      b.qf[idx]=updated;
      const sfIdx=Math.floor(idx/2);
      const sfHome=idx%2===0;
      const w=hs>as?match.homeId:match.awayId;
      if(sfHome)b.sf[sfIdx]={...b.sf[sfIdx],homeId:w};
      else b.sf[sfIdx]={...b.sf[sfIdx],awayId:w};
    }else if(round==='sf'){
      b.sf[idx]=updated;
      const w=hs>as?match.homeId:match.awayId;
      const l=hs>as?match.awayId:match.homeId;
      if(idx===0){b.final={...b.final,homeId:w};b.third={...b.third,homeId:l};}
      else{b.final={...b.final,awayId:w};b.third={...b.third,awayId:l};}
    }else if(round==='final'){b.final=updated;}
    else if(round==='third'){b.third=updated;}
    await saveBracket(b);
  };
  if(!wcMeta?.groups)return<Empty icon="🏟" msg="Set up groups first." hint="Go to the Groups tab to assign nations."/>;
  const allGroupsPlayed=wcMeta.groups.every(g=>{const ms=getGroupMatches(g.id,groupMatches);return ms.every(m=>m&&m.played);});
  if(!seeds&&!allGroupsPlayed)return<div style={{paddingBottom:40}}><div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:20,textAlign:'center'}}><div style={{fontSize:24,marginBottom:8}}>🏟</div><div style={{fontSize:14,color:C.sub}}>Complete all group stage matches to unlock the knockout round.</div></div></div>;
  const champion=winnerId(bracket?.final);
  const champNation=nations.find(n=>n.id===champion);
  return(
    <div style={{paddingBottom:40}}>
      {champion&&<div style={{background:'linear-gradient(135deg,#1a0f00 0%,#2d1a00 50%,#1a0f00 100%)',border:`1px solid ${C.gold}88`,borderRadius:12,padding:'20px',marginBottom:20,textAlign:'center'}}>
        <div style={{fontSize:32,marginBottom:8}}>🏆</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.gold,letterSpacing:4}}>WORLD CHAMPION</div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:12,marginTop:10}}>
          <TeamBadge color={champNation?.color||C.border} crest={champNation?.crest} size={40}/>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.white,letterSpacing:2}}>{champNation?.name}</div>
        </div>
      </div>}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10}}>Quarter Finals</div>
        {(bracket?.qf||[]).map((m,i)=><KnockoutMatchCard key={i} match={m} nations={nations} onResult={(m,hs,as,et)=>onResult('qf',i,m,hs,as,et)} disabled={!m?.homeId||!m?.awayId}/>)}
      </div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10}}>Semi Finals</div>
        {(bracket?.sf||[{},{},]).map((m,i)=><KnockoutMatchCard key={i} match={m} nations={nations} onResult={(m,hs,as,et)=>onResult('sf',i,m,hs,as,et)} disabled={!m?.homeId||!m?.awayId}/>)}
      </div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10}}>3rd Place</div>
        <KnockoutMatchCard match={bracket?.third} nations={nations} onResult={(m,hs,as,et)=>onResult('third',0,m,hs,as,et)} disabled={!bracket?.third?.homeId||!bracket?.third?.awayId}/>
      </div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10}}>Final</div>
        <KnockoutMatchCard match={bracket?.final} nations={nations} onResult={(m,hs,as,et)=>onResult('final',0,m,hs,as,et)} disabled={!bracket?.final?.homeId||!bracket?.final?.awayId}/>
      </div>
      {toast&&<div style={{position:'fixed',bottom:80,left:'50%',transform:'translateX(-50%)',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 18px',fontSize:13,color:C.text,zIndex:50}}>{toast}</div>}
    </div>
  );
}

// ── NationsTab ───────────────────────────────────────────────────────────────
function NationsTab({nations}){
  const named=nations.filter(n=>n.name&&n.players.length>0);
  const[mode,setMode]=useState('atk');
  const[selId,setSelId]=useState(null);
  const rated=named.map(n=>({...n,...lineupRatings(n)})).sort((a,b)=>mode==='atk'?b.atk-a.atk:b.def-a.def);
  const allPlayers=named.flatMap(n=>n.players.filter(p=>p.name).map(p=>({...p,nation:n})));
  const sel=selId?nations.find(n=>n.id===selId):null;
  return(
    <div style={{paddingBottom:40}}>
      {sel?(
        <div>
          <button onClick={()=>setSelId(null)} style={{background:'none',border:'none',color:C.accent,fontSize:13,cursor:'pointer',marginBottom:16,padding:0,fontFamily:"'DM Sans',sans-serif"}}>← All Nations</button>
          <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:20}}>
            <TeamBadge color={sel.color} crest={sel.crest} size={52}/>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:C.text,letterSpacing:2}}>{sel.name}</div>
              <div style={{display:'flex',gap:8,marginTop:4}}>
                {(()=>{const r=lineupRatings(sel);return<><span style={{fontSize:11,color:C.red,fontWeight:700}}>ATK {r.atk}</span><span style={{fontSize:11,color:C.green,fontWeight:700}}>DEF {r.def}</span></>;})()}
              </div>
            </div>
          </div>
          {['GK','DEF','MDF','FWD'].map(pos=>{const ps=sel.players.filter(p=>p.position===pos&&p.name);if(!ps.length)return null;return(
            <div key={pos} style={{marginBottom:12}}>
              <div style={{fontSize:9,color:posColor(pos),fontWeight:700,letterSpacing:2,textTransform:'uppercase',marginBottom:6}}>{pos}</div>
              {ps.map(p=>(
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:4}}>
                  <div style={{background:posColor(p.position)+"22",color:posColor(p.position),borderRadius:4,padding:'2px 6px',fontSize:10,fontWeight:700,flexShrink:0}}>{p.position}</div>
                  <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{p.name}</div><div style={{fontSize:11,color:C.muted}}>{p.club||'—'}</div></div>
                  {p.position==='MDF'?<div style={{display:'flex',gap:6}}><span style={{fontSize:10,color:C.red}}>A{p.mdfAtkScore}</span><span style={{fontSize:10,color:C.green}}>D{p.mdfDefScore}</span></div>:p.position!=='GK'?<span style={{fontSize:13,fontWeight:700,color:C.gold}}>{p.score}</span>:null}
                </div>
              ))}
            </div>
          );})}
        </div>
      ):(
        <>
          <div style={{display:'flex',gap:8,marginBottom:20}}>
            {['atk','def'].map(m=><button key={m} onClick={()=>setMode(m)} style={{flex:1,background:mode===m?C.accent:C.surface,border:`1px solid ${mode===m?C.accent:C.border}`,borderRadius:8,color:mode===m?C.white:C.muted,padding:'8px 0',fontSize:12,fontWeight:700,cursor:'pointer',letterSpacing:1,textTransform:'uppercase',fontFamily:"'DM Sans',sans-serif"}}>{m==='atk'?'⚔ Attack':'🛡 Defense'}</button>)}
          </div>
          {named.length===0?<Empty icon="🌍" msg="No nations set up yet." hint="Go to Manage → Nations to add squads."/>:
          rated.map((n,i)=>(
            <div key={n.id} onClick={()=>setSelId(n.id)} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:C.card,border:`1px solid ${C.border}`,borderRadius:10,marginBottom:8,cursor:'pointer'}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.muted,width:20,textAlign:'center'}}>{i+1}</div>
              <TeamBadge color={n.color} crest={n.crest} size={32}/>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:700,color:C.text}}>{n.name}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{n.players.filter(p=>p.name).length} players</div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontSize:13,color:mode==='atk'?C.red:C.muted,fontWeight:mode==='atk'?700:400}}>ATK {n.atk}</span>
                <span style={{fontSize:13,color:mode==='def'?C.green:C.muted,fontWeight:mode==='def'?700:400}}>DEF {n.def}</span>
              </div>
            </div>
          ))}
          {allPlayers.length>0&&<>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.muted,letterSpacing:2,marginTop:24,marginBottom:10}}>Top {mode==='atk'?'Attackers':'Defenders'}</div>
            {allPlayers.filter(p=>mode==='atk'?p.position==='FWD'||(p.position==='MDF'):p.position==='DEF'||(p.position==='MDF'))
              .sort((a,b)=>mode==='atk'?(b.position==='MDF'?b.mdfAtkScore:b.score)-(a.position==='MDF'?a.mdfAtkScore:a.score):(b.position==='MDF'?b.mdfDefScore:b.score)-(a.position==='MDF'?a.mdfDefScore:a.score))
              .slice(0,10).map((p,i)=>(
                <div key={`${p.id}-${p.nation.id}`} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:6}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:C.muted,width:18,textAlign:'center'}}>{i+1}</div>
                  <TeamBadge color={p.nation.color} crest={p.nation.crest} size={20}/>
                  <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{p.name}</div><div style={{fontSize:11,color:C.muted}}>{p.nation.name}</div></div>
                  <div style={{background:posColor(p.position)+"22",color:posColor(p.position),borderRadius:4,padding:'2px 6px',fontSize:10,fontWeight:700}}>{p.position}</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.gold}}>{mode==='atk'?(p.position==='MDF'?p.mdfAtkScore:p.score):(p.position==='MDF'?p.mdfDefScore:p.score)}</div>
                </div>
              ))}
          </>}
        </>
      )}
    </div>
  );
}

// ── TeamsTab ─────────────────────────────────────────────────────────────────
function TeamsTab({nations}){
  const named=nations.filter(n=>n.name&&n.players.some(p=>p.name));
  if(!named.length)return <Empty icon="🌍" msg="No nations set up yet." hint="Go to Manage → Nations to add squads."/>;
  const sorted=[...named].map(n=>({n,r:lineupRatings(n)})).sort((a,b)=>(b.r.atk+b.r.def)-(a.r.atk+a.r.def));
  return(<div style={{paddingBottom:40}}>{sorted.map(({n})=><NationBreakdown key={n.id} nation={n}/>)}</div>);
}
function NationBreakdown({nation}){
  const[open,setOpen]=useState(true);
  const lu=pickWCLineup(nation);
  const ratings=lineupRatings(nation);
  const bySlot={GK:lu.gk?[{...lu.gk,_slot:'GK'}]:[],DEF:lu.starters.filter(p=>p._slot==='DEF'),MDF:lu.starters.filter(p=>p._slot==='MDF'),FWD:lu.starters.filter(p=>p._slot==='FWD')};
  const slotMeta={GK:{label:'Goalkeeper',color:C.gold},DEF:{label:'Defence',color:C.green},MDF:{label:'Midfield',color:C.accent},FWD:{label:'Attack',color:C.red}};
  const primaryScore=p=>p.position==='MDF'?((p.mdfAtkScore||5)+(p.mdfDefScore||5))/2:(p.score||5);
  const outOfPos=p=>p._slot&&p._slot!=='GK'&&p.position!==p._slot;
  const lastName=p=>(p.name||'').trim().split(/\s+/).filter(Boolean).pop()||(p.name||'').trim()||'—';
  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,marginBottom:10,overflow:'hidden'}}>
      <div onClick={()=>setOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',cursor:'pointer'}}>
        <TeamBadge color={nation.color} crest={nation.crest} size={36}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:15,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nation.name}</div>
          <div style={{display:'flex',gap:8,marginTop:3}}>
            <span style={{fontSize:10,color:C.muted,letterSpacing:1,textTransform:'uppercase'}}>{lu.formation.name}</span>
            <span style={{fontSize:10,color:C.red,fontWeight:700}}>ATK {ratings.atk}</span>
            <span style={{fontSize:10,color:C.green,fontWeight:700}}>DEF {ratings.def}</span>
          </div>
        </div>
        <span style={{fontSize:11,color:C.muted}}>{open?'▲':'▼'}</span>
      </div>
      {open&&(
        <div style={{borderTop:`1px solid ${C.border}`,padding:'10px 12px 14px'}}>
          {['GK','DEF','MDF','FWD'].map(slot=>{
            const players=bySlot[slot];
            if(!players.length)return null;
            const{label,color}=slotMeta[slot];
            return(
              <div key={slot} style={{marginBottom:10}}>
                <div style={{fontSize:8,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color,opacity:0.65,marginBottom:5}}>{label}</div>
                {players.map(p=>{
                  const oop=outOfPos(p);
                  return(
                    <div key={p.id} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',background:C.card,border:`1px solid ${oop?'rgba(244,162,97,0.35)':C.border}`,borderRadius:7,marginBottom:4}}>
                      <div style={{background:posColor(p._slot||p.position)+'22',color:posColor(p._slot||p.position),borderRadius:4,padding:'2px 5px',fontSize:9,fontWeight:700,flexShrink:0,minWidth:30,textAlign:'center'}}>{p._slot||p.position}</div>
                      <div style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><span style={{fontSize:13,fontWeight:600,color:C.text}}>{p.name}</span></div>
                      {oop&&<div style={{background:'rgba(244,162,97,0.1)',border:'1px solid rgba(244,162,97,0.4)',color:'#f4a261',borderRadius:4,padding:'1px 6px',fontSize:9,fontWeight:700,flexShrink:0}}>{p.position}→{p._slot}</div>}
                      {p.position==='MDF'?(
                        <div style={{display:'flex',gap:4,flexShrink:0}}>
                          <span style={{fontSize:9,color:C.red,fontWeight:700}}>A{p.mdfAtkScore||5}</span>
                          <span style={{fontSize:9,color:C.green,fontWeight:700}}>D{p.mdfDefScore||5}</span>
                        </div>
                      ):(
                        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.gold,flexShrink:0,lineHeight:1}}>{primaryScore(p)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {lu.bench.length>0&&(
            <div style={{borderTop:`1px solid rgba(255,255,255,0.06)`,paddingTop:8,marginTop:2}}>
              <div style={{fontSize:8,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:C.muted,opacity:0.5,marginBottom:5}}>Bench</div>
              <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                {lu.bench.map(p=>(
                  <div key={p.id} style={{display:'flex',alignItems:'center',gap:4,background:nation.color+'18',border:`1px solid ${nation.color}33`,borderRadius:5,padding:'3px 7px'}}>
                    <span style={{fontSize:9,color:nation.color,fontWeight:700}}>{(p.position||'')[0]}</span>
                    <span style={{fontSize:11,color:C.muted}}>{lastName(p)}</span>
                    {p.position==='MDF'?<span style={{fontSize:9,color:C.muted,opacity:0.7}}>A{p.mdfAtkScore||5}/D{p.mdfDefScore||5}</span>:p.position!=='GK'?<span style={{fontSize:9,color:C.muted,opacity:0.7}}>{p.score||5}</span>:null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── WCSetupView ──────────────────────────────────────────────────────────────
function WCSetupView({nations,wcMeta,groupMatches,setWcMeta,setGroupMatches,onToast}){
  const[confirm,setConfirm]=useState(false);
  const saveGroups=async gs=>{
    const meta={id:'wc_meta',type:'wc_meta',groups:gs,phase:'group'};
    setWcMeta(meta);await syncFixture(meta);
    const newMatches=[];
    for(const g of gs){for(let i=0;i<3;i++){
      const[ai2,bi2]=GROUP_PAIRS[i];
      const fix={id:`wc_gm_${g.id}${i+1}`,type:'wc_group',group:g.id,homeId:g.nationIds[ai2],awayId:g.nationIds[bi2],played:false,homeScore:null,awayScore:null};
      await syncFixture(fix);newMatches.push(fix);
    }}
    setGroupMatches(newMatches);onToast('Groups confirmed!');
  };
  const resetGroups=async()=>{
    const cleared={...wcMeta,groups:null};
    setWcMeta(cleared);await syncFixture({...cleared,id:'wc_meta'});
    const cleared2=groupMatches.map(m=>({...m,played:false,homeScore:null,awayScore:null}));
    for(const m of cleared2)await syncFixture(m);
    setGroupMatches(cleared2);setConfirm(false);onToast('Draw reset');
  };
  if(!wcMeta?.groups)return<GroupDrawView nations={nations} wcMeta={wcMeta} onSaveGroups={saveGroups} onToast={onToast}/>;
  return(
    <div>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:16,marginBottom:16}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.gold,letterSpacing:2,marginBottom:12}}>Current Groups</div>
        {wcMeta.groups.map(g=>(
          <div key={g.id} style={{marginBottom:10}}>
            <div style={{fontSize:11,color:C.muted,fontWeight:700,letterSpacing:1.5,marginBottom:5}}>Group {g.id}</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {g.nationIds.map(id=>{const n=nations.find(x=>x.id===id);return n?(
                <div key={id} style={{display:'flex',alignItems:'center',gap:5,background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:'4px 8px'}}>
                  <TeamBadge color={n.color||C.border} crest={n.crest} size={14}/>
                  <span style={{fontSize:11,color:C.text}}>{n.name||'Unnamed'}</span>
                </div>
              ):null;})}
            </div>
          </div>
        ))}
      </div>
      {!confirm&&<Btn onClick={()=>setConfirm(true)} variant="danger" style={{width:'100%'}}>🎲 Reset Draw</Btn>}
      {confirm&&(
        <div style={{background:'#1a0a0a',border:`1px solid ${C.red}44`,borderRadius:8,padding:14,textAlign:'center'}}>
          <div style={{fontSize:13,color:C.sub,marginBottom:12}}>This will clear the current group draw. All group match results will also be cleared. Continue?</div>
          <div style={{display:'flex',gap:8}}>
            <Btn onClick={()=>setConfirm(false)} variant="secondary" style={{flex:1}}>Cancel</Btn>
            <Btn onClick={resetGroups} variant="danger" style={{flex:1}}>Reset</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ManageTab ────────────────────────────────────────────────────────────────
function ManageTab({nations,setNations,teams,wcMeta,setWcMeta,groupMatches,setGroupMatches,onToast}){
  const[unlocked,setUnlocked]=useState(false);
  const[showPrompt,setShowPrompt]=useState(false);
  const[view,setView]=useState('nations');
  if(!unlocked)return(
    <div style={{paddingBottom:40,display:'flex',flexDirection:'column',alignItems:'center',paddingTop:60}}>
      <div style={{fontSize:32,marginBottom:16}}>🔒</div>
      <div style={{fontSize:14,color:C.sub,marginBottom:24,textAlign:'center'}}>Manage is password protected</div>
      <Btn onClick={()=>setShowPrompt(true)}>Unlock Manage</Btn>
      {showPrompt&&<ManagePasswordModal onSuccess={()=>{setUnlocked(true);setShowPrompt(false);}} onCancel={()=>setShowPrompt(false)}/>}
    </div>
  );
  return(
    <div style={{paddingBottom:40}}>
      <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
        {['nations','wc_setup'].map(v=>(
          <button key={v} onClick={()=>setView(v)} style={{background:view===v?C.accent:C.surface,border:`1px solid ${view===v?C.accent:C.border}`,borderRadius:8,color:view===v?C.white:C.muted,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>
            {v==='nations'?'Nations':v==='wc_setup'?'WC Setup':v}
          </button>
        ))}
      </div>
      {view==='nations'&&<NationsManageView nations={nations} setNations={setNations} teams={teams} onToast={onToast}/>}
      {view==='wc_setup'&&<WCSetupView nations={nations} wcMeta={wcMeta} groupMatches={groupMatches} setWcMeta={setWcMeta} setGroupMatches={setGroupMatches} onToast={onToast}/>}
    </div>
  );
}

// ── CareerTab ────────────────────────────────────────────────────────────────
function CareerTab({nations,wcMeta,groupMatches}){
  const[career,setCareer]=useState(()=>{try{const s=localStorage.getItem(WC_CAREER_KEY);return s?JSON.parse(s):null;}catch{return null;}});
  const saveCareer=c=>{setCareer(c);try{if(c)localStorage.setItem(WC_CAREER_KEY,JSON.stringify(c));}catch{}};
  const resetCareer=()=>{try{localStorage.removeItem(WC_CAREER_KEY);}catch{}setCareer(null);};
  const named=nations.filter(n=>n.name&&n.players.length>0);
  // Phase: pick
  if(!career){
    return(
      <div style={{paddingBottom:40}}>
        <div style={{background:'linear-gradient(135deg,#0a1628 0%,#0f2044 50%,#0a1628 100%)',border:`1px solid #1a3060`,borderRadius:12,padding:'20px',marginBottom:20,textAlign:'center'}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.gold,letterSpacing:4}}>WC CAREER</div>
          <div style={{fontSize:12,color:C.muted,marginTop:4}}>Pick your nation and lead them to glory</div>
        </div>
        {named.length===0?<Empty icon="🌍" msg="No nations set up yet." hint="Go to Manage → Nations to create squads."/>:(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {named.map(n=>(
              <div key={n.id} onClick={()=>{const myGroup=wcMeta?.groups?.find(g=>g.nationIds.includes(n.id));saveCareer({nationId:n.id,groupId:myGroup?.id||null,lineup:[],results:{},phase:'lineup'});}} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14,cursor:'pointer',display:'flex',alignItems:'center',gap:10}} onMouseOver={e=>e.currentTarget.style.borderColor=C.accent} onMouseOut={e=>e.currentTarget.style.borderColor=C.border}>
                <TeamBadge color={n.color} crest={n.crest} size={36}/>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:C.text}}>{n.name}</div>
                  <div style={{display:'flex',gap:6,marginTop:3}}>{(()=>{const r=lineupRatings(n);return<><span style={{fontSize:11,color:C.red}}>ATK {r.atk}</span><span style={{fontSize:11,color:C.green}}>DEF {r.def}</span></>;})()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  const myNation=nations.find(n=>n.id===career.nationId);
  if(!myNation)return<div style={{padding:20,color:C.red}}>Nation not found. <button onClick={resetCareer} style={{color:C.accent,background:'none',border:'none',cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>Start over</button></div>;
  const myGroup=wcMeta?.groups?.find(g=>g.nationIds.includes(career.nationId));
  const myGroupNations=myGroup?myGroup.nationIds.map(id=>nations.find(n=>n.id===id)).filter(Boolean):[];
  const myMatches=myGroup?GROUP_PAIRS.map(([ai2,bi2],i)=>{
    const hId=myGroup.nationIds[ai2],aId=myGroup.nationIds[bi2];
    if(hId!==career.nationId&&aId!==career.nationId)return null;
    return{matchIdx:i,homeId:hId,awayId:aId,pairOppId:hId===career.nationId?aId:hId,isHome:hId===career.nationId};
  }).filter(Boolean):[];
  const careerResults=career.results||{};
  const getResult=mid=>careerResults[mid]||null;
  const myGroupMatches=myGroup?GROUP_PAIRS.map(([ai2,bi2],i)=>{
    const mid=`career_gm_${myGroup.id}${i+1}`;
    const hId=myGroup.nationIds[ai2],aId=myGroup.nationIds[bi2];
    const r=careerResults[mid];
    return r?{id:mid,homeId:hId,awayId:aId,played:true,...r}:{id:mid,homeId:hId,awayId:aId,played:false};
  }):[],
  standings=myGroup?computeStandings(myGroup.nationIds,myGroupMatches,nations):[];
  const myStanding=standings.find(s=>s.id===career.nationId);
  const groupComplete=myGroupMatches.every(m=>m.played);
  const qualified=groupComplete&&standings.indexOf(myStanding)<=1;
  const eliminated=groupComplete&&!qualified;
  const[hi,setHi]=useState('');const[ai,setAi]=useState('');
  const[careerSim,setCareerSim]=useState(null);
  const[koIsHome,setKoIsHome]=useState(career.koIsHome??null);
  const[savedLineup,setSavedLineup]=useState(career.savedLineup||[]);
  const inp={background:C.surface,border:`1px solid ${C.border}`,borderRadius:5,padding:'5px 0',color:C.text,fontSize:15,fontFamily:"'Bebas Neue',sans-serif",outline:'none',width:'100%',textAlign:'center'};
  const playMatch=(matchIdx,isHome,oppId)=>{
    const mid=`career_gm_${myGroup.id}${matchIdx+1}`;
    if(careerResults[mid])return;
    // Auto-sim other group match first if not played
    const otherIdx=GROUP_PAIRS.findIndex(([ai2,bi2])=>myGroup.nationIds[ai2]!==career.nationId&&myGroup.nationIds[bi2]!==career.nationId);
    const updates={};
    if(otherIdx>=0){
      const omid=`career_gm_${myGroup.id}${otherIdx+1}`;
      if(!careerResults[omid]){
        const[oai,obi]=GROUP_PAIRS[otherIdx];
        const oH=nations.find(n=>n.id===myGroup.nationIds[oai]);
        const oA=nations.find(n=>n.id===myGroup.nationIds[obi]);
        if(oH&&oA){const or=simWCMatch(oH,oA);updates[omid]={homeScore:or.hGoals,awayScore:or.aGoals};}
      }
    }
    const hv=parseInt(hi),av=parseInt(ai);
    if(isNaN(hv)||isNaN(av))return;
    updates[mid]={homeScore:hv,awayScore:av};
    saveCareer({...career,results:{...careerResults,...updates}});
    setHi('');setAi('');
  };
  const simMyMatch=(matchIdx,isHome,oppId)=>{
    const mid=`career_gm_${myGroup.id}${matchIdx+1}`;
    if(careerResults[mid])return;
    const otherIdx=GROUP_PAIRS.findIndex(([ai2,bi2])=>myGroup.nationIds[ai2]!==career.nationId&&myGroup.nationIds[bi2]!==career.nationId);
    const pendingUpdates={};
    if(otherIdx>=0){
      const omid=`career_gm_${myGroup.id}${otherIdx+1}`;
      if(!careerResults[omid]){
        const[oai,obi]=GROUP_PAIRS[otherIdx];
        const oH=nations.find(n=>n.id===myGroup.nationIds[oai]);
        const oA=nations.find(n=>n.id===myGroup.nationIds[obi]);
        if(oH&&oA){const or=simWCMatch(oH,oA);pendingUpdates[omid]={homeScore:or.hGoals,awayScore:or.aGoals};}
      }
    }
    const hN=isHome?myNation:nations.find(n=>n.id===oppId);
    const aN=isHome?nations.find(n=>n.id===oppId):myNation;
    if(!hN||!aN)return;
    const myLU=savedLineup.length>=5?buildWCCareerLineup(myNation,savedLineup):null;
    const result=simWCMatchFull(hN,aN,{homeLineup:isHome?myLU:null,awayLineup:isHome?null:myLU});
    setCareerSim({matchId:mid,hNation:hN,aNation:aN,result,type:'group',pendingUpdates});
  };
  const applyGroupSim=()=>{
    if(!careerSim||careerSim.type!=='group')return;
    const{matchId,result,pendingUpdates}=careerSim;
    const myTeam=careerSim.hNation.id===career.nationId?'home':'away';
    const updates={...pendingUpdates,[matchId]:{homeScore:result.hGoals,awayScore:result.aGoals}};
    const newStats=accumulateWCStats(career.stats||{},result.events,myTeam);
    saveCareer({...career,results:{...careerResults,...updates},stats:newStats});
    setCareerSim(null);
  };
  // Knockout phase
  const[koPhase,setKoPhase]=useState(career.koPhase||'qf');
  const[koResults,setKoResults]=useState(career.koResults||{});
  const[koHi,setKoHi]=useState('');const[koAi,setKoAi]=useState('');
  const[koOpponent,setKoOpponent]=useState(career.koOpponent||null);
  useEffect(()=>{
    if(!qualified||koPhase==='champion'||koPhase==='eliminated')return;
    const updates={};
    if(!koOpponent){
      const pool=named.filter(n=>n.id!==career.nationId);
      const nextOpp=pool[Math.floor(Math.random()*pool.length)]?.id;
      if(nextOpp){setKoOpponent(nextOpp);updates.koOpponent=nextOpp;}
    }
    if(koIsHome===null){const ih=Math.random()<0.5;setKoIsHome(ih);updates.koIsHome=ih;}
    if(Object.keys(updates).length)saveCareer({...career,...updates});
  },[qualified,koPhase,koOpponent,koIsHome]);
  const saveKo=(phase,result,nextOpp,nextPhase)=>{
    const kr={...koResults,[phase]:result};
    const nextIH=nextOpp?Math.random()<0.5:null;
    setKoResults(kr);setKoOpponent(nextOpp||null);setKoPhase(nextPhase||phase);setKoIsHome(nextIH);
    saveCareer({...career,koPhase:nextPhase||phase,koResults:kr,koOpponent:nextOpp||null,koIsHome:nextIH});
  };
  const doKoMatch=(isHome,oppNation)=>{
    const hv=parseInt(koHi),av=parseInt(koAi);
    if(isNaN(hv)||isNaN(av)||hv===av)return;
    const myWon=isHome?hv>av:av>hv;
    const phaseOrder=['qf','sf','final'];
    const nextPhase=myWon?phaseOrder[phaseOrder.indexOf(koPhase)+1]||'champion':'eliminated';
    const nextOpp=myWon&&nextPhase!=='champion'?named.filter(n=>n.id!==career.nationId)[Math.floor(Math.random()*named.filter(n=>n.id!==career.nationId).length)]?.id||null:null;
    saveKo(koPhase,{homeScore:hv,awayScore:av},nextOpp,nextPhase);
    setKoHi('');setKoAi('');
  };
  const startKoSim=(isHome,oppNation)=>{
    const hN=isHome?myNation:oppNation;
    const aN=isHome?oppNation:myNation;
    if(!hN||!aN)return;
    const myLU=savedLineup.length>=5?buildWCCareerLineup(myNation,savedLineup):null;
    const result=simWCMatchFull(hN,aN,{knockout:true,homeLineup:isHome?myLU:null,awayLineup:isHome?null:myLU});
    setCareerSim({matchId:koPhase,hNation:hN,aNation:aN,result,type:'ko',isHome,oppNation});
  };
  const applyKoResult=(res,isHome)=>{
    const myWon=isHome?res.hGoals>res.aGoals:res.aGoals>res.hGoals;
    const phaseOrder=['qf','sf','final'];
    const nextPhase=myWon?phaseOrder[phaseOrder.indexOf(koPhase)+1]||'champion':'eliminated';
    const nextOpp=myWon&&nextPhase!=='champion'?named.filter(n=>n.id!==career.nationId)[Math.floor(Math.random()*named.filter(n=>n.id!==career.nationId).length)]?.id||null:null;
    const myTeam=isHome?'home':'away';
    const newStats=accumulateWCStats(career.stats||{},res.events,myTeam);
    const kr={...koResults,[koPhase]:{homeScore:res.hGoals,awayScore:res.aGoals,simmed:true,et:res.et||false}};
    const nextIH=nextOpp?Math.random()<0.5:null;
    setKoResults(kr);setKoOpponent(nextOpp||null);setKoPhase(nextPhase);setKoIsHome(nextIH);
    saveCareer({...career,koPhase:nextPhase,koResults:kr,koOpponent:nextOpp||null,koIsHome:nextIH,stats:newStats});
    setCareerSim(null);setKoHi('');setKoAi('');
  };
  const champNation=koResults.final&&(koResults.final.homeScore>koResults.final.awayScore?myNation:nations.find(n=>n.id===koOpponent));
  return(
    <div style={{paddingBottom:40}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20,background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
        <TeamBadge color={myNation.color} crest={myNation.crest} size={44}/>
        <div style={{flex:1}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:C.text,letterSpacing:2}}>{myNation.name}</div>
          <div style={{fontSize:11,color:C.muted}}>{myNation.players.length} players in squad</div>
        </div>
        <button onClick={()=>{if(confirm('Abandon career?'))resetCareer();}} style={{background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>Abandon</button>
      </div>
      {/* Lineup Picker */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'12px 14px',marginBottom:20}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
          <SLabel style={{margin:0}}>Starting Lineup</SLabel>
          <span style={{fontSize:11,fontWeight:700,color:savedLineup.length===6?C.green:C.gold}}>{savedLineup.length}/6</span>
        </div>
        <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Tap to pick your 6 starters. Their scores drive ATK/DEF and who scores.</div>
        {['GK','DEF','MDF','FWD'].map(pos=>{const ps=myNation.players.filter(p=>p.position===pos&&p.name);if(!ps.length)return null;return(
          <div key={pos} style={{marginBottom:8}}>
            <div style={{fontSize:9,color:posColor(pos),fontWeight:700,letterSpacing:2,textTransform:'uppercase',marginBottom:4}}>{pos}</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {ps.map(p=>{const inLU=savedLineup.includes(p.id);const tog=()=>{const nl=inLU?savedLineup.filter(id=>id!==p.id):savedLineup.length>=6?[...savedLineup.slice(1),p.id]:[...savedLineup,p.id];setSavedLineup(nl);saveCareer({...career,savedLineup:nl});};return(
                <div key={p.id} onClick={tog} style={{background:inLU?`${posColor(pos)}18`:C.surface,border:`1px solid ${inLU?posColor(pos):C.border}`,borderRadius:6,padding:'5px 10px',fontSize:12,color:inLU?posColor(pos):C.muted,cursor:'pointer',fontWeight:inLU?700:400,userSelect:'none'}}>
                  {p.name}{inLU&&<span style={{fontSize:9,marginLeft:4}}>✓</span>}
                </div>
              );})}
            </div>
          </div>
        );})}
        {savedLineup.length===6?(()=>{const lu=buildWCCareerLineup(myNation,savedLineup);const r=lineupRatingsFromSlots(lu.starters);return<div style={{fontSize:11,color:C.muted,marginTop:6,borderTop:`1px solid ${C.border}44`,paddingTop:6}}>{lu.formation?.name||'?'} · <span style={{color:C.red}}>ATK {r.atk}</span> · <span style={{color:C.green}}>DEF {r.def}</span></div>;})():<div style={{fontSize:11,color:C.gold,marginTop:6}}>⚠ Select {6-savedLineup.length} more player{6-savedLineup.length!==1?'s':''}</div>}
      </div>
      {/* Group stage */}
      {myGroup?(
        <div style={{marginBottom:20}}>
          <SLabel>Group {myGroup.id}</SLabel>
          <table style={{width:'100%',borderCollapse:'collapse',marginBottom:14,fontSize:11}}>
            <thead><tr style={{color:C.muted}}><th style={{textAlign:'left',paddingBottom:6}}>Nation</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th style={{color:C.gold}}>Pts</th></tr></thead>
            <tbody>
              {standings.map((s,i)=>{const n=s.nation;return(
                <tr key={s.id} style={{borderTop:`1px solid ${C.border}33`,background:s.id===career.nationId?C.surface:'transparent'}}>
                  <td style={{padding:'5px 0',display:'flex',alignItems:'center',gap:6}}>{i<2&&<span style={{fontSize:9,color:C.green,fontWeight:700}}>●</span>}<TeamBadge color={n?.color||C.border} crest={n?.crest} size={14}/><span style={{color:s.id===career.nationId?C.accent:C.text,fontWeight:s.id===career.nationId?700:400}}>{n?.name||'?'}</span></td>
                  <td style={{textAlign:'center',color:C.muted}}>{s.P}</td><td style={{textAlign:'center',color:s.W>0?C.green:C.muted}}>{s.W}</td><td style={{textAlign:'center'}}>{s.D}</td><td style={{textAlign:'center',color:s.L>0?C.red:C.muted}}>{s.L}</td><td style={{textAlign:'center',color:s.GD>0?C.green:s.GD<0?C.red:C.muted}}>{s.GD>0?'+':''}{s.GD}</td><td style={{textAlign:'center',fontWeight:700,color:C.gold}}>{s.pts}</td>
                </tr>
              );})}
            </tbody>
          </table>
          {myMatches.map(({matchIdx,homeId,awayId,pairOppId,isHome})=>{
            const mid=`career_gm_${myGroup.id}${matchIdx+1}`;
            const r=careerResults[mid];
            const hN=nations.find(n=>n.id===homeId);const aN=nations.find(n=>n.id===awayId);
            const myScore=isHome?r?.homeScore:r?.awayScore;
            const oppScore=isHome?r?.awayScore:r?.homeScore;
            const won=r&&myScore>oppScore,drew=r&&myScore===oppScore,lost=r&&myScore<oppScore;
            return(
              <div key={matchIdx} style={{background:C.card,border:`1px solid ${r?C.border:C.accent}44`,borderRadius:10,padding:'12px 14px',marginBottom:10}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:8,marginBottom:r?0:10}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:5}}>
                    <span style={{fontSize:13,fontWeight:600,color:isHome?C.accent:C.text}}>{hN?.name}</span>
                    <TeamBadge color={hN?.color||C.border} crest={hN?.crest} size={18}/>
                  </div>
                  {r?<div style={{textAlign:'center'}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:won||drew?C.gold:C.red,letterSpacing:2}}>{r.homeScore}–{r.awayScore}</div></div>:<span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:C.muted,letterSpacing:2,textAlign:'center'}}>vs</span>}
                  <div style={{display:'flex',alignItems:'center',gap:5}}>
                    <TeamBadge color={aN?.color||C.border} crest={aN?.crest} size={18}/>
                    <span style={{fontSize:13,fontWeight:600,color:!isHome?C.accent:C.text}}>{aN?.name}</span>
                  </div>
                </div>
                {!r&&(
                  <div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 20px 1fr',gap:4,alignItems:'center',marginBottom:8}}>
                      <input type="number" min="0" value={hi} onChange={e=>setHi(e.target.value)} placeholder="0" style={inp}/>
                      <div style={{textAlign:'center',color:C.muted,fontFamily:"'Bebas Neue',sans-serif"}}>–</div>
                      <input type="number" min="0" value={ai} onChange={e=>setAi(e.target.value)} placeholder="0" style={inp}/>
                    </div>
                    <div style={{display:'flex',gap:6}}>
                      <Btn onClick={()=>playMatch(matchIdx,isHome,pairOppId)} style={{flex:1,fontSize:11,opacity:hi!==''&&ai!==''?1:0.4}}>Save Result</Btn>
                      <Btn onClick={()=>simMyMatch(matchIdx,isHome,pairOppId)} variant="secondary" style={{flex:1,fontSize:11}}>▶ Sim</Btn>
                    </div>
                    {careerSim?.matchId===mid&&(
                      <WCMatchSimPanel
                        hNation={careerSim.hNation} aNation={careerSim.aNation} sim={careerSim.result}
                        onSimulate={()=>simMyMatch(matchIdx,isHome,pairOppId)}
                        onResim={()=>simMyMatch(matchIdx,isHome,pairOppId)}
                        onSave={applyGroupSim}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {/* Other group match results */}
          {myGroupMatches.filter(m=>{const ids=[m.homeId,m.awayId];return!ids.includes(career.nationId);}).map(m=>{
            const hN=nations.find(n=>n.id===m.homeId);const aN=nations.find(n=>n.id===m.awayId);
            if(!m.played)return null;
            return(
              <div key={m.id} style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:8,padding:'6px 10px',background:C.surface,border:`1px solid ${C.border}22`,borderRadius:8,marginBottom:6,opacity:0.7}}>
                <span style={{fontSize:11,color:C.muted,textAlign:'right'}}>{hN?.name}</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:C.muted,textAlign:'center'}}>{m.homeScore}–{m.awayScore}</span>
                <span style={{fontSize:11,color:C.muted}}>{aN?.name}</span>
              </div>
            );
          })}
        </div>
      ):<div style={{background:C.surface,border:`1px solid ${C.gold}44`,borderRadius:8,padding:14,marginBottom:20,fontSize:12,color:C.gold}}>⚠ Groups haven't been set up yet in the tournament. Your group matches will appear here once the draw is done.</div>}
      {/* Post-group result */}
      {groupComplete&&(
        <div style={{background:qualified?'#0f2010':'#1a0505',border:`1px solid ${qualified?C.green:C.red}44`,borderRadius:12,padding:20,marginBottom:20,textAlign:'center'}}>
          <div style={{fontSize:28,marginBottom:8}}>{qualified?'🎉':'😞'}</div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:qualified?C.green:C.red,letterSpacing:2}}>{qualified?'QUALIFIED':'ELIMINATED'}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:6}}>{qualified?`Finished ${standings.indexOf(myStanding)+1}${['st','nd','rd'][standings.indexOf(myStanding)]||'th'} in Group ${myGroup?.id}`:`Finished ${standings.indexOf(myStanding)+1}th in Group ${myGroup?.id}`}</div>
        </div>
      )}
      {/* Knockout phase */}
      {qualified&&koPhase!=='champion'&&koPhase!=='eliminated'&&(()=>{
        const phaseLabel={qf:'Quarter Final',sf:'Semi Final',final:'Final'}[koPhase]||koPhase;
        const oppNation=koOpponent?nations.find(n=>n.id===koOpponent):null;
        const prevResult=koResults[koPhase];
        const isHome=koIsHome??true;
        if(prevResult){
          const myScore=isHome?prevResult.homeScore:prevResult.awayScore;
          const oppScore=isHome?prevResult.awayScore:prevResult.homeScore;
          const won=myScore>oppScore;
          return(
            <div style={{background:won?'#0f2010':'#1a0505',border:`1px solid ${won?C.green:C.red}44`,borderRadius:12,padding:20,textAlign:'center'}}>
              <div style={{fontSize:28,marginBottom:8}}>{won?'✅':'❌'}</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:won?C.green:C.red,letterSpacing:2}}>{phaseLabel}: {won?'WON':'LOST'}</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:C.gold,margin:'8px 0'}}>{prevResult.homeScore}–{prevResult.awayScore}</div>
            </div>
          );
        }
        const canSave=koHi!==''&&koAi!==''&&!isNaN(parseInt(koHi))&&!isNaN(parseInt(koAi))&&parseInt(koHi)!==parseInt(koAi);
        if(!oppNation){
          return<div style={{fontSize:12,color:C.muted,padding:20,textAlign:'center'}}>Setting up {phaseLabel}...</div>;
        }
        return(
          <div style={{background:C.card,border:`1px solid ${C.accent}44`,borderRadius:12,padding:16,marginBottom:16}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.gold,letterSpacing:2,marginBottom:12}}>{phaseLabel}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:8,marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:6}}>
                <span style={{fontSize:13,fontWeight:600,color:C.accent}}>{myNation.name}</span>
                <TeamBadge color={myNation.color} crest={myNation.crest} size={20}/>
              </div>
              <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:C.muted,letterSpacing:2}}>vs</span>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <TeamBadge color={oppNation?.color||C.border} crest={oppNation?.crest} size={20}/>
                <span style={{fontSize:13,fontWeight:600,color:C.text}}>{oppNation?.name||'TBD'}</span>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 20px 1fr',gap:4,alignItems:'center',marginBottom:8}}>
              <input type="number" min="0" value={koHi} onChange={e=>setKoHi(e.target.value)} placeholder="0" style={inp}/>
              <div style={{textAlign:'center',color:C.muted,fontFamily:"'Bebas Neue',sans-serif"}}>–</div>
              <input type="number" min="0" value={koAi} onChange={e=>setKoAi(e.target.value)} placeholder="0" style={inp}/>
            </div>
            <div style={{fontSize:10,color:C.muted,textAlign:'center',marginBottom:8}}>No draws in knockout · Enter scores or simulate</div>
            <div style={{display:'flex',gap:6}}>
              <Btn onClick={()=>doKoMatch(isHome,oppNation)} style={{flex:1,fontSize:11,opacity:canSave?1:0.4}}>Save</Btn>
              <Btn onClick={()=>startKoSim(isHome,oppNation)} variant="secondary" style={{flex:1,fontSize:11}}>▶ Sim</Btn>
            </div>
            {careerSim?.type==='ko'&&(
              <WCMatchSimPanel
                hNation={careerSim.hNation} aNation={careerSim.aNation} sim={careerSim.result} knockout
                onSimulate={()=>startKoSim(careerSim.isHome,careerSim.oppNation)}
                onResim={()=>startKoSim(careerSim.isHome,careerSim.oppNation)}
                onSave={()=>applyKoResult(careerSim.result,careerSim.isHome)}
              />
            )}
          </div>
        );
      })()}
      {qualified&&koPhase==='champion'&&(
        <div style={{background:'linear-gradient(135deg,#1a0f00 0%,#2d1a00 50%,#1a0f00 100%)',border:`1px solid ${C.gold}88`,borderRadius:12,padding:28,textAlign:'center'}}>
          <div style={{fontSize:48,marginBottom:12}}>🏆</div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:C.gold,letterSpacing:4}}>WORLD CHAMPION</div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:12,marginTop:12}}>
            <TeamBadge color={myNation.color} crest={myNation.crest} size={44}/>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.white,letterSpacing:2}}>{myNation.name}</div>
          </div>
          <Btn onClick={resetCareer} variant="secondary" style={{marginTop:20}}>Play Again</Btn>
        </div>
      )}
      {career.stats&&Object.keys(career.stats).length>0&&(
        <div style={{marginBottom:20}}>
          <SLabel>Tournament Stats</SLabel>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px'}}>
              <div style={{fontSize:10,color:C.gold,fontWeight:700,letterSpacing:2,marginBottom:8}}>⚽ TOP SCORERS</div>
              {Object.values(career.stats).filter(p=>p.goals>0).sort((a,b)=>b.goals-a.goals).slice(0,5).map((p,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginBottom:5}}>
                  <span style={{fontSize:10,color:C.muted,minWidth:14}}>{i+1}</span>
                  <div style={{flex:1}}><div style={{fontSize:12,color:C.text,fontWeight:600,lineHeight:1.2}}>{p.name}</div><div style={{fontSize:9,color:C.muted}}>{p.position}</div></div>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:C.gold,lineHeight:1}}>{p.goals}</span>
                </div>
              ))}
              {Object.values(career.stats).filter(p=>p.goals>0).length===0&&<div style={{fontSize:11,color:C.muted}}>No goals yet</div>}
            </div>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px'}}>
              <div style={{fontSize:10,color:C.green,fontWeight:700,letterSpacing:2,marginBottom:8}}>🎯 TOP ASSISTS</div>
              {Object.values(career.stats).filter(p=>p.assists>0).sort((a,b)=>b.assists-a.assists).slice(0,5).map((p,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginBottom:5}}>
                  <span style={{fontSize:10,color:C.muted,minWidth:14}}>{i+1}</span>
                  <div style={{flex:1}}><div style={{fontSize:12,color:C.text,fontWeight:600,lineHeight:1.2}}>{p.name}</div><div style={{fontSize:9,color:C.muted}}>{p.position}</div></div>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:C.green,lineHeight:1}}>{p.assists}</span>
                </div>
              ))}
              {Object.values(career.stats).filter(p=>p.assists>0).length===0&&<div style={{fontSize:11,color:C.muted}}>No assists yet</div>}
            </div>
          </div>
        </div>
      )}
      {(eliminated||(qualified&&koPhase==='eliminated'))&&(
        <div style={{background:'#1a0505',border:`1px solid ${C.red}44`,borderRadius:12,padding:28,textAlign:'center'}}>
          <div style={{fontSize:36,marginBottom:12}}>😞</div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:C.red,letterSpacing:2}}>TOURNAMENT OVER</div>
          <div style={{fontSize:12,color:C.muted,marginTop:8}}>{myNation.name} has been eliminated.</div>
          <Btn onClick={resetCareer} style={{marginTop:20}}>Try Again</Btn>
        </div>
      )}
    </div>
  );
}

// ── WCApp ────────────────────────────────────────────────────────────────────
const WC_TABS=[{id:'groups',label:'Groups'},{id:'knockout',label:'Knockout'},{id:'teams',label:'Teams'},{id:'nations',label:'Nations'},{id:'career',label:'Career'},{id:'manage',label:'Manage'}];

function WCApp(){
  const[tab,setTab]=useState('groups');
  const[loaded,setLoaded]=useState(false);
  const[nations,setNations]=useState([]);
  const[teams,setTeams]=useState([]);
  const[wcMeta,setWcMeta]=useState(null);
  const[groupMatches,setGroupMatches]=useState([]);
  const[wcBracket,setWcBracket]=useState(null);
  const[toast,setToast]=useState('');
  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(''),3000);};
  useEffect(()=>{
    loadWCState().then(data=>{
      if(data){
        setTeams(data.teams||[]);
        setNations(data.nations.length?data.nations:Array.from({length:12},(_,i)=>makeNation(i)));
        setWcMeta(data.wcMeta||null);
        setGroupMatches(data.groupMatches||[]);
        setWcBracket(data.wcBracket||null);
      }
      setLoaded(true);
    });
  },[]);
  if(!loaded)return<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:C.bg,color:C.muted,fontFamily:"'DM Sans',sans-serif"}}>Loading…</div>;
  return(
    <div style={{background:C.bg,minHeight:'100vh',fontFamily:"'DM Sans',sans-serif",color:C.text}}>
      <div style={{maxWidth:480,margin:'0 auto',padding:'0 16px'}}>
        {/* Header */}
        <div style={{padding:'20px 0 8px',textAlign:'center',borderBottom:`1px solid ${C.border}`,marginBottom:16}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.gold,letterSpacing:5}}>BMLS WORLD CUP</div>
          <div style={{fontSize:10,color:C.muted,letterSpacing:3,textTransform:'uppercase',marginTop:2}}>12 Nations · Group Stage · Knockouts</div>
        </div>
        {/* Tabs */}
        <div style={{display:'flex',gap:4,marginBottom:20,overflowX:'auto',paddingBottom:4}}>
          {WC_TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:'0 0 auto',background:tab===t.id?C.accent:C.surface,border:`1px solid ${tab===t.id?C.accent:C.border}`,borderRadius:8,color:tab===t.id?C.white:C.muted,padding:'7px 12px',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",whiteSpace:'nowrap'}}>{t.label}</button>
          ))}
        </div>
        {/* Content */}
        {tab==='groups'&&<GroupsTab nations={nations} wcMeta={wcMeta} setWcMeta={setWcMeta} groupMatches={groupMatches} setGroupMatches={setGroupMatches}/>}
        {tab==='knockout'&&<KnockoutTab nations={nations} wcMeta={wcMeta} groupMatches={groupMatches} wcBracket={wcBracket} setWcBracket={setWcBracket}/>}
        {tab==='teams'&&<TeamsTab nations={nations}/>}
        {tab==='nations'&&<NationsTab nations={nations}/>}
        {tab==='career'&&<CareerTab nations={nations} wcMeta={wcMeta} groupMatches={groupMatches}/>}
        {tab==='manage'&&<ManageTab nations={nations} setNations={setNations} teams={teams} wcMeta={wcMeta} setWcMeta={setWcMeta} groupMatches={groupMatches} setGroupMatches={setGroupMatches} onToast={showToast}/>}
        {toast&&<div style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 18px',fontSize:13,color:C.text,zIndex:50,whiteSpace:'nowrap'}}>{toast}</div>}
      </div>
      <div style={{borderTop:`1px solid ${C.border}`,padding:'10px 16px',display:'flex',justifyContent:'center',gap:24,marginTop:8}}>
        {[['BMLS','/'],['World Cup','/worldcup'],['Betting & Fantasy','/betting']].map(([label,href])=>(
          <a key={href} href={href} style={{fontSize:11,color:href==='/worldcup'?C.gold:C.muted,textDecoration:'none'}}>{label}</a>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<WCApp/>)
