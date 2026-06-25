import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

const C={
  bg:"#0B0F1A",surface:"#111827",card:"#161D2E",border:"#1E293B",
  accent:"#3B82F6",gold:"#F59E0B",green:"#22C55E",red:"#EF4444",
  muted:"#64748B",sub:"#94A3B8",text:"#E2E8F0",white:"#F8FAFC",purple:"#A855F7"
};

const POSITIONS=["GK","DEF","MDF","FWD"];
const posColor=p=>p==="GK"?C.gold:p==="DEF"?C.green:p==="MDF"?C.accent:p==="FWD"?C.red:C.muted;

const FORMATIONS=[
  {id:"2-2-1",label:"2-2-1",def:2,mdf:2,fwd:1},
  {id:"2-1-2",label:"2-1-2",def:2,mdf:1,fwd:2},
  {id:"3-1-1",label:"3-1-1",def:3,mdf:1,fwd:1},
  {id:"2-0-3",label:"2-3",  def:2,mdf:0,fwd:3},
];

const ROLES=[
  {id:'captain',label:'Captain',short:'C',color:'#F59E0B'},
  {id:'viceCaptain',label:'Vice Capt',short:'VC',color:'#94A3B8'},
  {id:'penTaker',label:'Pen Taker',short:'P',color:'#3B82F6'},
  {id:'fkTaker',label:'FK Taker',short:'FK',color:'#A855F7'},
];

const makeTeam=id=>({id,name:"",shortName:"",color:"#3B82F6",crest:null,players:[],formation:"2-2-1",budget:0});
const makePlayer=()=>({id:Date.now()+Math.random(),name:"",position:"DEF",score:7,mdfAtkScore:7,mdfDefScore:7,age:25,injured:false,suspended:false,wide:false,altPosition:null,roles:[]});
const makeFixture=()=>({id:String(Date.now()+Math.random()),homeId:null,awayId:null,date:"",homeScore:null,awayScore:null,played:false,playerStats:[],matchWeek:null});

function generateSeason(namedTeams){
  const ids=namedTeams.map(t=>t.id);
  const n=ids.length;
  if(n<2)return[];
  const list=n%2===0?[...ids]:[...ids,'bye'];
  const m=list.length;
  const fixed=list[0];
  const rot=list.slice(1);
  const fixtures=[];
  for(let r=0;r<m-1;r++){
    const matchWeek=r+1;
    const rotated=[...rot.slice(r),...rot.slice(0,r)];
    const pairs=[[fixed,rotated[0]]];
    for(let i=1;i<m/2;i++)pairs.push([rotated[i],rotated[m-1-i]]);
    pairs.forEach(([home,away],pi)=>{
      if(home==='bye'||away==='bye')return;
      const swap=(r+pi)%2===1;
      fixtures.push({...makeFixture(),homeId:swap?away:home,awayId:swap?home:away,matchWeek});
    });
  }
  return fixtures;
}

function currentMatchWeek(fixtures){
  const weeks=[...new Set(fixtures.map(f=>f.matchWeek).filter(w=>w!=null))].sort((a,b)=>a-b);
  for(const w of weeks){if(fixtures.filter(f=>f.matchWeek===w).some(f=>!f.played))return w;}
  return null;
}

async function loadState(){
  try{
    const r=await fetch('/api/state');if(!r.ok)return null;
    const data=await r.json();
    const all=data.fixtures||[];
    const meta=all.find(f=>f.id==='season_meta');
    return{
      teams:data.teams,
      fixtures:all.filter(f=>!f.type),
      transfers:all.filter(f=>f.type==='transfer'),
      activeMatchWeek:meta?.activeMatchWeek||1,
    };
  }catch{return null;}
}
async function syncMeta(amw){try{await fetch('/api/fixture/season_meta',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'season_meta',type:'meta',activeMatchWeek:amw})});}catch(e){console.error('sync meta:',e);}}
function timeAgo(iso){const d=Date.now()-new Date(iso).getTime(),m=Math.floor(d/60000);if(m<1)return'now';if(m<60)return`${m}m`;const h=Math.floor(m/60);if(h<24)return`${h}h`;return`${Math.floor(h/24)}d`;}
async function syncTeams(teams){try{await fetch('/api/teams',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(teams)});}catch(e){console.error('sync teams:',e);}}
async function syncFixture(f){try{await fetch(`/api/fixture/${f.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)});}catch(e){console.error('sync fixture:',e);}}
async function deleteFixture(id){try{await fetch(`/api/fixture/${id}`,{method:'DELETE'});}catch(e){console.error('delete fixture:',e);}}
async function syncTransfer(t){try{await fetch(`/api/fixture/${t.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(t)});}catch(e){console.error('sync transfer:',e);}}

async function resizeCrest(file){
  return new Promise(resolve=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      const canvas=document.createElement('canvas');
      canvas.width=100;canvas.height=100;
      const ctx=canvas.getContext('2d');
      const min=Math.min(img.width,img.height);
      const sx=(img.width-min)/2,sy=(img.height-min)/2;
      ctx.drawImage(img,sx,sy,min,min,0,0,100,100);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg',0.75));
    };
    img.src=url;
  });
}

function depthMultiplier(n){if(n<=1)return 0.9;if(n>=4)return 1.05;return 1.0;}

function lineupRatings(team){
  if(!team)return{atk:0,def:0};
  const active=team.players.filter(p=>!p.injured&&!p.suspended);
  const fwds=active.filter(p=>p.position==="FWD");
  const defs=active.filter(p=>p.position==="DEF");
  const mdfs=active.filter(p=>p.position==="MDF");
  const fwdAvg=fwds.length>0?fwds.reduce((s,p)=>s+p.score,0)/fwds.length:null;
  const defAvg=defs.length>0?defs.reduce((s,p)=>s+p.score,0)/defs.length:null;
  let atkP=[...fwds.map(p=>p.score)];
  mdfs.forEach(p=>{if(fwdAvg===null||p.mdfAtkScore>fwdAvg)atkP.push(p.mdfAtkScore);});
  const atkAvg=atkP.length>0?atkP.reduce((a,b)=>a+b,0)/atkP.length:0;
  const atk=Math.min(10,Math.round(atkAvg*depthMultiplier(fwds.length)));
  let defP=[...defs.map(p=>p.score)];
  mdfs.forEach(p=>{if(defAvg===null||p.mdfDefScore>defAvg)defP.push(p.mdfDefScore);});
  const defAvgF=defP.length>0?defP.reduce((a,b)=>a+b,0)/defP.length:0;
  const def=Math.min(10,Math.round(defAvgF*depthMultiplier(defs.length)));
  return{atk,def};
}

function playerFormScore(playerId,fixtures){
  const recent=[...fixtures].filter(f=>f.played).slice(-3);
  let rSum=0,rN=0,contrib=0;
  recent.forEach(f=>{
    const ps=(f.playerStats||[]).find(s=>s.playerId===playerId);
    if(!ps)return;
    if(ps.rating){rSum+=ps.rating;rN++;}
    contrib+=(ps.goals||0)*2+(ps.assists||0);
  });
  return(rN>0?rSum/rN:5)+contrib*0.5;
}

function arrangeWide(arr){
  if(arr.length<2)return arr;
  const w=arr.filter(p=>p.wide),c=arr.filter(p=>!p.wide);
  if(w.length===0)return arr;
  if(arr.length===2)return w.length>=2?arr:[w[0],c[0]];
  if(arr.length===3){
    if(w.length>=2)return[w[0],...c.slice(0,1),w[1]];
    return[w[0],...c];
  }
  return arr;
}

function predictedLineup(team,fixtures){
  const formation=FORMATIONS.find(f=>f.id===team.formation)||FORMATIONS[0];
  const available=team.players.filter(p=>!p.injured&&!p.suspended);
  const gk=available.find(p=>p.position==="GK");
  const baseRating=p=>p.position==="MDF"?(p.mdfAtkScore+p.mdfDefScore)/2:(p.score||5);
  const sp=p=>({...p,formScore:playerFormScore(p.id,fixtures)});
  const cmp=(a,b)=>b.formScore-a.formScore||baseRating(b)-baseRating(a);
  const primaryDefs=available.filter(p=>p.position==="DEF").map(sp).sort(cmp).slice(0,formation.def);
  const primaryMdfs=available.filter(p=>p.position==="MDF").map(sp).sort(cmp).slice(0,formation.mdf);
  const primaryFwds=available.filter(p=>p.position==="FWD").map(sp).sort(cmp).slice(0,formation.fwd);
  const used=new Set([...(gk?[gk.id]:[]),...primaryDefs.map(p=>p.id),...primaryMdfs.map(p=>p.id),...primaryFwds.map(p=>p.id)]);
  const altPool=available.filter(p=>p.position==="MDF"&&p.altPosition&&!used.has(p.id)).map(sp).sort(cmp);
  const altUsed=new Set();
  const defs=[...primaryDefs];
  const mdfs=[...primaryMdfs];
  const fwds=[...primaryFwds];
  altPool.filter(p=>p.altPosition==="DEF"&&!altUsed.has(p.id)).slice(0,formation.def-defs.length).forEach(p=>{defs.push({...p,position:"DEF",wide:true,_origPos:"MDF"});altUsed.add(p.id);});
  altPool.filter(p=>p.altPosition==="FWD"&&!altUsed.has(p.id)).slice(0,formation.fwd-fwds.length).forEach(p=>{fwds.push({...p,position:"FWD",wide:true,_origPos:"MDF"});altUsed.add(p.id);});
  // fill any remaining gaps with best unused outfield players
  const assigned=new Set([...(gk?[gk.id]:[]),...defs.map(p=>p.id),...mdfs.map(p=>p.id),...fwds.map(p=>p.id)]);
  const spares=available.filter(p=>p.position!=="GK"&&!assigned.has(p.id)).map(sp).sort(cmp);
  let si=0;
  while(defs.length<formation.def&&si<spares.length){defs.push({...spares[si],position:"DEF"});si++;}
  while(mdfs.length<formation.mdf&&si<spares.length){mdfs.push({...spares[si],position:"MDF"});si++;}
  while(fwds.length<formation.fwd&&si<spares.length){fwds.push({...spares[si],position:"FWD"});si++;}
  const startingIds=new Set([...(gk?[gk.id]:[]),...defs.map(p=>p.id),...mdfs.map(p=>p.id),...fwds.map(p=>p.id)]);
  const bench=team.players.filter(p=>!p.injured&&!startingIds.has(p.id));
  return{gk:gk||null,defs:arrangeWide(defs),mdfs,fwds:arrangeWide(fwds),formation,bench};
}

function predictMatch(home,away){
  const h=lineupRatings(home),a=lineupRatings(away);
  const hxg=+((1.1*(h.atk+0.4)/Math.max(a.def,0.5))*0.85).toFixed(1);
  const axg=+((1.1*a.atk/Math.max(h.def,0.5))*0.85).toFixed(1);
  const xgToGoals=xg=>Math.max(0,Math.round(xg*1.18-0.12));
  return{hxg,axg,hGoals:xgToGoals(hxg),aGoals:xgToGoals(axg)};
}

function simulateMatch(home,away,fixtures){
  const{hxg,axg}=predictMatch(home,away);
  const pois=λ=>{if(λ<=0)return 0;const L=Math.exp(-Math.min(λ,12));let k=0,p=1;do{k++;p*=Math.random();}while(p>L);return k-1;};
  const hl=predictedLineup(home,fixtures);
  const al=predictedLineup(away,fixtures);
  const hPlayers=[hl.gk,...hl.defs,...hl.mdfs,...hl.fwds].filter(Boolean);
  const aPlayers=[al.gk,...al.defs,...al.mdfs,...al.fwds].filter(Boolean);
  if(!hPlayers.length||!aPlayers.length)return{hGoals:0,aGoals:0,events:[]};
  const wPick=(items,wFn)=>{const ws=items.map(wFn),tot=ws.reduce((s,w)=>s+w,0);if(tot<=0)return items[Math.floor(Math.random()*items.length)];let r=Math.random()*tot;for(let i=0;i<items.length;i++){r-=ws[i];if(r<=0)return items[i];}return items[items.length-1];};
  const scorW=p=>p.position==='FWD'?(p.score||5)*3:p.position==='MDF'?(p.mdfAtkScore||5)*1.2:p.position==='DEF'?(p.score||5)*.2:0;
  const astW=(p,sid)=>p.id===sid?0:p.position==='MDF'?(p.mdfAtkScore||5)*2.5:p.position==='FWD'?(p.score||5):p.position==='DEF'?0.3:0;
  const mnt=()=>Math.floor(Math.random()*90)+1;
  const events=[];
  const redAt={},injuredAt={},subbedOff={},subOnInfo={};
  // Red cards first
  const doReds=(players,team)=>players.forEach(p=>{if(Math.random()<0.006){const m=mnt();redAt[p.id]=m;events.push({team,type:'red',player:p,minute:m});}});
  doReds(hPlayers,'home');doReds(aPlayers,'away');
  // Injuries (very rare, outfield only, not already red-carded)
  const doInjuries=(players,team)=>players.filter(p=>p.position!=='GK'&&!redAt[p.id]).forEach(p=>{if(Math.random()<0.008){const m=mnt();injuredAt[p.id]=m;events.push({team,type:'injury',player:p,minute:m});}});
  doInjuries(hPlayers,'home');doInjuries(aPlayers,'away');
  const firstRed=ps=>ps.reduce((m,p)=>redAt[p.id]?Math.min(m,redAt[p.id]):m,91);
  let hG=pois(hxg),aG=pois(axg);
  if(firstRed(hPlayers)<70&&Math.random()<0.45)hG=Math.max(0,hG-1);
  if(firstRed(aPlayers)<70&&Math.random()<0.45)aG=Math.max(0,aG-1);
  // Substitutions (46–85')
  const genSubs=(starters,bench,team)=>{
    if(!bench?.length)return;
    const n=Math.random()<.25?0:Math.random()<.6?1:2;
    const avB=bench.filter(p=>!redAt[p.id]&&!injuredAt[p.id]);
    const avS=starters.filter(p=>p.position!=='GK'&&!redAt[p.id]&&!injuredAt[p.id]);
    for(let i=0;i<n&&avB.length&&avS.length;i++){
      const min=Math.floor(Math.random()*40)+46;
      const pi=Math.floor(Math.random()*avB.length);
      const playerOn=avB.splice(pi,1)[0];
      const sp=avS.filter(p=>p.position===playerOn.position);
      const pool=sp.length?sp:avS;
      const oi=Math.floor(Math.random()*pool.length);
      const playerOff=pool[oi];
      avS.splice(avS.indexOf(playerOff),1);
      subbedOff[playerOff.id]=min;subOnInfo[playerOn.id]={player:playerOn,minute:min,team};
      events.push({team,type:'sub',minute:min,playerOn,playerOff});
    }
  };
  genSubs(hPlayers,hl.bench,'home');genSubs(aPlayers,al.bench,'away');
  // Pitch pools at a given minute (starters still on + subs who've come on)
  const outAt=(starters,team,min)=>[...starters.filter(p=>p.position!=='GK'&&(!redAt[p.id]||redAt[p.id]>min)&&(!injuredAt[p.id]||injuredAt[p.id]>min)&&(!subbedOff[p.id]||subbedOff[p.id]>min)),...Object.values(subOnInfo).filter(s=>s.team===team&&s.minute<=min&&(!redAt[s.player.id]||redAt[s.player.id]>min)&&(!injuredAt[s.player.id]||injuredAt[s.player.id]>min)).map(s=>s.player)];
  const allAt=(starters,team,min)=>[...starters.filter(p=>(!redAt[p.id]||redAt[p.id]>min)&&(!injuredAt[p.id]||injuredAt[p.id]>min)&&(!subbedOff[p.id]||subbedOff[p.id]>min)),...Object.values(subOnInfo).filter(s=>s.team===team&&s.minute<=min&&(!redAt[s.player.id]||redAt[s.player.id]>min)&&(!injuredAt[s.player.id]||injuredAt[s.player.id]>min)).map(s=>s.player)];
  // Goals
  const genGoals=(n,starters,team)=>{
    const allT=[...starters,...Object.values(subOnInfo).filter(s=>s.team===team).map(s=>s.player)];
    const topFWD=starters.filter(p=>p.position==='FWD').sort((a,b)=>(b.score||0)-(a.score||0))[0]||starters.find(p=>p.position!=='GK');
    const pen=allT.find(p=>(p.roles||[]).includes('penTaker'))||topFWD;
    for(let i=0;i<n;i++){
      const min=mnt();
      const elig=outAt(starters,team,min);if(!elig.length)continue;
      const all=allAt(starters,team,min);
      const isPen=Math.random()<0.15;
      const pt=all.some(p=>p.id===pen?.id)?pen:(elig.find(p=>p.position==='FWD')||elig[0]);
      const scorer=isPen?pt:wPick(elig,scorW);
      const astCands=isPen?[]:all.filter(p=>p.id!==scorer.id);
      const assist=!isPen&&Math.random()<0.78&&astCands.length?wPick(astCands,p=>astW(p,scorer.id)):null;
      events.push({team,type:'goal',player:scorer,assist,minute:min,isPen});
    }
  };
  // Yellows (starters + subs, skip red-carded or injured)
  const genYellows=(starters,team)=>[...starters,...Object.values(subOnInfo).filter(s=>s.team===team).map(s=>s.player)].forEach(p=>{
    if(redAt[p.id]||injuredAt[p.id])return;
    const r=Math.random(),yc=p.position==='DEF'?0.13:p.position==='MDF'?0.10:p.position==='FWD'?0.07:0.02;
    if(r<yc)events.push({team,type:'yellow',player:p,minute:mnt()});
  });
  genGoals(hG,hPlayers,'home');genGoals(aG,aPlayers,'away');
  genYellows(hPlayers,'home');genYellows(aPlayers,'away');
  events.sort((a,b)=>a.minute-b.minute);
  const finalH=events.filter(e=>e.team==='home'&&e.type==='goal').length;
  const finalA=events.filter(e=>e.team==='away'&&e.type==='goal').length;
  return{hGoals:finalH,aGoals:finalA,events};
}

function MatchSimPanel({fixture,home,away,fixtures,sim,onSimulate,onApply}){
  const[minute,setMinute]=useState(0);
  const[shown,setShown]=useState([]);
  const[score,setScore]=useState({h:0,a:0});
  const[speed,setSpeed]=useState(1);
  const[running,setRunning]=useState(false);
  const[done,setDone]=useState(false);
  const iRef=useRef(null);
  const feedRef=useRef(null);
  // Restart ticker whenever a new sim result arrives
  useEffect(()=>{
    if(!sim)return;
    clearInterval(iRef.current);
    setMinute(0);setShown([]);setScore({h:0,a:0});setDone(false);setRunning(true);
  },[sim]);
  useEffect(()=>{
    if(!running||!sim)return;
    clearInterval(iRef.current);
    iRef.current=setInterval(()=>setMinute(m=>m<90?m+1:90),1000/speed);
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
    if(minute>=90){clearInterval(iRef.current);setRunning(false);setDone(true);}
  },[minute]);
  useEffect(()=>{if(feedRef.current)feedRef.current.scrollTop=feedRef.current.scrollHeight;},[shown]);
  const ico=t=>t==='goal'?'⚽':t==='yellow'?'🟡':t==='sub'?'🔄':t==='injury'?'🤕':'🟥';
  const sn=t=>t.shortName||t.name;
  const evMain=(e)=>e.type==='goal'?`${e.player.name}${e.isPen?' (pen)':''}`:e.type==='sub'?`↑ ${e.playerOn.name}`:`${e.player.name}`;
  const evSub=(e)=>e.type==='sub'?`↓ ${e.playerOff.name}`:e.assist?`↗ ${e.assist.name}`:'';
  return(
    <div style={{borderTop:`1px solid ${C.border}`,padding:"14px",background:C.bg}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:"uppercase",textAlign:"center",marginBottom:12}}>Match Simulator</div>
      {!sim?(
        <div style={{textAlign:"center"}}><Btn onClick={onSimulate}>⚡ Simulate Match</Btn></div>
      ):(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:6,marginBottom:4}}>
            <div style={{textAlign:"right",fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:C.text,letterSpacing:.5}}>{sn(home)}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:42,color:C.gold,letterSpacing:3,textAlign:"center",lineHeight:1,padding:"0 10px"}}>{score.h}–{score.a}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:C.text,letterSpacing:.5}}>{sn(away)}</div>
          </div>
          <div style={{textAlign:"center",fontSize:10,fontWeight:700,letterSpacing:2,color:done?C.green:running?C.red:C.muted,marginBottom:6}}>
            {done?"FULL TIME":minute===45?"HALF TIME":running?`${minute}'`:"—"}
          </div>
          {running&&<div style={{height:2,background:C.surface,borderRadius:1,marginBottom:6,overflow:"hidden"}}><div style={{height:"100%",background:C.accent,width:`${(minute/90)*100}%`,transition:"width 0.9s linear"}}/></div>}
          {running&&<div style={{display:"flex",gap:5,marginBottom:8,justifyContent:"center"}}>{[1,2,5].map(s=><button key={s} onClick={()=>setSpeed(s)} style={{background:speed===s?`${C.accent}22`:"transparent",color:speed===s?C.accent:C.muted,border:`1px solid ${speed===s?C.accent:C.border}`,borderRadius:4,padding:"3px 10px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{s}×</button>)}</div>}
          <div ref={feedRef} style={{marginBottom:10,borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,padding:"10px 0",maxHeight:200,overflowY:"auto"}}>
            {shown.length===0
              ?<div style={{fontSize:11,color:C.muted,textAlign:"center",fontStyle:"italic",padding:"8px 0"}}>Waiting for kick off…</div>
              :shown.map((e,i)=>{
                const isH=e.team==="home";
                const main=evMain(e),sub2=evSub(e);
                return(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 32px 1fr",gap:2,marginBottom:5,alignItems:"start"}}>
                    {isH?<div style={{textAlign:"right",paddingRight:4}}><div style={{fontSize:11,color:e.type==='sub'?C.muted:C.text,fontWeight:600}}>{main} {ico(e.type)}</div>{sub2&&<div style={{fontSize:9,color:C.muted}}>{sub2}</div>}</div>:<div/>}
                    <div style={{textAlign:"center",fontSize:9,color:C.muted,fontWeight:700,paddingTop:2}}>{e.minute}'</div>
                    {!isH?<div style={{paddingLeft:4}}><div style={{fontSize:11,color:e.type==='sub'?C.muted:C.text,fontWeight:600}}>{ico(e.type)} {main}</div>{sub2&&<div style={{fontSize:9,color:C.muted,paddingLeft:14}}>{sub2}</div>}</div>:<div/>}
                  </div>
                );
              })
            }
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"center"}}>
            <Btn onClick={onSimulate} variant="secondary" small>Re-simulate</Btn>
            {onApply&&done&&<Btn onClick={onApply} variant="success" small>Apply Result ✓</Btn>}
          </div>
        </div>
      )}
    </div>
  );
}

function calcOdds(home,away){
  const{hxg,axg}=predictMatch(home,away);
  const diff=hxg-axg;
  const pH=Math.min(0.88,Math.max(0.08,0.5+diff*0.17));
  const pA=Math.min(0.88,Math.max(0.08,0.5-diff*0.17));
  const pD=Math.max(0.04,1-pH-pA);
  const n=pH+pD+pA,mg=1.07;
  return{home:+((mg/(pH/n))).toFixed(2),draw:+((mg/(pD/n))).toFixed(2),away:+((mg/(pA/n))).toFixed(2),pHome:Math.round(pH/n*100),pDraw:Math.round(pD/n*100),pAway:Math.round(pA/n*100)};
}

function computeTable(teams,fixtures){
  const rows=teams.filter(t=>t.name).map(t=>({...t,p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0,form:[]}));
  fixtures.filter(f=>f.played&&f.homeId&&f.awayId).forEach(f=>{
    const h=rows.find(r=>r.id===f.homeId),a=rows.find(r=>r.id===f.awayId);
    if(!h||!a)return;
    h.p++;a.p++;h.gf+=f.homeScore;h.ga+=f.awayScore;a.gf+=f.awayScore;a.ga+=f.homeScore;
    if(f.homeScore>f.awayScore){h.w++;h.pts+=3;a.l++;h.form.push("W");a.form.push("L");}
    else if(f.homeScore<f.awayScore){a.w++;a.pts+=3;h.l++;h.form.push("L");a.form.push("W");}
    else{h.d++;h.pts++;a.d++;a.pts++;h.form.push("D");a.form.push("D");}
  });
  return rows.sort((a,b)=>b.pts-a.pts||(b.gf-b.ga)-(a.gf-a.ga)||b.gf-a.gf);
}

function computePlayerStats(teams,fixtures){
  const map={};
  teams.forEach(t=>t.players.forEach(p=>{
    map[p.id]={playerId:p.id,name:p.name,position:p.position,teamId:t.id,teamName:t.name,teamColor:t.color,
      teamShort:t.shortName||(t.name&&t.name.slice(0,3).toUpperCase()),
      goals:0,penGoals:0,assists:0,yellowCards:0,redCard:false,cleanSheets:0,ratings:[],apps:0};
  }));
  fixtures.filter(f=>f.played).forEach(f=>{
    (f.playerStats||[]).forEach(ps=>{
      if(!map[ps.playerId])return;
      const s=map[ps.playerId];
      s.apps++;s.goals+=ps.goals||0;s.penGoals+=ps.penGoals||0;s.assists+=ps.assists||0;
      s.yellowCards+=ps.yellowCards||0;if(ps.redCard)s.redCard=true;
      if(ps.cleanSheet)s.cleanSheets++;if(ps.rating)s.ratings.push(ps.rating);
    });
  });
  return Object.values(map).map(s=>({...s,avgRating:s.ratings.length>0?(s.ratings.reduce((a,b)=>a+b,0)/s.ratings.length).toFixed(1):null}));
}

const fmtDate=d=>{if(!d)return"TBC";try{return new Date(d).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});}catch{return d;}};

const Inp=({value,onChange,placeholder,type="text",min,max})=>(
  <input type={type} value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder} min={min} max={max}
    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,padding:"7px 10px",fontSize:13,width:"100%",fontFamily:"'DM Sans',sans-serif",outline:"none"}}/>
);
const Sel=({value,onChange,options})=>(
  <select value={value||""} onChange={e=>onChange(e.target.value)}
    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,padding:"7px 10px",fontSize:13,width:"100%",fontFamily:"'DM Sans',sans-serif",outline:"none"}}>
    {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);
const Btn=({children,onClick,variant="primary",small,style:xStyle})=>{
  const bg=variant==="primary"?C.accent:variant==="danger"?"#7f1d1d":variant==="success"?"#14532d":variant==="export"?"#1e3a5f":C.border;
  const col=variant==="danger"?"#fca5a5":variant==="success"?"#86efac":variant==="export"?"#93c5fd":C.white;
  return <button onClick={onClick} style={{background:bg,color:col,border:"none",borderRadius:6,cursor:"pointer",padding:small?"5px 10px":"8px 16px",fontSize:small?12:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",...xStyle}}>{children}</button>;
};
const SLabel=({children})=><div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:"uppercase",marginBottom:10}}>{children}</div>;
const TeamBadge=({color,crest,size=28})=>crest
  ?<img src={crest} style={{width:size,height:size,borderRadius:6,objectFit:"cover",flexShrink:0,display:"inline-block"}} alt=""/>
  :<span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:size,height:size,borderRadius:6,background:color,fontSize:size*0.45,flexShrink:0}}>⚽</span>;
const FormPip=({r})=>{const bg=r==="W"?C.green:r==="L"?C.red:C.gold;return<span style={{display:"inline-block",width:14,height:14,borderRadius:3,background:bg,marginLeft:3,fontSize:9,fontWeight:700,color:"#000",textAlign:"center",lineHeight:"14px"}}>{r}</span>;};
const Empty=({icon,msg,hint})=><div style={{textAlign:"center",padding:"60px 0",color:C.muted}}><div style={{fontSize:32,marginBottom:12}}>{icon}</div><div style={{fontSize:15,color:C.sub}}>{msg}</div><div style={{fontSize:13,marginTop:6}}>{hint}</div></div>;
const NumStepper=({value,onChange,min=0,max=99,label,color=C.text})=>(
  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
    <div style={{fontSize:9,color:C.muted,letterSpacing:1,textTransform:"uppercase",textAlign:"center"}}>{label}</div>
    <div style={{display:"flex",alignItems:"center",gap:4}}>
      <button onClick={()=>onChange(Math.max(min,value-1))} style={{width:22,height:22,borderRadius:4,border:`1px solid ${C.border}`,background:C.surface,color:C.sub,cursor:"pointer",fontSize:14,lineHeight:1,fontFamily:"'DM Sans',sans-serif"}}>−</button>
      <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color,minWidth:24,textAlign:"center"}}>{value}</span>
      <button onClick={()=>onChange(Math.min(max,value+1))} style={{width:22,height:22,borderRadius:4,border:`1px solid ${C.border}`,background:C.surface,color:C.sub,cursor:"pointer",fontSize:14,lineHeight:1,fontFamily:"'DM Sans',sans-serif"}}>+</button>
    </div>
  </div>
);

function PredLineup({team,fixtures,side="left"}){
  if(!team||!team.players||team.players.length===0)return null;
  const{gk,defs,mdfs,fwds,formation}=predictedLineup(team,fixtures);
  const rows=[fwds,mdfs,defs].filter(r=>r.length>0);
  if(side==="right")rows.reverse();
  return(
    <div style={{flex:1}}>
      <div style={{fontSize:9,color:C.muted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6,textAlign:side==="right"?"right":"left"}}>{formation.label}</div>
      {rows.map((row,ri)=>(
        <div key={ri} style={{display:"flex",justifyContent:side==="right"?"flex-end":"flex-start",gap:4,marginBottom:4,flexWrap:"wrap"}}>
          {row.map(p=>(
            <div key={p.id} style={{background:posColor(p.position)+"22",border:`1px solid ${posColor(p.position)}44`,borderRadius:5,padding:"2px 6px",textAlign:"center"}}>
              <div style={{fontSize:9,color:posColor(p.position),fontWeight:700}}>{p.wide?"W-":""}{p.position}{p.altPosition?`/${p.altPosition}`:""}</div>
              <div style={{fontSize:10,color:C.text,fontWeight:600,whiteSpace:"nowrap",maxWidth:60,overflow:"hidden",textOverflow:"ellipsis"}}>{p.name||"?"}</div>
            </div>
          ))}
        </div>
      ))}
      {gk&&<div style={{display:"flex",justifyContent:side==="right"?"flex-end":"flex-start",marginTop:2}}>
        <div style={{background:`${C.gold}22`,border:`1px solid ${C.gold}44`,borderRadius:5,padding:"2px 6px"}}>
          <div style={{fontSize:9,color:C.gold,fontWeight:700}}>GK</div>
          <div style={{fontSize:10,color:C.text,fontWeight:600,whiteSpace:"nowrap",maxWidth:60,overflow:"hidden",textOverflow:"ellipsis"}}>{gk.name||"?"}</div>
        </div>
      </div>}
    </div>
  );
}

function PlayerProfileModal({data,fixtures,onClose}){
  const{player,team}=data;
  const orig=player._origPos||player.position;
  const pc=posColor(orig);
  const stats=useMemo(()=>{
    const s={goals:0,penGoals:0,assists:0,yellowCards:0,redCard:false,cleanSheets:0,apps:0,ratings:[]};
    fixtures.filter(f=>f.played).forEach(f=>{
      const ps=(f.playerStats||[]).find(x=>x.playerId===player.id);
      if(!ps)return;
      s.apps++;s.goals+=ps.goals||0;s.penGoals+=ps.penGoals||0;s.assists+=ps.assists||0;
      s.yellowCards+=ps.yellowCards||0;if(ps.redCard)s.redCard=true;
      if(ps.cleanSheet)s.cleanSheets++;if(ps.rating)s.ratings.push(ps.rating);
    });
    s.avgRating=s.ratings.length>0?(s.ratings.reduce((a,b)=>a+b,0)/s.ratings.length).toFixed(1):null;
    return s;
  },[player.id,fixtures]);
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,width:"100%",maxWidth:380,overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
        <div style={{background:`linear-gradient(135deg,${team.color}44,${team.color}11)`,borderBottom:`1px solid ${C.border}`,padding:"20px 20px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:1,color:C.white,lineHeight:1}}>{player.name||"Unknown"}</div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:team.color}}/><span style={{fontSize:12,color:C.sub,fontWeight:600}}>{team.name}</span></div>
                <span style={{background:pc+"33",color:pc,borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700}}>{orig}</span>
                {(player.wide&&(orig==="DEF"||orig==="FWD"))&&<span style={{background:`${C.accent}22`,color:C.accent,borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700}}>Wide</span>}
                {orig==="MDF"&&player.altPosition&&<span style={{background:`${C.muted}22`,color:C.muted,borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700}}>Also {player.altPosition}</span>}
              </div>
            </div>
            <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:18,padding:4,lineHeight:1,flexShrink:0}}>✕</button>
          </div>
        </div>
        {orig!=="GK"&&(
          <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:10}}>
            {(orig==="FWD"||orig==="MDF")&&<div style={{flex:1,background:C.surface,borderRadius:8,padding:"10px 12px",textAlign:"center"}}><div style={{fontSize:9,color:C.red,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Attack</div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.red}}>{orig==="FWD"?player.score:player.mdfAtkScore}</div></div>}
            {(orig==="DEF"||orig==="MDF")&&<div style={{flex:1,background:C.surface,borderRadius:8,padding:"10px 12px",textAlign:"center"}}><div style={{fontSize:9,color:C.green,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Defense</div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.green}}>{orig==="DEF"?player.score:player.mdfDefScore}</div></div>}
          </div>
        )}
        <div style={{padding:"16px 20px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:"uppercase",marginBottom:12}}>This Season</div>
          {stats.apps===0
            ?<div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>No appearances yet.</div>
            :<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {[
                {label:"Apps",val:stats.apps,color:C.sub},
                {label:"Goals",val:stats.goals,color:C.gold},
                {label:"Assists",val:stats.assists,color:C.green},
                ...(orig==="GK"?[{label:"Clean Sheets",val:stats.cleanSheets,color:C.accent}]:[]),
                {label:"Yellows",val:stats.yellowCards,color:C.gold},
                {label:"Avg Rating",val:stats.avgRating||"—",color:C.purple},
              ].map(({label,val,color})=>(
                <div key={label} style={{background:C.surface,borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{label}</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color}}>{val}</div>
                </div>
              ))}
            </div>
          }
        </div>
      </div>
    </div>
  );
}

function FieldLineup({home,away,fixtures,onPlayerClick}){
  if(!home||!away)return null;
  const hl=predictedLineup(home,fixtures);
  const al=predictedLineup(away,fixtures);
  const homeRows=[hl.defs,hl.mdfs,hl.fwds].filter(r=>r.length>0);
  const awayRows=[al.fwds,al.mdfs,al.defs].filter(r=>r.length>0);
  const Dot=({p,color,team})=>{
    const isCap=(p.roles||[]).includes('captain');
    const isPen=(p.roles||[]).includes('penTaker');
    return(
      <div onClick={()=>onPlayerClick&&onPlayerClick({player:p,team})} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,width:54,cursor:onPlayerClick?"pointer":"default",position:"relative"}}>
        <div style={{position:"relative",width:34,height:34}}>
          <div style={{width:34,height:34,borderRadius:"50%",background:color,border:"2.5px solid rgba(255,255,255,0.9)",boxShadow:"0 2px 8px rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontSize:7,fontWeight:900,color:"rgba(255,255,255,0.95)",letterSpacing:.5,textShadow:"0 1px 2px rgba(0,0,0,0.4)"}}>{p.position==="GK"?"GK":p.position}</span>
          </div>
          {isCap&&<div style={{position:"absolute",top:-4,right:-4,width:14,height:14,borderRadius:"50%",background:"#F59E0B",fontSize:7,fontWeight:900,color:"#000",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2,boxShadow:"0 1px 3px rgba(0,0,0,0.5)"}}>C</div>}
          {!isCap&&isPen&&<div style={{position:"absolute",top:-4,right:-4,width:14,height:14,borderRadius:"50%",background:"#3B82F6",fontSize:7,fontWeight:900,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2,boxShadow:"0 1px 3px rgba(0,0,0,0.5)"}}>P</div>}
        </div>
        <span style={{fontSize:9,color:"#fff",fontWeight:700,textAlign:"center",lineHeight:1.2,textShadow:"0 1px 3px rgba(0,0,0,0.9)",maxWidth:54,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>{(p.name||"?").trim().split(/\s+/).pop()||"?"}</span>
      </div>
    );
  };
  const PlayerRow=({players,color,team,staggerCenter=false,staggerDir=1})=>{
    const doStagger=staggerCenter&&players.length===3;
    return(
      <div style={{display:"flex",justifyContent:"center",gap:doStagger?20:players.length===2?36:6,padding:"0 4px",flexWrap:"wrap",alignItems:doStagger?(staggerDir>0?"flex-start":"flex-end"):"center"}}>
        {players.map((p,i)=>(
          <div key={p.id} style={{transform:doStagger&&i===1?`translateY(${14*staggerDir}px)`:"none"}}>
            <Dot p={p} color={color} team={team}/>
          </div>
        ))}
      </div>
    );
  };
  const BenchCol=({bench,color,team,align})=>(
    <div style={{width:56,background:"#0d2214",flexShrink:0,borderRight:align==='left'?'1px solid rgba(255,255,255,0.07)':0,borderLeft:align==='right'?'1px solid rgba(255,255,255,0.07)':0,padding:"14px 5px",display:"flex",flexDirection:"column",alignItems:"center"}}>
      <div style={{fontSize:6,color:"rgba(255,255,255,0.28)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:10,textAlign:"center"}}>bench</div>
      {bench.length===0&&<div style={{fontSize:8,color:"rgba(255,255,255,0.18)",textAlign:"center",lineHeight:1.4}}>—</div>}
      {bench.map(p=>(
        <div key={p.id} onClick={()=>onPlayerClick&&onPlayerClick({player:p,team})} style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:10,cursor:onPlayerClick?"pointer":"default"}}>
          <div style={{width:28,height:28,borderRadius:"50%",background:color+"99",border:`1.5px solid ${color}66`,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:3}}>
            <span style={{fontSize:7,fontWeight:900,color:"rgba(255,255,255,0.9)"}}>{p.position==="GK"?"GK":p.position}</span>
          </div>
          <span style={{fontSize:7,color:"rgba(255,255,255,0.6)",textAlign:"center",fontWeight:600,lineHeight:1.2,maxWidth:50,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(p.name||"?").trim().split(/\s+/).pop()}</span>
        </div>
      ))}
    </div>
  );
  return(
    <div style={{borderRadius:10,overflow:"hidden",display:"flex"}}>
      <BenchCol bench={hl.bench} color={home.color} team={home} align="left"/>
      <div style={{flex:1,position:"relative",background:"#1b6530"}}>
        <div style={{position:"absolute",inset:0,background:"repeating-linear-gradient(180deg,rgba(0,0,0,0) 0px,rgba(0,0,0,0) 36px,rgba(0,0,0,0.07) 36px,rgba(0,0,0,0.07) 72px)",pointerEvents:"none"}}/>
        <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}} viewBox="0 0 300 460" preserveAspectRatio="none">
          <rect x="8" y="6" width="284" height="448" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5"/>
          <line x1="8" y1="230" x2="292" y2="230" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5"/>
          <ellipse cx="150" cy="230" rx="44" ry="28" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5"/>
          <circle cx="150" cy="230" r="2.5" fill="rgba(255,255,255,0.3)"/>
          <rect x="82" y="6" width="136" height="68" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2"/>
          <rect x="82" y="386" width="136" height="68" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2"/>
          <rect x="114" y="6" width="72" height="24" fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="1"/>
          <rect x="114" y="430" width="72" height="24" fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="1"/>
        </svg>
        <div style={{position:"relative",zIndex:1,padding:"20px 10px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,padding:"0 4px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:2,background:home.color,flexShrink:0}}/><span style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.9)",letterSpacing:.5}}>{home.name}</span></div>
            <span style={{fontSize:9,color:"rgba(255,255,255,0.5)",fontWeight:600,letterSpacing:1}}>{hl.formation.label}</span>
          </div>
          {hl.gk&&<div style={{display:"flex",justifyContent:"center",marginBottom:28}}><Dot p={hl.gk} color={home.color} team={home}/></div>}
          {hl.defs.length>0&&<div style={{marginBottom:28}}><PlayerRow players={hl.defs} color={home.color} team={home}/></div>}
          {hl.mdfs.length>0&&<div style={{marginBottom:28}}><PlayerRow players={hl.mdfs} color={home.color} team={home}/></div>}
          {hl.fwds.length>0&&<div style={{marginBottom:28}}><PlayerRow players={hl.fwds} color={home.color} team={home} staggerCenter={hl.fwds.length===3} staggerDir={1}/></div>}
          <div style={{display:"flex",alignItems:"center",gap:8,margin:"20px 0"}}>
            <div style={{flex:1,height:1,background:"rgba(255,255,255,0.15)"}}/><span style={{fontSize:8,color:"rgba(255,255,255,0.4)",fontWeight:700,letterSpacing:2,textTransform:"uppercase"}}>kick off</span><div style={{flex:1,height:1,background:"rgba(255,255,255,0.15)"}}/>
          </div>
          {al.fwds.length>0&&<div style={{marginBottom:28}}><PlayerRow players={al.fwds} color={away.color} team={away} staggerCenter={al.fwds.length===3} staggerDir={-1}/></div>}
          {al.mdfs.length>0&&<div style={{marginBottom:28}}><PlayerRow players={al.mdfs} color={away.color} team={away}/></div>}
          {al.defs.length>0&&<div style={{marginBottom:28}}><PlayerRow players={al.defs} color={away.color} team={away}/></div>}
          {al.gk&&<div style={{display:"flex",justifyContent:"center",marginBottom:24}}><Dot p={al.gk} color={away.color} team={away}/></div>}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 4px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:2,background:away.color,flexShrink:0}}/><span style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.9)",letterSpacing:.5}}>{away.name}</span></div>
            <span style={{fontSize:9,color:"rgba(255,255,255,0.5)",fontWeight:600,letterSpacing:1}}>{al.formation.label}</span>
          </div>
        </div>
      </div>
      <BenchCol bench={al.bench} color={away.color} team={away} align="right"/>
    </div>
  );
}

function FixturesTab({teams,fixtures,onPlayerClick,activeMatchWeek,onApplySim}){
  const[filter,setFilter]=useState("all");
  const[expandedId,setExpandedId]=useState(null);
  const[simResults,setSimResults]=useState({});
  const currentMW=activeMatchWeek;
  const shown=fixtures.filter(f=>filter==="all"?true:filter==="played"?f.played:!f.played);
  const grouped=shown.reduce((acc,f)=>{const k=f.matchWeek!=null?`__mw__${f.matchWeek}`:f.date||"TBC";if(!acc[k])acc[k]=[];acc[k].push(f);return acc;},{});
  if(fixtures.length===0)return<Empty icon="📅" msg="No fixtures yet." hint="Go to Manage → Fixtures to add some."/>;
  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        {["all","played","upcoming"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{background:filter===f?C.accent:C.card,color:filter===f?C.white:C.sub,border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",textTransform:"capitalize"}}>{f}</button>
        ))}
      </div>
      {Object.entries(grouped).sort(([a],[b])=>{const am=a.startsWith("__mw__"),bm=b.startsWith("__mw__");if(am&&bm)return parseInt(a.slice(6))-parseInt(b.slice(6));if(am)return-1;if(bm)return 1;return a.localeCompare(b);}).map(([key,matches])=>(
        <div key={key} style={{marginBottom:22}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:"uppercase",marginBottom:10}}>{key.startsWith("__mw__")?`Match Week ${key.slice(6)}`:fmtDate(key)}</div>
          {matches.map(f=>{
            const h=teams.find(t=>t.id===f.homeId),a=teams.find(t=>t.id===f.awayId);
            if(!h||!a)return null;
            const expanded=expandedId===f.id;
            return(
              <div key={f.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,marginBottom:8,overflow:"hidden"}}>
                <div style={{padding:"14px 16px",display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:12,cursor:"pointer"}} onClick={()=>setExpandedId(expanded?null:f.id)}>
                  <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end"}}>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:C.text,letterSpacing:.5}}>{h.name}</span>
                    <TeamBadge color={h.color} crest={h.crest} size={26}/>
                  </div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:f.played?26:15,color:f.played?C.gold:C.muted,background:C.surface,borderRadius:8,padding:"6px 16px",textAlign:"center",letterSpacing:2,minWidth:80}}>
                    {f.played?`${f.homeScore}  ${f.awayScore}`:"vs"}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <TeamBadge color={a.color} crest={a.crest} size={26}/>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:C.text,letterSpacing:.5}}>{a.name}</span>
                  </div>
                </div>
                {expanded&&!f.played&&(
                  <>
                    {(f.matchWeek==null||f.matchWeek===currentMW)&&(
                      <div style={{borderTop:`1px solid ${C.border}`,padding:"14px 14px",background:C.surface}}>
                        <div style={{fontSize:13,fontWeight:800,letterSpacing:2,color:C.text,textTransform:"uppercase",textAlign:"center",marginBottom:14}}>Predicted Lineups</div>
                        <FieldLineup home={h} away={a} fixtures={fixtures} onPlayerClick={onPlayerClick}/>
                        <div style={{fontSize:10,color:C.muted,marginTop:8,textAlign:"center"}}>Based on form & availability</div>
                      </div>
                    )}
                    <MatchSimPanel
                      fixture={f} home={h} away={a} fixtures={fixtures}
                      sim={simResults[f.id]||null}
                      onSimulate={()=>setSimResults(p=>({...p,[f.id]:simulateMatch(h,a,fixtures)}))}
                      onApply={onApplySim&&simResults[f.id]?()=>onApplySim(f,simResults[f.id],h,a):null}
                    />
                  </>
                )}
                {expanded&&f.played&&(()=>{
                  const stats=f.playerStats||[];
                  const scorers=stats.filter(ps=>ps.goals>0).map(ps=>{
                    const player=[...h.players,...a.players].find(p=>p.id===ps.playerId);
                    const team=h.players.find(p=>p.id===ps.playerId)?h:a;
                    return player?{...ps,name:player.name,teamColor:team.color}:null;
                  }).filter(Boolean);
                  const assists=stats.filter(ps=>ps.assists>0).map(ps=>{
                    const player=[...h.players,...a.players].find(p=>p.id===ps.playerId);
                    const team=h.players.find(p=>p.id===ps.playerId)?h:a;
                    return player?{...ps,name:player.name,teamColor:team.color}:null;
                  }).filter(Boolean);
                  return(
                    <div style={{borderTop:`1px solid ${C.border}`,padding:"12px 16px",background:C.surface}}>
                      {scorers.length>0&&<div style={{marginBottom:8}}>
                        <div style={{fontSize:9,color:C.muted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:5}}>⚽ Scorers</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                          {scorers.map((s,i)=><span key={i} style={{fontSize:11,color:C.text,background:C.card,borderRadius:5,padding:"3px 8px",display:"flex",alignItems:"center",gap:4}}>
                            <span style={{width:7,height:7,borderRadius:"50%",background:s.teamColor,display:"inline-block"}}/>{s.name} {s.goals}{s.penGoals>0?` (${s.penGoals}p)`:""}
                          </span>)}
                        </div>
                      </div>}
                      {assists.length>0&&<div>
                        <div style={{fontSize:9,color:C.muted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:5}}>🎯 Assists</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                          {assists.map((s,i)=><span key={i} style={{fontSize:11,color:C.text,background:C.card,borderRadius:5,padding:"3px 8px",display:"flex",alignItems:"center",gap:4}}>
                            <span style={{width:7,height:7,borderRadius:"50%",background:s.teamColor,display:"inline-block"}}/>{s.name} {s.assists}
                          </span>)}
                        </div>
                      </div>}
                      {scorers.length===0&&assists.length===0&&<div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>No stats recorded.</div>}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TableTab({teams,fixtures}){
  const table=useMemo(()=>computeTable(teams,fixtures),[teams,fixtures]);
  if(table.length===0)return<Empty icon="🏆" msg="No teams yet." hint="Go to Manage → Teams."/>;
  return(
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
          {["#","Team","P","W","D","L","GF","GA","GD","Form","Pts"].map(h=>(
            <th key={h} style={{padding:"8px 10px",fontSize:10,fontWeight:700,letterSpacing:1.5,color:C.muted,textAlign:h==="Team"||h==="Form"?"left":"center",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {table.map((row,i)=>{
            const gd=row.gf-row.ga,isTop=i<3,isBot=i>=table.length-3;
            return(
              <tr key={row.id} style={{borderBottom:`1px solid ${C.border}22`}}>
                <td style={{padding:"13px 10px",textAlign:"center"}}>
                  <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:4,background:isTop?C.accent:isBot?`${C.red}22`:"transparent",color:isTop?C.white:isBot?C.red:C.muted,fontSize:11,fontWeight:700}}>{i+1}</span>
                </td>
                <td style={{padding:"13px 10px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <TeamBadge color={row.color} crest={row.crest} size={22}/>
                    <div><div style={{fontWeight:600,fontSize:14,color:C.text}}>{row.name}</div><div style={{fontSize:10,color:C.muted}}>{row.shortName}</div></div>
                  </div>
                </td>
                {[row.p,row.w,row.d,row.l,row.gf,row.ga].map((v,j)=><td key={j} style={{padding:"13px 10px",textAlign:"center",fontSize:13,color:C.sub}}>{v}</td>)}
                <td style={{padding:"13px 10px",textAlign:"center",fontSize:13,fontWeight:700,color:gd>0?C.green:gd<0?C.red:C.sub}}>{gd>0?`+${gd}`:gd}</td>
                <td style={{padding:"13px 10px"}}><div style={{display:"flex"}}>{row.form.slice(-5).length===0?<span style={{fontSize:11,color:C.muted}}>—</span>:row.form.slice(-5).map((r,ri)=><FormPip key={ri} r={r}/>)}</div></td>
                <td style={{padding:"13px 10px",textAlign:"center"}}><span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:isTop?C.gold:C.text}}>{row.pts}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{marginTop:14,display:"flex",gap:16,fontSize:11,color:C.muted}}>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:C.accent,display:"inline-block"}}/>Promotion</span>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:`${C.red}44`,border:`1px solid ${C.red}`,display:"inline-block"}}/>Relegation</span>
      </div>
    </div>
  );
}

function StatsTab({teams,fixtures}){
  const[cat,setCat]=useState("goals");
  const playerStats=useMemo(()=>computePlayerStats(teams,fixtures),[teams,fixtures]);
  const playedCount=fixtures.filter(f=>f.played).length;
  if(playedCount===0)return<Empty icon="📊" msg="No results yet." hint="Mark fixtures as played and add player stats."/>;
  const cats=[{key:"goals",label:"⚽ Goals",color:C.gold},{key:"assists",label:"🎯 Assists",color:C.green},{key:"avgRating",label:"⭐ Rating",color:C.purple},{key:"cleanSheets",label:"🧤 Clean Sheets",color:C.accent},{key:"yellowCards",label:"🟨 Yellows",color:C.gold},{key:"redCard",label:"🟥 Reds",color:C.red}];
  const sorted=key=>[...playerStats].filter(p=>{
    if(key==="goals"||key==="assists"||key==="yellowCards"||key==="cleanSheets")return(p[key]||0)>0;
    if(key==="redCard")return p.redCard;
    if(key==="avgRating")return p.avgRating!==null;
    return false;
  }).sort((a,b)=>{
    if(key==="redCard")return(b.redCard?1:0)-(a.redCard?1:0);
    if(key==="avgRating")return b.avgRating-a.avgRating;
    return(b[key]||0)-(a[key]||0);
  });
  const list=sorted(cat);
  const maxVal=(key,data)=>{if(key==="redCard")return 1;if(key==="avgRating")return 10;return Math.max(...data.map(p=>+(p[key]||0)),1);};
  const getVal=(p,key)=>{if(key==="redCard")return p.redCard?"Red Card":"";if(key==="avgRating")return p.avgRating;if(key==="goals")return`${p.goals}${p.penGoals>0?` (${p.penGoals} pen)`:""}`;return p[key]||0;};
  const getNum=(p,key)=>{if(key==="redCard")return p.redCard?1:0;if(key==="avgRating")return parseFloat(p.avgRating)||0;return p[key]||0;};
  const current=cats.find(c=>c.key===cat);
  const mv=maxVal(cat,list);
  return(
    <div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:20}}>
        {cats.map(c=><button key={c.key} onClick={()=>setCat(c.key)} style={{background:cat===c.key?C.card:C.surface,color:cat===c.key?C.white:C.muted,border:`1px solid ${cat===c.key?C.accent:C.border}`,borderRadius:20,padding:"5px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>{c.label}</button>)}
      </div>
      <div style={{marginBottom:16}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:C.white,letterSpacing:1}}>{current.label}</div>
        <div style={{fontSize:11,color:C.muted}}>{playedCount} match{playedCount!==1?"es":""} · {list.length} player{list.length!==1?"s":""}</div>
      </div>
      {list.length===0&&<div style={{color:C.muted,fontSize:13,fontStyle:"italic"}}>None recorded yet.</div>}
      {list.map((p,i)=>{
        const val=getVal(p,cat),num=getNum(p,cat),pct=mv>0?Math.round((num/mv)*100):0,isFirst=i===0;
        return(
          <div key={p.playerId} style={{background:isFirst?`${current.color}11`:C.card,border:`1px solid ${isFirst?current.color+"44":C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:cat!=="redCard"?6:0}}>
              <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:isFirst?28:18,color:isFirst?current.color:C.muted,minWidth:28,textAlign:"center"}}>{i+1}</span>
              <span style={{width:8,height:8,borderRadius:"50%",background:p.teamColor,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:600,color:C.text}}>{p.name||"Unnamed"}</div>
                <div style={{fontSize:11,color:C.muted}}>{p.teamName} · {p.position} · {p.apps} app{p.apps!==1?"s":""}</div>
              </div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:isFirst?32:24,color:isFirst?current.color:C.text,lineHeight:1}}>{val}</div>
            </div>
            {cat!=="redCard"&&<div style={{height:3,background:C.border,borderRadius:2,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:current.color,borderRadius:2}}/></div>}
          </div>
        );
      })}
    </div>
  );
}

function RatingsTab({teams}){
  const[metric,setMetric]=useState("atk");
  const teamStats=teams.filter(t=>t.name&&t.players.length>0).map(t=>({...t,...lineupRatings(t)})).sort((a,b)=>metric==="atk"?b.atk-a.atk:b.def-a.def);
  const getPlayerVal=(p,metric)=>{if(p.position==="GK")return 0;if(metric==="atk"){if(p.position==="FWD")return p.score;if(p.position==="MDF")return p.mdfAtkScore;return 0;}else{if(p.position==="DEF")return p.score;if(p.position==="MDF")return p.mdfDefScore;return 0;}};
  const allPlayers=teams.flatMap(t=>t.players.filter(p=>p.name).map(p=>({...p,_team:t,teamName:t.name,teamColor:t.color,teamShort:t.shortName||(t.name&&t.name.slice(0,3).toUpperCase())})));
  const sorted=[...allPlayers].map(p=>({...p,val:getPlayerVal(p,metric)})).filter(p=>p.val>0).sort((a,b)=>b.val-a.val);
  const valuesSorted=[...allPlayers].map(p=>({...p,tv:playerValue(p,p._team)})).sort((a,b)=>b.tv-a.tv);
  const maxTv=valuesSorted[0]?.tv||1;
  if(allPlayers.length===0)return<Empty icon="🎖️" msg="No players yet." hint="Go to Manage → Teams."/>;
  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        {[{key:"atk",label:"Attack",color:C.red},{key:"def",label:"Defense",color:C.green},{key:"val",label:"Values",color:C.gold}].map(m=>(
          <button key={m.key} onClick={()=>setMetric(m.key)} style={{background:metric===m.key?m.color:C.card,color:metric===m.key?"#000":C.sub,border:"none",borderRadius:6,padding:"7px 16px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{m.label}</button>
        ))}
      </div>
      {metric==="val"?(
        <div>
          <SLabel>Transfer Values</SLabel>
          {valuesSorted.map((p,i)=>(
            <div key={p.id} style={{background:C.card,borderRadius:8,padding:"10px 14px",marginBottom:7}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:5}}>
                <span style={{fontSize:12,color:C.muted,minWidth:20}}>#{i+1}</span>
                <span style={{width:8,height:8,borderRadius:"50%",background:p.teamColor,flexShrink:0}}/>
                <span style={{fontSize:14,fontWeight:600,color:C.text,flex:1}}>{p.name}</span>
                <span style={{fontSize:10,color:C.muted}}>Age {p.age||25}</span>
                <span style={{background:posColor(p.position)+"22",color:posColor(p.position),borderRadius:4,padding:"2px 6px",fontSize:10,fontWeight:700}}>{p.position}</span>
                <span style={{fontSize:11,color:C.muted}}>{p.teamShort}</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:C.gold,minWidth:52,textAlign:"right"}}>£{p.tv}M</span>
              </div>
              <div style={{height:4,background:C.border,borderRadius:2,overflow:"hidden"}}><div style={{width:`${(p.tv/maxTv)*100}%`,height:"100%",background:C.gold,borderRadius:2}}/></div>
            </div>
          ))}
        </div>
      ):(
        <div>
          <SLabel>Team Rankings</SLabel>
          <div style={{marginBottom:24}}>
            {teamStats.map((t,i)=>{const val=metric==="atk"?t.atk:t.def,color=metric==="atk"?C.red:C.green;return(
              <div key={t.id} style={{background:C.card,borderRadius:8,padding:"10px 14px",marginBottom:7}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:5}}>
                  <span style={{fontSize:12,color:C.muted,minWidth:20}}>#{i+1}</span>
                  <TeamBadge color={t.color} crest={t.crest} size={20}/>
                  <span style={{fontSize:13,fontWeight:600,color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</span>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color,minWidth:36,textAlign:"right"}}>{val||"—"}</span>
                </div>
                <div style={{height:4,background:C.border,borderRadius:2,overflow:"hidden"}}><div style={{width:`${((val||0)/10)*100}%`,height:"100%",background:color,borderRadius:2}}/></div>
              </div>
            );})}
          </div>
          <SLabel>Top Players</SLabel>
          {sorted.slice(0,20).map((p,i)=>{const color=metric==="atk"?C.red:C.green;return(
            <div key={p.id} style={{background:C.card,borderRadius:8,padding:"10px 14px",marginBottom:7}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:5}}>
                <span style={{fontSize:12,color:C.muted,minWidth:20}}>#{i+1}</span>
                <span style={{width:8,height:8,borderRadius:"50%",background:p.teamColor,flexShrink:0}}/>
                <span style={{fontSize:14,fontWeight:600,color:C.text,flex:1}}>{p.name}</span>
                <span style={{background:posColor(p.position)+"22",color:posColor(p.position),borderRadius:4,padding:"2px 6px",fontSize:10,fontWeight:700}}>{p.position}</span>
                <span style={{fontSize:11,color:C.muted}}>{p.teamShort}</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color,minWidth:36,textAlign:"right"}}>{p.val}</span>
              </div>
              <div style={{height:4,background:C.border,borderRadius:2,overflow:"hidden"}}><div style={{width:`${(p.val/10)*100}%`,height:"100%",background:color,borderRadius:2}}/></div>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

function SquadsTab({teams,setTeams}){
  const named=teams.filter(t=>t.name&&t.players.length>0);
  const[selId,setSelId]=useState(null);
  const team=teams.find(t=>t.id===selId);
  const toggle=(pid,field)=>{
    const nt=teams.map(t=>t.id!==selId?t:{...t,players:t.players.map(p=>p.id!==pid?p:{...p,[field]:!p[field],...(field==="suspended"&&!p.suspended?{injured:false}:{}),...(field==="injured"&&!p.injured?{suspended:false}:{})})});
    setTeams(nt);syncTeams(nt);
  };
  const setFormation=fid=>{const nt=teams.map(t=>t.id!==selId?t:{...t,formation:fid});setTeams(nt);syncTeams(nt);};
  if(named.length===0)return<Empty icon="📋" msg="No teams with players yet." hint="Go to Manage → Teams first."/>;
  const ratings=team?lineupRatings(team):null;
  const activeOut=team?team.players.filter(p=>p.position!=="GK"&&!p.injured&&!p.suspended):[];
  const gk=team?team.players.find(p=>p.position==="GK"&&!p.injured&&!p.suspended):null;
  const startingCount=(gk?1:0)+Math.min(activeOut.length,5);
  return(
    <div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
        {named.map(t=><button key={t.id} onClick={()=>setSelId(t.id)} style={{background:selId===t.id?t.color:C.card,color:selId===t.id?"#000":C.sub,border:`1px solid ${selId===t.id?t.color:C.border}`,borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{t.name}</button>)}
      </div>
      {!team&&<Empty icon="👆" msg="Select a team above." hint=""/>}
      {team&&<div>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Formation</div>
          <div style={{display:"inline-block",background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 16px",fontSize:13,fontWeight:700,color:C.text,fontFamily:"'DM Sans',sans-serif"}}>{team.formation||"2-2-1"}</div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 18px",marginBottom:18,display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,textAlign:"center"}}>
          <div><div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Available</div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:startingCount===6?C.green:C.gold}}>{startingCount}<span style={{fontSize:14,color:C.muted}}>/6</span></div></div>
          <div><div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>GK</div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:gk?C.gold:C.red,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{gk?gk.name||"✓":"—"}</div></div>
          <div><div style={{fontSize:10,color:C.red,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Attack</div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.red}}>{ratings.atk||"—"}</div></div>
          <div><div style={{fontSize:10,color:C.green,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Defense</div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.green}}>{ratings.def||"—"}</div></div>
        </div>
        {["GK","DEF","MDF","FWD"].map(pos=>{
          const posPlayers=team.players.filter(p=>p.position===pos);
          if(posPlayers.length===0)return null;
          const posLabel=pos==="GK"?"Goalkeeper":pos==="DEF"?"Defenders":pos==="MDF"?"Midfielders":"Forwards";
          return(
            <div key={pos} style={{marginBottom:16}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:posColor(pos),textTransform:"uppercase",marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:posColor(pos),display:"inline-block"}}/>{posLabel}
              </div>
              {posPlayers.map(p=>{
                const active=!p.injured&&!p.suspended,isGK=p.position==="GK";
                const widePrefix=p.wide&&(p.position==="DEF"||p.position==="FWD")?"Wide ":"";
                const altLabel=p.position==="MDF"&&p.altPosition?` · Also ${p.altPosition}`:"";
                const scoreLabel=isGK?"Not rated":p.position==="FWD"?`${widePrefix}ATK ${p.score}`:p.position==="DEF"?`${widePrefix}DEF ${p.score}`:`ATK ${p.mdfAtkScore} · DEF ${p.mdfDefScore}${altLabel}`;
                return(
                  <div key={p.id} style={{background:active?C.card:C.surface,border:`1px solid ${active?C.border:C.border+"44"}`,borderRadius:8,padding:"11px 14px",marginBottom:7,opacity:p.injured?0.5:1,display:"flex",alignItems:"center",gap:12}}>
                    <div style={{background:posColor(p.position)+"22",color:posColor(p.position),borderRadius:5,padding:"3px 7px",fontSize:10,fontWeight:700,minWidth:36,textAlign:"center",flexShrink:0}}>{p.position}</div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                        <div style={{fontSize:14,fontWeight:600,color:active?C.text:C.muted}}>{p.name||"Unnamed"}</div>
                        {(p.roles||[]).map(r=>{const role=ROLES.find(x=>x.id===r);return role?<span key={r} style={{fontSize:9,fontWeight:700,color:role.color,background:role.color+"22",border:`1px solid ${role.color}44`,borderRadius:3,padding:"1px 5px"}}>{role.short}</span>:null;})}
                      </div>
                      <div style={{fontSize:11,color:C.muted,marginTop:2}}>{scoreLabel}</div>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>toggle(p.id,"injured")} style={{background:p.injured?`${C.red}33`:"transparent",color:p.injured?C.red:C.muted,border:`1px solid ${p.injured?C.red:C.border}`,borderRadius:5,padding:"4px 9px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Injured</button>
                      <button onClick={()=>toggle(p.id,"suspended")} style={{background:p.suspended?`${C.gold}33`:"transparent",color:p.suspended?C.gold:C.muted,border:`1px solid ${p.suspended?C.gold:C.border}`,borderRadius:5,padding:"4px 9px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Susp.</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {team.players.some(p=>p.suspended||p.injured)&&(
          <div style={{marginTop:8,background:C.surface,borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Unavailable</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {team.players.filter(p=>p.suspended||p.injured).map(p=><span key={p.id} style={{background:p.injured?`${C.red}22`:`${C.gold}22`,color:p.injured?C.red:C.gold,border:`1px solid ${p.injured?C.red:C.gold}44`,borderRadius:5,padding:"3px 9px",fontSize:11,fontWeight:600}}>{p.name||"Unnamed"} · {p.injured?"Injured":"Suspended"}</span>)}
            </div>
          </div>
        )}
      </div>}
    </div>
  );
}

function OddsTab({teams,fixtures,activeMatchWeek}){
  const hasMW=fixtures.some(f=>f.matchWeek!=null);
  const upcoming=fixtures.filter(f=>!f.played&&f.homeId&&f.awayId&&(!hasMW||f.matchWeek===activeMatchWeek));
  if(upcoming.length===0)return<Empty icon="🎲" msg="No upcoming fixtures." hint="Add fixtures in Manage → Fixtures."/>;
  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {upcoming.map(f=>{
        const h=teams.find(t=>t.id===f.homeId),a=teams.find(t=>t.id===f.awayId);
        if(!h||!a)return null;
        const hr=lineupRatings(h),ar=lineupRatings(a),odds=calcOdds(h,a),pred=predictMatch(h,a);
        const minO=Math.min(odds.home,odds.draw,odds.away);
        return(
          <div key={f.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"16px 18px",borderBottom:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{fmtDate(f.date)}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:12}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <TeamBadge color={h.color} crest={h.crest} size={30}/>
                  <div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:C.text}}>{h.name}</div><div style={{fontSize:10,color:C.muted}}>ATK {hr.atk} · DEF {hr.def}</div></div>
                </div>
                <div style={{textAlign:"center",fontFamily:"'Bebas Neue',sans-serif",fontSize:13,color:C.muted,letterSpacing:2}}>VS</div>
                <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end"}}>
                  <div style={{textAlign:"right"}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:C.text}}>{a.name}</div><div style={{fontSize:10,color:C.muted}}>ATK {ar.atk} · DEF {ar.def}</div></div>
                  <TeamBadge color={a.color} crest={a.crest} size={30}/>
                </div>
              </div>
            </div>
            <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
              <div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Predicted Score</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:20}}>
                <div style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:52,lineHeight:1,color:C.gold}}>{pred.hGoals}</div><div style={{fontSize:10,color:C.muted,marginTop:2}}>xG {pred.hxg}</div></div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:C.muted}}>–</div>
                <div style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:52,lineHeight:1,color:C.gold}}>{pred.aGoals}</div><div style={{fontSize:10,color:C.muted,marginTop:2}}>xG {pred.axg}</div></div>
              </div>
            </div>
            <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Win Probability</div>
              <div style={{display:"flex",height:8,borderRadius:4,overflow:"hidden",gap:2}}>
                <div style={{width:`${odds.pHome}%`,background:h.color}}/><div style={{width:`${odds.pDraw}%`,background:C.muted}}/><div style={{width:`${odds.pAway}%`,background:a.color}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:11}}>
                <span style={{color:h.color,fontWeight:700}}>{odds.pHome}% {h.shortName||h.name}</span>
                <span style={{color:C.muted}}>Draw {odds.pDraw}%</span>
                <span style={{color:a.color,fontWeight:700}}>{a.shortName||a.name} {odds.pAway}%</span>
              </div>
            </div>
            <div style={{padding:"14px 18px"}}>
              <div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Odds</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[{label:`${h.shortName||h.name} Win`,val:odds.home},{label:"Draw",val:odds.draw},{label:`${a.shortName||a.name} Win`,val:odds.away}].map(({label,val})=>{
                  const fav=val===minO;
                  return<div key={label} style={{background:fav?C.accent:C.surface,borderRadius:8,padding:"10px 8px",textAlign:"center",border:`1px solid ${fav?C.accent:C.border}`}}>
                    <div style={{fontSize:10,color:fav?"#fff":C.muted,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{label}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:fav?C.white:C.text}}>{val}</div>
                  </div>;
                })}
              </div>
            </div>
          </div>
        );
      })}
      <div style={{fontSize:11,color:C.muted,textAlign:"center",paddingBottom:8}}>Entertainment only</div>
    </div>
  );
}

function TransfersTab({transfers,teams}){
  if(transfers.length===0)return<Empty icon="🔄" msg="No transfers yet." hint="Go to Manage → Transfers to make a trade."/>;
  return(
    <div>
      <SLabel>Transfer History</SLabel>
      {[...transfers].sort((a,b)=>b.date.localeCompare(a.date)).map(t=>{
        const from=teams.find(x=>x.id===t.fromTeamId);
        const to=teams.find(x=>x.id===t.toTeamId);
        return(
          <div key={t.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 16px",marginBottom:10}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:12,letterSpacing:1}}>{t.date||"Unknown date"}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:8}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                  <TeamBadge color={t.fromTeamColor} crest={from?.crest} size={18}/>
                  <span style={{fontSize:10,color:C.muted,fontWeight:600}}>{t.fromTeamName}</span>
                </div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.text,letterSpacing:.5}}>{t.playerOut.name}</div>
                <div style={{fontSize:10,color:posColor(t.playerOut.position),fontWeight:700,marginTop:2}}>{t.playerOut.position}</div>
              </div>
              <div style={{fontSize:20,color:C.muted,fontWeight:300}}>⇄</div>
              <div style={{textAlign:"right"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,justifyContent:"flex-end"}}>
                  <span style={{fontSize:10,color:C.muted,fontWeight:600}}>{t.toTeamName}</span>
                  <TeamBadge color={t.toTeamColor} crest={to?.crest} size={18}/>
                </div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.text,letterSpacing:.5}}>{t.playerIn.name}</div>
                <div style={{fontSize:10,color:posColor(t.playerIn.position),fontWeight:700,marginTop:2}}>{t.playerIn.position}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ManageTab({teams,setTeams,fixtures,setFixtures,transfers,setTransfers,activeMatchWeek,setActiveMatchWeek,onExport,onImport,onToast}){
  const[view,setView]=useState("teams");
  const[editTeam,setEditTeam]=useState(null);
  const[editFix,setEditFix]=useState(null);
  const[tradeTeamA,setTradeTeamA]=useState(null);
  const[tradeTeamB,setTradeTeamB]=useState(null);
  const[tradePlayerA,setTradePlayerA]=useState(null);
  const[tradePlayerB,setTradePlayerB]=useState(null);
  const named=teams.filter(t=>t.name);
  const importRef=useRef();

  const teamA=teams.find(t=>t.id===tradeTeamA);
  const teamB=teams.find(t=>t.id===tradeTeamB);
  const playerA=teamA?.players.find(p=>p.id===tradePlayerA);
  const playerB=teamB?.players.find(p=>p.id===tradePlayerB);

  const executeTrade=()=>{
    if(!teamA||!teamB||!playerA||!playerB)return;
    const nt=teams.map(t=>{
      if(t.id===teamA.id)return{...t,players:[...t.players.filter(p=>p.id!==playerA.id),playerB]};
      if(t.id===teamB.id)return{...t,players:[...t.players.filter(p=>p.id!==playerB.id),playerA]};
      return t;
    });
    const record={
      id:`transfer_${Date.now()}`,type:'transfer',
      date:new Date().toISOString().slice(0,10),
      fromTeamId:teamA.id,fromTeamName:teamA.name,fromTeamColor:teamA.color,
      toTeamId:teamB.id,toTeamName:teamB.name,toTeamColor:teamB.color,
      playerOut:{id:playerA.id,name:playerA.name,position:playerA.position},
      playerIn:{id:playerB.id,name:playerB.name,position:playerB.position},
    };
    setTeams(nt);syncTeams(nt);
    setTransfers(prev=>[record,...prev]);syncTransfer(record);
    setTradeTeamA(null);setTradeTeamB(null);setTradePlayerA(null);setTradePlayerB(null);
    onToast('Trade completed!');
  };

  const saveTeam=t=>{const nt=teams.map(x=>x.id===t.id?t:x);setTeams(nt);syncTeams(nt);setEditTeam(null);};
  const addPlayer=t=>{if(t.players.length<8)setEditTeam({...t,players:[...t.players,makePlayer()]});};
  const updPlayer=(t,pid,field,val)=>setEditTeam({...t,players:t.players.map(p=>p.id===pid?{...p,[field]:val}:p)});
  const toggleRole=(t,pid,roleId)=>setEditTeam({...t,players:t.players.map(p=>{
    if(p.id===pid){const has=(p.roles||[]).includes(roleId);return{...p,roles:has?(p.roles||[]).filter(r=>r!==roleId):[...(p.roles||[]),roleId]};}
    return{...p,roles:(p.roles||[]).filter(r=>r!==roleId)};
  })});
  const delPlayer=(t,pid)=>setEditTeam({...t,players:t.players.filter(p=>p.id!==pid)});
  const addFix=()=>{setEditFix({...makeFixture()});};
  const saveFix=f=>{setFixtures(fs=>{const ex=fs.some(x=>x.id===f.id);return ex?fs.map(x=>x.id===f.id?f:x):[...fs,f];});syncFixture(f);setEditFix(null);};
  const delFix=id=>{setFixtures(fs=>fs.filter(f=>f.id!==id));deleteFixture(id);setEditFix(null);};
  const genSeason=async()=>{
    if(named.length<2){onToast("Need at least 2 named teams");return;}
    if(fixtures.length>0&&!window.confirm(`Replace ${fixtures.length} existing fixture(s) with a generated season?`))return;
    await Promise.all(fixtures.map(f=>deleteFixture(f.id)));
    const newFix=generateSeason(named);
    setFixtures(newFix);
    await Promise.all(newFix.map(f=>syncFixture(f)));
    onToast(`⚡ ${newFix.length} fixtures generated across 11 match weeks!`);
  };
  const initFixStats=(f,teams)=>{
    const hTeam=teams.find(t=>t.id===f.homeId),aTeam=teams.find(t=>t.id===f.awayId);
    const allP=[...(hTeam?.players||[]).map(p=>({...p,teamId:hTeam.id})),...(aTeam?.players||[]).map(p=>({...p,teamId:aTeam.id}))];
    const ex=f.playerStats||[];
    return allP.map(p=>{const e=ex.find(ps=>ps.playerId===p.id);return e?e:{playerId:p.id,teamId:p.teamId,goals:0,penGoals:0,assists:0,yellowCards:0,redCard:false,cleanSheet:false,rating:0};});
  };
  const updFixStat=(f,pid,field,val)=>setEditFix({...f,playerStats:f.playerStats.map(ps=>ps.playerId===pid?{...ps,[field]:val}:ps)});
  const openFix=f=>setEditFix({...f,playerStats:initFixStats(f,teams)});

  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:24}}>
        {["teams","fixtures","transfers","season"].map(v=>(
          <button key={v} onClick={()=>{setView(v);setEditTeam(null);setEditFix(null);}} style={{background:view===v?C.accent:C.card,color:view===v?C.white:C.sub,border:"none",borderRadius:6,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",textTransform:"capitalize"}}>{v}</button>
        ))}
      </div>
      {view==="teams"&&!editTeam&&(
        <div>
          <SLabel>12 Teams — click to edit</SLabel>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {teams.map(t=>(
              <div key={t.id} onClick={()=>setEditTeam({...t,players:t.players.map(p=>({...p}))})} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                <TeamBadge color={t.name?t.color:C.border} crest={t.name?t.crest:null} size={32}/>
                <div><div style={{fontWeight:600,fontSize:14,color:t.name?C.text:C.muted}}>{t.name||`Team ${t.id}`}</div><div style={{fontSize:11,color:C.muted}}>{t.players.length}/8{t.shortName?` · ${t.shortName}`:""}{t.budget?` · £${t.budget}M`:""}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {view==="teams"&&editTeam&&(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
            <button onClick={()=>setEditTeam(null)} style={{background:"none",border:"none",color:C.sub,cursor:"pointer",fontSize:20}}>←</button>
            <span style={{fontWeight:700,fontSize:16,color:C.text}}>{editTeam.name||`Team ${editTeam.id}`}</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>Full Name</div><Inp value={editTeam.name} onChange={v=>setEditTeam({...editTeam,name:v})} placeholder="e.g. City FC"/></div>
            <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>Short (3 letters)</div><Inp value={editTeam.shortName} onChange={v=>setEditTeam({...editTeam,shortName:v.toUpperCase().slice(0,3)})} placeholder="CTY"/></div>
            <div style={{gridColumn:"1/-1"}}><div style={{fontSize:11,color:C.muted,marginBottom:4}}>Transfer Budget (£M)</div><Inp type="number" min="0" value={editTeam.budget??""} placeholder="e.g. 150" onChange={v=>setEditTeam({...editTeam,budget:v===''?0:+v})}/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
            <div>
              <div style={{fontSize:11,color:C.muted,marginBottom:4}}>Team Colour</div>
              <input type="color" value={editTeam.color} onChange={e=>setEditTeam({...editTeam,color:e.target.value})} style={{width:48,height:32,border:"none",background:"none",cursor:"pointer"}}/>
            </div>
            <div>
              <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Team Crest</div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <TeamBadge color={editTeam.color} crest={editTeam.crest} size={40}/>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <label style={{background:C.accent,color:C.white,borderRadius:5,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                    Upload
                    <input type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{const f=e.target.files[0];if(f){const d=await resizeCrest(f);setEditTeam({...editTeam,crest:d});}e.target.value="";}}/>
                  </label>
                  {editTeam.crest&&<button onClick={()=>setEditTeam({...editTeam,crest:null})} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,color:C.muted,padding:"3px 10px",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Remove</button>}
                </div>
              </div>
            </div>
          </div>
          <div style={{marginBottom:20}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Formation</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {FORMATIONS.map(f=><button key={f.id} onClick={()=>setEditTeam({...editTeam,formation:f.id})} style={{background:editTeam.formation===f.id?C.accent:C.card,color:editTeam.formation===f.id?C.white:C.sub,border:`1px solid ${editTeam.formation===f.id?C.accent:C.border}`,borderRadius:6,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{f.label}</button>)}
            </div>
          </div>
          <SLabel>Squad ({editTeam.players.length}/8)</SLabel>
          {editTeam.players.map(p=>(
            <div key={p.id} style={{background:C.surface,borderRadius:8,padding:"12px",marginBottom:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:8,marginBottom:p.position!=="GK"?10:4}}>
                <Inp value={p.name} onChange={v=>updPlayer(editTeam,p.id,"name",v)} placeholder="Player name"/>
                <div style={{width:90}}><Sel value={p.position} onChange={v=>updPlayer(editTeam,p.id,"position",v)} options={POSITIONS.map(pos=>({value:pos,label:pos}))}/></div>
                <button onClick={()=>delPlayer(editTeam,p.id)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:16,padding:"0 4px"}}>✕</button>
              </div>
              {p.position==="GK"&&<div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Not included in ratings</div>}
              {p.position==="DEF"&&<div><div style={{fontSize:10,color:C.muted,marginBottom:4}}>Defense Score (1–10)</div><div style={{display:"flex",alignItems:"center",gap:12}}><input type="range" min="1" max="10" step="1" value={p.score} onChange={e=>updPlayer(editTeam,p.id,"score",+e.target.value)} style={{flex:1,accentColor:C.green}}/><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.green,minWidth:32,textAlign:"center"}}>{p.score}</div></div></div>}
              {p.position==="DEF"&&<div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:10,color:C.muted,flex:1}}>Role</span><button onClick={()=>updPlayer(editTeam,p.id,"wide",!p.wide)} style={{background:p.wide?`${C.accent}22`:"transparent",color:p.wide?C.accent:C.muted,border:`1px solid ${p.wide?C.accent:C.border}`,borderRadius:5,padding:"4px 12px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{p.wide?"Wide Defender":"Central Defender"}</button></div>}
              {p.position==="FWD"&&<div><div style={{fontSize:10,color:C.muted,marginBottom:4}}>Attack Score (1–10)</div><div style={{display:"flex",alignItems:"center",gap:12}}><input type="range" min="1" max="10" step="1" value={p.score} onChange={e=>updPlayer(editTeam,p.id,"score",+e.target.value)} style={{flex:1,accentColor:C.red}}/><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.red,minWidth:32,textAlign:"center"}}>{p.score}</div></div></div>}
              {p.position==="FWD"&&<div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:10,color:C.muted,flex:1}}>Role</span><button onClick={()=>updPlayer(editTeam,p.id,"wide",!p.wide)} style={{background:p.wide?`${C.accent}22`:"transparent",color:p.wide?C.accent:C.muted,border:`1px solid ${p.wide?C.accent:C.border}`,borderRadius:5,padding:"4px 12px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{p.wide?"Wide Forward":"Central Forward"}</button></div>}
              {p.position==="MDF"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div><div style={{fontSize:10,color:C.red,marginBottom:4}}>Attack Score (1–10)</div><div style={{display:"flex",alignItems:"center",gap:10}}><input type="range" min="1" max="10" step="1" value={p.mdfAtkScore} onChange={e=>updPlayer(editTeam,p.id,"mdfAtkScore",+e.target.value)} style={{flex:1,accentColor:C.red}}/><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:C.red,minWidth:28,textAlign:"center"}}>{p.mdfAtkScore}</div></div></div>
                <div><div style={{fontSize:10,color:C.green,marginBottom:4}}>Defense Score (1–10)</div><div style={{display:"flex",alignItems:"center",gap:10}}><input type="range" min="1" max="10" step="1" value={p.mdfDefScore} onChange={e=>updPlayer(editTeam,p.id,"mdfDefScore",+e.target.value)} style={{flex:1,accentColor:C.green}}/><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:C.green,minWidth:28,textAlign:"center"}}>{p.mdfDefScore}</div></div></div>
              </div>}
              {p.position==="MDF"&&<div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:10,color:C.muted,flex:1}}>Alt position</span><div style={{display:"flex",gap:6}}>{["DEF","FWD"].map(alt=>{const active=p.altPosition===alt;return<button key={alt} onClick={()=>updPlayer(editTeam,p.id,"altPosition",active?null:alt)} style={{background:active?`${C.accent}22`:"transparent",color:active?C.accent:C.muted,border:`1px solid ${active?C.accent:C.border}`,borderRadius:5,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{alt}</button>;})}</div></div>}
              <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,color:C.muted,flex:1}}>Status</span>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>updPlayer(editTeam,p.id,"injured",!p.injured)} style={{background:p.injured?`${C.red}33`:"transparent",color:p.injured?C.red:C.muted,border:`1px solid ${p.injured?C.red:C.border}`,borderRadius:5,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Injured</button>
                  <button onClick={()=>updPlayer(editTeam,p.id,"suspended",!p.suspended)} style={{background:p.suspended?`${C.gold}33`:"transparent",color:p.suspended?C.gold:C.muted,border:`1px solid ${p.suspended?C.gold:C.border}`,borderRadius:5,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Suspended</button>
                </div>
              </div>
              <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,color:C.muted,flex:1}}>Roles</span>
                <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"flex-end"}}>
                  {ROLES.map(role=>{const has=(p.roles||[]).includes(role.id);return(
                    <button key={role.id} onClick={()=>toggleRole(editTeam,p.id,role.id)} style={{background:has?role.color+"33":"transparent",color:has?role.color:C.muted,border:`1px solid ${has?role.color:C.border}`,borderRadius:5,padding:"4px 8px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{role.short}</button>
                  );})}
                </div>
              </div>
              <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,color:C.muted,flex:1}}>Age</span>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <input type="range" min="16" max="40" step="1" value={p.age||25} onChange={e=>updPlayer(editTeam,p.id,"age",+e.target.value)} style={{width:100,accentColor:C.accent}}/>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:C.accent,minWidth:28,textAlign:"center"}}>{p.age||25}</div>
                </div>
              </div>
            </div>
          ))}
          <div style={{display:"flex",gap:8,marginTop:4}}>
            {editTeam.players.length<8&&<Btn onClick={()=>addPlayer(editTeam)} variant="secondary">+ Add Player</Btn>}
            <Btn onClick={()=>saveTeam(editTeam)}>Save Team</Btn>
          </div>
        </div>
      )}
      {view==="fixtures"&&!editFix&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <SLabel>All Fixtures</SLabel>
            <div style={{display:"flex",gap:6}}>
              <Btn onClick={genSeason} small variant="success">⚡ Generate Season</Btn>
              <Btn onClick={addFix} small>+ Add Fixture</Btn>
            </div>
          </div>
          {fixtures.length===0&&<div style={{color:C.muted,fontSize:13}}>No fixtures yet.</div>}
          {fixtures.map(f=>{
            const h=teams.find(t=>t.id===f.homeId),a=teams.find(t=>t.id===f.awayId);
            return(
              <div key={f.id} onClick={()=>openFix(f)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:8,cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
                <div style={{flex:1,fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:1,color:C.text}}>{h?.name||"TBD"} <span style={{color:C.muted}}>vs</span> {a?.name||"TBD"}</div>
                <div style={{fontSize:11,color:C.muted}}>{fmtDate(f.date)}</div>
                {f.played&&<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.gold}}>{f.homeScore}–{f.awayScore}</div>}
                <div style={{fontSize:11,color:f.played?C.green:C.muted}}>{f.played?"Played":"Upcoming"}</div>
              </div>
            );
          })}
        </div>
      )}
      {view==="fixtures"&&editFix&&(()=>{
        const hTeam=teams.find(t=>t.id===editFix.homeId),aTeam=teams.find(t=>t.id===editFix.awayId);
        const teamPlayers=team=>(editFix.playerStats||[]).filter(ps=>ps.teamId===team?.id).map(ps=>({...ps,player:team.players.find(p=>p.id===ps.playerId)})).filter(x=>x.player);
        return(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
              <button onClick={()=>setEditFix(null)} style={{background:"none",border:"none",color:C.sub,cursor:"pointer",fontSize:20}}>←</button>
              <span style={{fontWeight:700,fontSize:16,color:C.text}}>Edit Fixture</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>Home Team</div><Sel value={editFix.homeId||""} onChange={v=>{const nf={...editFix,homeId:+v};setEditFix({...nf,playerStats:initFixStats(nf,teams)});}} options={[{value:"",label:"Select..."},...named.map(t=>({value:t.id,label:t.name}))]}/></div>
              <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>Away Team</div><Sel value={editFix.awayId||""} onChange={v=>{const nf={...editFix,awayId:+v};setEditFix({...nf,playerStats:initFixStats(nf,teams)});}} options={[{value:"",label:"Select..."},...named.map(t=>({value:t.id,label:t.name}))]}/></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>Date</div><Inp type="date" value={editFix.date} onChange={v=>setEditFix({...editFix,date:v})}/></div>
              <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>Match Week</div><Inp type="number" min="1" value={editFix.matchWeek??""} placeholder="—" onChange={v=>setEditFix({...editFix,matchWeek:v===''?null:+v})}/></div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
              <input type="checkbox" id="played" checked={!!editFix.played} onChange={e=>setEditFix({...editFix,played:e.target.checked})} style={{accentColor:C.accent,width:16,height:16}}/>
              <label htmlFor="played" style={{color:C.sub,fontSize:13,cursor:"pointer"}}>Mark as played</label>
            </div>
            {editFix.played&&<div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
                <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>Home Score</div><Inp type="number" min="0" value={editFix.homeScore??""} onChange={v=>setEditFix({...editFix,homeScore:+v})}/></div>
                <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>Away Score</div><Inp type="number" min="0" value={editFix.awayScore??""} onChange={v=>setEditFix({...editFix,awayScore:+v})}/></div>
              </div>
              {[hTeam,aTeam].filter(Boolean).map(team=>(
                <div key={team.id} style={{marginBottom:24}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}><TeamBadge color={team.color} crest={team.crest} size={20}/><span style={{fontWeight:700,fontSize:14,color:C.text}}>{team.name}</span></div>
                  {teamPlayers(team).map(({player,playerId,...ps})=>(
                    <div key={playerId} style={{background:C.surface,borderRadius:8,padding:"12px",marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                        <span style={{background:posColor(player.position)+"22",color:posColor(player.position),borderRadius:4,padding:"2px 6px",fontSize:10,fontWeight:700}}>{player.position}</span>
                        <span style={{fontSize:13,fontWeight:600,color:C.text,flex:1}}>{player.name||"Unnamed"}</span>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:16,alignItems:"flex-start"}}>
                        <NumStepper label="Goals" value={ps.goals||0} onChange={v=>updFixStat(editFix,playerId,"goals",v)} color={C.gold}/>
                        <NumStepper label="Pen Goals" value={ps.penGoals||0} max={ps.goals||0} onChange={v=>updFixStat(editFix,playerId,"penGoals",Math.min(v,ps.goals||0))} color={C.accent}/>
                        <NumStepper label="Assists" value={ps.assists||0} onChange={v=>updFixStat(editFix,playerId,"assists",v)} color={C.green}/>
                        <NumStepper label="Yellows" value={ps.yellowCards||0} max={2} onChange={v=>updFixStat(editFix,playerId,"yellowCards",v)} color={C.gold}/>
                        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                          <div style={{fontSize:9,color:C.muted,letterSpacing:1,textTransform:"uppercase"}}>Red</div>
                          <button onClick={()=>updFixStat(editFix,playerId,"redCard",!ps.redCard)} style={{width:34,height:34,borderRadius:5,border:`1px solid ${ps.redCard?C.red:C.border}`,background:ps.redCard?`${C.red}33`:"transparent",color:ps.redCard?C.red:C.muted,cursor:"pointer",fontSize:16}}>🟥</button>
                        </div>
                        {player.position==="GK"&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                          <div style={{fontSize:9,color:C.muted,letterSpacing:1,textTransform:"uppercase"}}>Clean Sheet</div>
                          <button onClick={()=>updFixStat(editFix,playerId,"cleanSheet",!ps.cleanSheet)} style={{width:34,height:34,borderRadius:5,border:`1px solid ${ps.cleanSheet?C.green:C.border}`,background:ps.cleanSheet?`${C.green}33`:"transparent",color:ps.cleanSheet?C.green:C.muted,cursor:"pointer",fontSize:16}}>🧤</button>
                        </div>}
                        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                          <div style={{fontSize:9,color:C.muted,letterSpacing:1,textTransform:"uppercase"}}>Rating</div>
                          <div style={{display:"flex",alignItems:"center",gap:4}}>
                            <button onClick={()=>updFixStat(editFix,playerId,"rating",Math.max(0,+(ps.rating||0)-0.5))} style={{width:22,height:22,borderRadius:4,border:`1px solid ${C.border}`,background:C.surface,color:C.sub,cursor:"pointer",fontSize:14,lineHeight:1,fontFamily:"'DM Sans',sans-serif"}}>−</button>
                            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:C.purple,minWidth:32,textAlign:"center"}}>{ps.rating||"—"}</span>
                            <button onClick={()=>updFixStat(editFix,playerId,"rating",Math.min(10,+(ps.rating||0)+0.5))} style={{width:22,height:22,borderRadius:4,border:`1px solid ${C.border}`,background:C.surface,color:C.sub,cursor:"pointer",fontSize:14,lineHeight:1,fontFamily:"'DM Sans',sans-serif"}}>+</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {teamPlayers(team).length===0&&<div style={{color:C.muted,fontSize:12,fontStyle:"italic"}}>No players yet.</div>}
                </div>
              ))}
            </div>}
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <Btn onClick={()=>saveFix(editFix)}>Save Fixture</Btn>
              <Btn onClick={()=>delFix(editFix.id)} variant="danger">Delete</Btn>
            </div>
          </div>
        );
      })()}
      {view==="transfers"&&(
        <div>
          <SLabel>Make a Trade</SLabel>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"16px"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Team A</div>
                <Sel value={tradeTeamA||""} onChange={v=>{setTradeTeamA(+v||null);setTradePlayerA(null);}} options={[{value:"",label:"Select team..."},...named.map(t=>({value:t.id,label:t.name}))]}/>
              </div>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Team B</div>
                <Sel value={tradeTeamB||""} onChange={v=>{setTradeTeamB(+v||null);setTradePlayerB(null);}} options={[{value:"",label:"Select team..."},...named.filter(t=>t.id!==tradeTeamA).map(t=>({value:t.id,label:t.name}))]}/>
              </div>
            </div>
            {teamA&&<div style={{marginBottom:12}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Player leaving {teamA.name}</div>
              <Sel value={tradePlayerA||""} onChange={v=>setTradePlayerA(+v||null)} options={[{value:"",label:"Select player..."},...(teamA.players||[]).map(p=>({value:p.id,label:`${p.name} (${p.position})`}))]}/>
            </div>}
            {teamB&&<div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Player leaving {teamB.name}</div>
              <Sel value={tradePlayerB||""} onChange={v=>setTradePlayerB(+v||null)} options={[{value:"",label:"Select player..."},...(teamB.players||[]).map(p=>({value:p.id,label:`${p.name} (${p.position})`}))]}/>
            </div>}
            {playerA&&playerB&&(
              <div>
                <div style={{background:C.surface,borderRadius:8,padding:"12px",marginBottom:12}}>
                  <div style={{fontSize:10,color:C.muted,marginBottom:8,letterSpacing:1,textTransform:"uppercase"}}>Trade Preview</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:8}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:700,color:C.text}}>{playerA.name}</div>
                      <div style={{fontSize:10,color:C.muted}}>{playerA.position} → {teamB.name}</div>
                    </div>
                    <span style={{color:C.muted,fontSize:18}}>⇄</span>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.text}}>{playerB.name}</div>
                      <div style={{fontSize:10,color:C.muted}}>{playerB.position} → {teamA.name}</div>
                    </div>
                  </div>
                </div>
                <Btn onClick={executeTrade} variant="success">✓ Execute Trade</Btn>
              </div>
            )}
            {!teamA&&!teamB&&<div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>Select two teams and one player from each to make a trade.</div>}
          </div>
          {transfers.length>0&&(
            <div style={{marginTop:24}}>
              <SLabel>Recent Trades</SLabel>
              {[...transfers].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(t=>(
                <div key={t.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",marginBottom:8,display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:8}}>
                  <div><div style={{fontSize:12,fontWeight:700,color:C.text}}>{t.playerOut.name}</div><div style={{fontSize:10,color:C.muted}}>{t.fromTeamName} → {t.toTeamName}</div></div>
                  <span style={{color:C.muted,fontSize:16}}>⇄</span>
                  <div style={{textAlign:"right"}}><div style={{fontSize:12,fontWeight:700,color:C.text}}>{t.playerIn.name}</div><div style={{fontSize:10,color:C.muted}}>{t.date}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {view==="season"&&(()=>{
        const maxMW=fixtures.reduce((m,f)=>f.matchWeek?Math.max(m,f.matchWeek):m,1);
        const mwFixtures=fixtures.filter(f=>f.matchWeek===activeMatchWeek);
        const played=mwFixtures.filter(f=>f.played).length;
        const total=mwFixtures.length;
        const canAdvance=activeMatchWeek<maxMW;
        const advanceTo=activeMatchWeek+1;
        return(
          <div>
            <SLabel>Current Match Week</SLabel>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"20px",marginBottom:20,textAlign:"center"}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:56,color:C.accent,lineHeight:1}}>{activeMatchWeek}</div>
              <div style={{fontSize:11,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginTop:4}}>Match Week</div>
              {total>0&&<div style={{fontSize:12,color:C.sub,marginTop:10}}>{played}/{total} results entered this week</div>}
              {played<total&&total>0&&<div style={{fontSize:11,color:C.gold,marginTop:4}}>{total-played} game{total-played!==1?'s':''} still to be played</div>}
            </div>
            {canAdvance?(
              <div>
                <div style={{fontSize:12,color:C.sub,marginBottom:14,lineHeight:1.5}}>Advancing locks in new predicted lineups, refreshes the News feed, and updates Odds for Match Week {advanceTo}. You can still enter results from the current week after advancing.</div>
                <Btn onClick={()=>{setActiveMatchWeek(advanceTo);syncMeta(advanceTo);onToast(`Advanced to Match Week ${advanceTo}`);}} variant="success">Advance to Match Week {advanceTo} →</Btn>
              </div>
            ):(
              <div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>You are on the final match week of the season.</div>
            )}
            {activeMatchWeek>1&&(
              <div style={{marginTop:16}}>
                <button onClick={()=>{const p=activeMatchWeek-1;setActiveMatchWeek(p);syncMeta(p);onToast(`Moved back to Match Week ${p}`);}} style={{background:"none",border:"none",color:C.muted,fontSize:11,cursor:"pointer",padding:0,fontFamily:"'DM Sans',sans-serif",textDecoration:"underline"}}>← Go back to Match Week {activeMatchWeek-1}</button>
              </div>
            )}
          </div>
        );
      })()}
      {!editTeam&&!editFix&&view!=="transfers"&&view!=="season"&&(
        <div style={{marginTop:32,borderTop:`1px solid ${C.border}`,paddingTop:20}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Backup or restore your data as a JSON file.</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Btn onClick={onExport} variant="export">📤 Export</Btn>
            <Btn onClick={()=>importRef.current.click()} variant="secondary">📥 Import</Btn>
            <input ref={importRef} type="file" accept=".json" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f){const r=new FileReader();r.onload=ev=>onImport(ev.target.result);r.readAsText(f);}e.target.value="";}}/>
          </div>
        </div>
      )}
    </div>
  );
}

function generateArticles(teams,fixtures,transfers,activeMW){
  const articles=[];
  const named=teams.filter(t=>t.name);
  if(named.length===0)return[];
  const pick=(arr,seed)=>arr[Math.abs(seed)%arr.length];
  const prevMW=activeMW>1?activeMW-1:null;
  // stats scoped to games played before the active MW
  const playedSoFar=fixtures.filter(f=>f.played&&(f.matchWeek==null||f.matchWeek<activeMW));
  const pStats=computePlayerStats(teams,playedSoFar);
  const table=computeTable(teams,playedSoFar);

  // transfers
  [...transfers].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4).forEach(t=>{
    const seed=t.playerOut.name.length*7+t.playerIn.name.length*3;
    articles.push({
      tag:'Transfer',color:C.accent,
      headline:pick([
        `${t.playerOut.name} completes switch to ${t.toTeamName} in swap deal`,
        `Done deal: ${t.toTeamName} land ${t.playerOut.name} as ${t.playerIn.name} heads the other way`,
        `Swap confirmed — ${t.playerOut.name} and ${t.playerIn.name} change clubs`,
      ],seed),
      body:pick([
        `${t.fromTeamName} and ${t.toTeamName} have wrapped up a straight swap: ${t.playerOut.name} (${t.playerOut.position}) moves to ${t.toTeamName} with ${t.playerIn.name} (${t.playerIn.position}) heading in the opposite direction. Both managers spoke positively about the deal and the players are expected to feature immediately.`,
        `In a surprise move, ${t.playerOut.name} has departed ${t.fromTeamName} for ${t.toTeamName} in exchange for ${t.playerIn.name}. Confirmed on ${t.date}, the swap gives both clubs fresh options heading into the coming match weeks. Scouts on both sides had been monitoring the situation for some time.`,
      ],seed+1),
      date:t.date,priority:1,
    });
  });

  // match reports — only previous MW (the one just completed)
  [...fixtures.filter(f=>f.played&&f.homeId&&f.awayId&&(prevMW==null||f.matchWeek===prevMW))]
    .sort((a,b)=>(b.matchWeek||0)-(a.matchWeek||0)||(b.date||'').localeCompare(a.date||''))
    .slice(0,6).forEach(f=>{
      const home=named.find(t=>t.id===f.homeId),away=named.find(t=>t.id===f.awayId);
      if(!home||!away)return;
      const hWin=f.homeScore>f.awayScore,draw=f.homeScore===f.awayScore;
      const winner=hWin?home:away,loser=hWin?away:home;
      const ws=hWin?f.homeScore:f.awayScore,ls=hWin?f.awayScore:f.homeScore;
      const mw=f.matchWeek?` in Match Week ${f.matchWeek}`:'';
      const topPs=(f.playerStats||[]).filter(ps=>(ps.goals||0)>0).sort((a,b)=>b.goals-a.goals)[0];
      const scorerName=topPs?pStats.find(p=>p.playerId===topPs.playerId)?.name:null;
      const motmPs=(f.playerStats||[]).filter(ps=>(ps.rating||0)>0).sort((a,b)=>b.rating-a.rating)[0];
      const motmName=motmPs?pStats.find(p=>p.playerId===motmPs.playerId)?.name:null;
      let headline,body;
      if(draw){
        headline=`${home.name} and ${away.name} share the spoils — ${f.homeScore}-${f.awayScore}`;
        body=`Neither side could find a winner as ${home.name} and ${away.name} played out a ${f.homeScore}-all draw${mw}. A point each, though both camps will feel they could have done more to claim all three.`;
      } else if(ws-ls>=3){
        headline=`${winner.name} run riot — ${ws}-${ls} demolition job on ${loser.name}`;
        body=`${winner.name} were simply unstoppable, tearing ${loser.name} apart with a blistering ${ws}-${ls} victory${mw}. It was as one-sided as the scoreline suggests, sending a clear statement of intent to the rest of the league.`;
      } else if(ws-ls===2){
        headline=`${winner.name} see off ${loser.name} with comfortable ${ws}-${ls} win`;
        body=`${winner.name} were rarely troubled, easing to a ${ws}-${ls} success against ${loser.name}${mw}. They never looked like surrendering their advantage once ahead and will be pleased with another three points in the bank.`;
      } else {
        headline=`${winner.name} nick it ${ws}-${ls} in a thriller against ${loser.name}`;
        body=`${winner.name} claimed a hard-fought ${ws}-${ls} win over a tenacious ${loser.name}${mw}. It was far from pretty but they got the job done when it mattered most.`;
      }
      if(scorerName)body+=` ${scorerName} got on the scoresheet for the winners.`;
      if(motmName&&(motmPs?.rating||0)>=8)body+=` ${motmName} was the standout performer, earning a ${motmPs.rating} match rating.`;
      articles.push({tag:'Match Report',color:C.gold,headline,body,date:f.date||`MW${f.matchWeek}`,priority:2});
    });

  // fixture previews — active MW only
  if(activeMW){
    fixtures.filter(f=>f.matchWeek===activeMW&&!f.played&&f.homeId&&f.awayId).slice(0,4).forEach(f=>{
      const home=named.find(t=>t.id===f.homeId),away=named.find(t=>t.id===f.awayId);
      if(!home||!away)return;
      const o=calcOdds(home,away);
      const pred=predictMatch(home,away);
      const fav=o.pHome>o.pAway?home:away,dog=o.pHome>o.pAway?away:home;
      const favP=Math.max(o.pHome,o.pAway);
      const seed=f.homeId*31+f.awayId;
      let headline,body;
      if(favP>=70){
        headline=pick([`${fav.name} overwhelming favorites — can ${dog.name} defy the odds?`,`${dog.name} face a mountain to climb against in-form ${fav.name}`],seed);
        body=`${fav.name} head into Match Week ${activeMW} as firm favorites with a ${favP}% win probability. Analysts are predicting a ${pred.hGoals}-${pred.aGoals} scoreline and it is hard to argue with the models. ${dog.name} will need a performance of their lives to come away with anything.`;
      } else if(favP>=57){
        headline=pick([`${fav.name} slight edge over ${dog.name} in Match Week ${activeMW} clash`,`${home.name} vs ${away.name}: Fine margins expected`],seed);
        body=`${fav.name} are marginally favored (${favP}%) going into their Match Week ${activeMW} showdown with ${dog.name}. A ${pred.hGoals}-${pred.aGoals} scoreline is projected but this is far from a foregone conclusion. ${dog.name} are capable of causing problems and could easily steal a result.`;
      } else {
        headline=`${home.name} vs ${away.name} — the most unpredictable fixture of Match Week ${activeMW}`;
        body=`The bookmakers can barely separate ${home.name} and ${away.name} ahead of their Match Week ${activeMW} meeting. With win probabilities almost neck and neck, this could be the most enthralling game of the round. Neutrals will want to watch this one.`;
      }
      articles.push({tag:'Preview',color:C.purple,headline,body,date:`Match Week ${activeMW}`,priority:3});
    });
  }

  // form guide
  const formTeams=table.filter(r=>r.form.length>=3);
  if(formTeams.length>0){
    const pts3=f=>f.slice(-3).filter(r=>r==='W').length*3+f.slice(-3).filter(r=>r==='D').length;
    const hot=[...formTeams].sort((a,b)=>pts3(b.form)-pts3(a.form))[0];
    const cold=[...formTeams].sort((a,b)=>b.form.slice(-3).filter(r=>r==='L').length-a.form.slice(-3).filter(r=>r==='L').length)[0];
    const hotW=hot.form.slice(-3).filter(r=>r==='W').length;
    if(hotW>=2)articles.push({tag:'Form Guide',color:'#f97316',headline:`${hot.name} in red-hot form — ${hotW} wins from last 3`,body:`${hot.name} are the in-form side in the division right now, picking up ${hotW} wins from their last three outings. Confidence is sky-high and they look like a team that knows exactly how to win. Opponents will be dreading their next encounter with them.`,date:'Form Guide',priority:3});
    const coldL=cold?.form.slice(-3).filter(r=>r==='L').length||0;
    if(cold&&coldL>=2&&cold.name!==hot.name)articles.push({tag:'Form Guide',color:C.muted,headline:`${cold.name} in freefall — ${coldL} defeats from last 3`,body:`Alarm bells are ringing at ${cold.name} after a run of ${coldL} losses in their last three matches. Something needs to change quickly and the manager will be under pressure to find answers. With more difficult fixtures on the horizon, this slump could get worse before it gets better.`,date:'Form Guide',priority:3});
  }

  // table leader
  if(table.length>0&&table[0].p>0){
    const lead=table[0],sec=table[1];
    const gap=lead.pts-(sec?.pts||0);
    articles.push({tag:'Table Update',color:C.gold,headline:`${lead.name} sitting pretty at the top — ${gap} point${gap!==1?'s':''} clear`,body:`${lead.name} lead the pack on ${lead.pts} point${lead.pts!==1?'s':''} from ${lead.p} game${lead.p!==1?'s':''}${gap>=3&&sec?`, with ${sec.name} trailing by ${gap}.`:`.`} Their goal difference of ${lead.gf-lead.ga>0?'+':''}${lead.gf-lead.ga} tells the story of a team firing on all cylinders. The title is there to lose if they maintain this form.`,date:'Standings',priority:4});
  }

  // golden boot
  const scorers=pStats.filter(p=>p.goals>0).sort((a,b)=>b.goals-a.goals);
  if(scorers.length>0){
    const top=scorers[0],sec=scorers[1];
    let body=`${top.name} (${top.teamName}) leads the golden boot race with ${top.goals} goal${top.goals!==1?'s':''} from ${top.apps} app${top.apps!==1?'s':''}.`;
    if(sec&&sec.goals===top.goals)body+=` ${sec.name} (${sec.teamName}) is level, making it a straight shoot-out for the award.`;
    else if(sec&&top.goals-sec.goals===1)body+=` ${sec.name} (${sec.teamName}) is just one behind and breathing down their neck.`;
    else if(sec)body+=` ${sec.name} (${sec.teamName}) is the nearest challenger on ${sec.goals}. The race is on.`;
    articles.push({tag:'Golden Boot',color:C.red,headline:`${top.name} leads the race for golden boot with ${top.goals} goal${top.goals!==1?'s':''}`,body,date:'Season Stats',priority:4});
  }

  // player of the season (avg rating)
  const ratedP=pStats.filter(p=>p.ratings.length>=2).sort((a,b)=>parseFloat(b.avgRating)-parseFloat(a.avgRating));
  if(ratedP.length>0){
    const star=ratedP[0];
    articles.push({tag:'Player Watch',color:C.purple,headline:`${star.name} is the league's standout performer — avg rating ${star.avgRating}`,body:`No player has been more consistent than ${star.name} (${star.teamName}), who boasts an average match rating of ${star.avgRating} from ${star.ratings.length} appearance${star.ratings.length!==1?'s':''}. The ${star.position} is the first name on the teamsheet every week and opposing managers spend hours trying to work out how to stop them.`,date:'Season Stats',priority:4});
  }

  // clean sheet king
  const gks=pStats.filter(p=>p.cleanSheets>0&&p.position==='GK').sort((a,b)=>b.cleanSheets-a.cleanSheets);
  if(gks.length>0){
    const gk=gks[0];
    articles.push({tag:'Goalkeeper Watch',color:C.green,headline:`${gk.name} is the wall — ${gk.cleanSheets} clean sheet${gk.cleanSheets!==1?'s':''} and counting`,body:`${gk.name} (${gk.teamName}) has been in exceptional form between the sticks this season, keeping ${gk.cleanSheets} clean sheet${gk.cleanSheets!==1?'s':''} in ${gk.apps} appearance${gk.apps!==1?'s':''}. Strikers have been left bamboozled all campaign and ${gk.teamName}'s defensive record owes much to their outstanding shot-stopper.`,date:'Season Stats',priority:4});
  }

  // power rankings
  const ratingsList=named.map(t=>({t,...lineupRatings(t)})).filter(r=>r.atk>0||r.def>0);
  if(ratingsList.length>=2){
    const byAtk=[...ratingsList].sort((a,b)=>b.atk-a.atk);
    const byDef=[...ratingsList].sort((a,b)=>b.def-a.def);
    const topA=byAtk[0],topD=byDef[0];
    articles.push({tag:'Power Rankings',color:C.green,headline:`${topA.t.name} rated the most dangerous side in the league`,body:`${topA.t.name} hold an attack rating of ${topA.atk} — higher than any other club. On the flip side, ${topD.t.name} are the toughest team to score against, carrying a defensive rating of ${topD.def}. A future meeting between these two promises to be the tactical chess match of the season.`,date:'Power Rankings',priority:5});
    const weakest=[...ratingsList].sort((a,b)=>(a.atk+a.def)-(b.atk+b.def))[0];
    if(weakest.t.id!==topA.t.id){
      articles.push({tag:'Analysis',color:C.muted,headline:`${weakest.t.name} propped up in the ratings — but can they defy expectations?`,body:`On paper, ${weakest.t.name} have the lowest combined rating in the division (ATK ${weakest.atk}, DEF ${weakest.def}). The numbers don't lie, but football is played on the pitch, not on spreadsheets. Every dog has its day — could this be theirs?`,date:'Analysis',priority:5});
    }
    // odds spotlight
    let bigMatch=null,bigProb=0;
    fixtures.filter(f=>!f.played&&f.homeId&&f.awayId&&f.matchWeek===activeMW).forEach(f=>{
      const h=named.find(t=>t.id===f.homeId),a=named.find(t=>t.id===f.awayId);
      if(!h||!a)return;
      const o=calcOdds(h,a);
      const p=Math.max(o.pHome,o.pAway);
      if(p>bigProb){bigProb=p;bigMatch={f,h,a,o};}
    });
    if(bigMatch&&bigProb>=65){
      const{f,h,a,o}=bigMatch;
      const fav=o.pHome>o.pAway?h:a,dog=o.pHome>o.pAway?a:h;
      const favOdds=o.pHome>o.pAway?o.home:o.away;
      articles.push({tag:'Betting',color:'#10b981',headline:`${fav.name} the banker bet — ${favOdds} odds-on against ${dog.name}`,body:`Punters are flooding in on ${fav.name} to win${f.matchWeek?` in Match Week ${f.matchWeek}`:''}. With a ${bigProb}% win probability and odds of just ${favOdds}, they are the standout selection on the card. Anyone brave enough to back ${dog.name} at this price deserves enormous credit if they pull it off.`,date:f.matchWeek?`Match Week ${f.matchWeek}`:'Upcoming',priority:3});
    }
  }

  // pundit debate — find contested positions where a team has more players than formation slots
  const PUNDITS=['Gary','Micah','Roy','Jamie','Ian','Robbie','Steve','Lee'];
  const debateCands=[];
  named.filter(t=>t.players.length>0).forEach(team=>{
    const formation=FORMATIONS.find(f=>f.id===team.formation)||FORMATIONS[0];
    ['DEF','MDF','FWD'].forEach(pos=>{
      const slots=pos==='DEF'?formation.def:pos==='MDF'?formation.mdf:formation.fwd;
      if(slots===0)return;
      const pp=team.players.filter(p=>p.position===pos&&p.name&&!p.injured).sort((a,b)=>{
        const va=pos==='MDF'?(a.mdfAtkScore+a.mdfDefScore)/2:(a.score||5);
        const vb=pos==='MDF'?(b.mdfAtkScore+b.mdfDefScore)/2:(b.score||5);
        return vb-va;
      });
      if(pp.length>slots&&pp[slots-1]?.name&&pp[slots]?.name)debateCands.push({team,starter:pp[slots-1],benched:pp[slots],pos,slots});
    });
  });
  debateCands.slice(0,2).forEach(({team,starter,benched,pos})=>{
    const seed=((starter.name.length*7)+(benched.name.length*3)+(team.name.length))%1000;
    const dp1=PUNDITS[seed%PUNDITS.length],dp2=PUNDITS[(seed+3)%PUNDITS.length];
    const posLabel=pos==='FWD'?'forward spot':pos==='DEF'?'defensive berth':'midfield role';
    const proB=[
      `I have been saying this all season and nobody wants to hear it. ${benched.name} is the better option in that ${posLabel} right now — it is not even a debate when you actually watch the games closely.`,
      `Look, I like ${starter.name} as a footballer. Good player. But ${benched.name} is the one who can actually unlock something for ${team.name} right now. The manager has to be brave enough to make the call.`,
      `If ${benched.name} was at a bigger club, this would not even be a conversation — they would walk into that side. The talent is right there. Somebody needs to start using it.`,
      `Every week I watch ${team.name} and I keep thinking the same thing. That ${posLabel} has the wrong player in it. ${benched.name} changes games. ${starter.name} just fills a shirt.`,
    ];
    const proS=[
      `Oh come on. ${starter.name} has been doing exactly what was asked of them week in, week out. You do not pull someone from that ${posLabel} just because there is competition knocking — that is how you destroy squad confidence.`,
      `This narrative comes around every few weeks and it is always the same. Someone impresses in training and suddenly the manager is under pressure. ${starter.name} is there on merit. Full stop.`,
      `I have a lot of respect for ${benched.name} — talented player, no question. But ${starter.name} has the trust of the dressing room and you simply cannot put a number on that. Change for the sake of it never ends well.`,
      `${team.name} are getting results. Why would you change it? Football is not about who looks good in the warm-up. ${starter.name} delivers when it matters and that is what counts at the end of the season.`,
    ];
    articles.push({
      tag:'Pundit Debate',color:'#f97316',
      headline:`${dp1} vs ${dp2}: Should ${team.name} start ${benched.name} ahead of ${starter.name}?`,
      body:`A genuine selection headache for the ${team.name} manager.`,
      date:`Match Week ${activeMW}`,priority:3,
      debate:{sides:[
        {pundit:dp1,backs:benched.name,quote:proB[seed%proB.length]},
        {pundit:dp2,backs:starter.name,quote:proS[(seed+1)%proS.length]},
      ]},
    });
  });

  return articles.sort((a,b)=>a.priority-b.priority);
}

const MANAGE_PASSWORD='BMLSeditor';

function ManagePasswordModal({onSuccess,onCancel}){
  const[pw,setPw]=useState('');
  const[err,setErr]=useState(false);
  const submit=()=>{
    if(pw===MANAGE_PASSWORD){onSuccess();}
    else{setErr(true);setPw('');}
  };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:24}} onClick={onCancel}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,width:"100%",maxWidth:340,padding:28}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:1,color:C.white,marginBottom:6}}>Manage</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:20}}>Enter the password to access league settings.</div>
        <input
          autoFocus
          type="password"
          value={pw}
          onChange={e=>{setPw(e.target.value);setErr(false);}}
          onKeyDown={e=>e.key==='Enter'&&submit()}
          placeholder="Password"
          style={{width:"100%",background:C.surface,border:`1px solid ${err?C.red:C.border}`,borderRadius:8,padding:"10px 14px",fontSize:14,color:C.text,outline:"none",fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",marginBottom:err?6:16}}
        />
        {err&&<div style={{fontSize:11,color:C.red,marginBottom:12}}>Incorrect password. Try again.</div>}
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={submit} variant="primary">Unlock</Btn>
          <Btn onClick={onCancel} variant="secondary">Cancel</Btn>
        </div>
      </div>
    </div>
  );
}

function generateSocial(a){
  const seed=a.headline.split('').reduce((s,c,i)=>s+(c.charCodeAt(0)*(i+1)),0);
  const rng=n=>((seed*1013+n*1009)>>>0)%100;
  const likes=6+rng(1)%55+rng(2)%35;
  const FANS=['Dave','BigLeagueFan','FootyMad','TacticsGuy','MatchdayMike','TopBin99','TheTactician','LeagueWatcher','PressBoxPaul','TheGaffer','Linesman77','SilverStreet','Benchwatcher','Ultras99'];
  const fanIdx=n=>(seed+n*7)%FANS.length;
  const fan=n=>FANS[fanIdx(n)];
  const fanDiff=(n,exclude)=>{const idx=fanIdx(n);return FANS[idx===exclude?(idx+1)%FANS.length:idx];};
  const POOLS={
    'Transfer':['Wild one this 👀 never saw it coming','Both clubs got something here I reckon 🤝','Big move — will be interesting to see how it pans out 👏','Came out of nowhere that one 😳','Risky move if you ask me 🤔','Good business for both sides tbh ✅'],
    'Match Report':['Fully deserved that result 💪','Could have been even more goals honestly 🔥','That performance was embarrassing 😬 need to do better','Manager needs to explain that one 😤','Gritty win but three points is three points 🙌','Did not see that coming at all 😂'],
    'Preview':["Can't wait for this one 🍿","Going to be a tight one ⚔️","Home side has it easy here imo 😅","No idea who wins this, genuine coin flip 🪙","One to watch for sure 👁️","Both teams will go for it 🔥"],
    'Pundit Debate':["These two argue about everything lol 😂","Second one has a point to be fair 🤷","Both completely wrong as usual 💀","Classic pundit nonsense right here 🙄","This debate happens every single week 😴","I actually agree with the first take here ✅"],
    'Form Guide':['You love to see it 🔥','That run is alarming, something has to change 📉','Had a feeling they were coming good 😤',"Won't last, they always drop off eventually 💀"],
    'Table Update':['Top of the league, get in! 🏆','Long way to go yet, anything can happen 👀','Deserved every single point 💪','Just wait till the big games come around 😏'],
    'Golden Boot':['Lethal. Pure quality this season 🎯','What a campaign they are having 🔥','Nobody is stopping that run 😤','Dark horse for the award if you ask me 👀'],
    'Player Watch':['Best player in the league, no debate 🐐','Consistent as they come, week in week out 💎','Cannot argue with those numbers at all 📊','Absolute class, simple as ✨'],
    'Goalkeeper Watch':['Wall. An absolute wall. 🧱','GK of the season already and it is not close 🧤','Clean sheets win leagues, simple as that 🔒','Unbelievable this season, nothing gets past them 😤'],
    'Power Rankings':['These seem about right to me 📊','Would argue with one or two of these 🤔','Top team by a mile honestly 🏆','Interesting to see how this changes week to week 👀'],
    'Betting':['Banker of the week for me that 💰','Never back an odds-on favourite 😅','Easy money if you believe the model 🤑','Risky at that price though 👀'],
    'Analysis':['Fair analysis this 📊','Stats never lie in the end 💯','Would disagree with parts but fair enough 🤷'],
  };
  const pool=POOLS[a.tag]||['Interesting one this 👀','Good read 📖','Fair enough 🤷','Thoughts? 💬'];
  const REPLIES=['Exactly this 💯','Disagree completely 😭','You might actually have a point 🤔','Bit harsh that 😅','Fair play 👏','Facts though 🎯','100% agree ✅','Nah come on 😂','This is what I said 🙌','Could not have put it better 👆'];
  const n=2+(rng(3)<50?1:0);
  const comments=[];
  for(let i=0;i<n;i++){
    const minsAgo=rng(i*7+4)*20+8;
    const authorIdx=fanIdx(i*3);
    comments.push({
      id:String(i),name:FANS[authorIdx],
      text:pool[(seed+i*13)%pool.length],
      time:new Date(Date.now()-minsAgo*60000).toISOString(),
      reply:rng(i*11+5)<45?{name:fanDiff(i*5+2,authorIdx),text:REPLIES[rng(i*9+1)%REPLIES.length],time:new Date(Date.now()-(minsAgo-4)*60000).toISOString()}:null,
    });
  }
  return{likes,comments};
}

function NewsTab({teams,fixtures,transfers,activeMatchWeek}){
  const articles=useMemo(()=>generateArticles(teams,fixtures,transfers,activeMatchWeek),[teams,fixtures,transfers,activeMatchWeek]);
  const social=useMemo(()=>articles.map(generateSocial),[articles]);
  const[likedSet,setLikedSet]=useState(()=>new Set());
  const[expanded,setExpanded]=useState(()=>new Set());
  const tagBg=color=>color+'22';
  if(articles.length===0)return<Empty icon="📰" msg="No news yet." hint="Add teams, fixtures and results to generate articles."/>;
  return(
    <div>
      <SLabel>Latest News</SLabel>
      {articles.map((a,i)=>{
        const{likes,comments}=social[i];
        const liked=likedSet.has(i);
        const displayLikes=likes+(liked?1:0);
        const isExpanded=expanded.has(i);
        return(
          <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,marginBottom:12,borderLeft:`3px solid ${a.color}`,overflow:"hidden"}}>
            <div style={{padding:"16px 16px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{background:tagBg(a.color),color:a.color,borderRadius:4,padding:"3px 8px",fontSize:10,fontWeight:700,letterSpacing:.5,textTransform:"uppercase"}}>{a.tag}</span>
                <span style={{fontSize:10,color:C.muted}}>{a.date}</span>
              </div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:19,lineHeight:1.15,color:C.white,letterSpacing:.5,marginBottom:8}}>{a.headline}</div>
              {a.debate?(
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {a.debate.sides.map((s,si)=>(
                    <div key={si} style={{background:C.surface,borderRadius:8,padding:"10px 12px",borderLeft:`2px solid ${si===0?'#f97316':'#6366f1'}`}}>
                      <div style={{fontSize:10,fontWeight:700,color:si===0?'#f97316':'#6366f1',letterSpacing:.5,textTransform:"uppercase",marginBottom:4}}>{s.pundit} <span style={{color:C.muted,fontWeight:400,textTransform:"none",fontSize:10}}>backs {s.backs}</span></div>
                      <div style={{fontSize:12,color:C.sub,lineHeight:1.6,fontStyle:"italic"}}>"{s.quote}"</div>
                    </div>
                  ))}
                </div>
              ):(
                <div style={{fontSize:12,color:C.sub,lineHeight:1.6}}>{a.body}</div>
              )}
            </div>
            <div style={{padding:"8px 16px",borderTop:`1px solid ${C.border}22`,display:"flex",alignItems:"center",gap:14}}>
              <button onClick={()=>setLikedSet(prev=>{const s=new Set(prev);s.has(i)?s.delete(i):s.add(i);return s;})} style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:4,padding:0,color:liked?C.red:C.muted,fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600}}>
                <span style={{fontSize:14}}>{liked?'❤️':'🤍'}</span><span>{displayLikes}</span>
              </button>
              <button onClick={()=>setExpanded(prev=>{const s=new Set(prev);s.has(i)?s.delete(i):s.add(i);return s;})} style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:4,padding:0,color:C.muted,fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600}}>
                <span style={{fontSize:13}}>💬</span><span>{comments.length} comment{comments.length!==1?'s':''}</span>
              </button>
            </div>
            {isExpanded&&(
              <div style={{borderTop:`1px solid ${C.border}`,padding:"14px 16px",background:C.surface}}>
                {comments.map(c=>(
                  <div key={c.id} style={{marginBottom:12}}>
                    <div style={{display:"flex",gap:8}}>
                      <div style={{width:28,height:28,borderRadius:"50%",background:C.accent+"33",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span style={{fontSize:11,fontWeight:700,color:C.accent}}>{c.name[0].toUpperCase()}</span>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:3}}>
                          <span style={{fontSize:12,fontWeight:700,color:C.text}}>{c.name}</span>
                          <span style={{fontSize:10,color:C.muted}}>{timeAgo(c.time)}</span>
                        </div>
                        <div style={{fontSize:12,color:C.sub,lineHeight:1.5}}>{c.text}</div>
                      </div>
                    </div>
                    {c.reply&&(
                      <div style={{marginLeft:36,marginTop:8,borderLeft:`1px solid ${C.border}`,paddingLeft:12,display:"flex",gap:8}}>
                        <div style={{width:22,height:22,borderRadius:"50%",background:C.purple+"33",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          <span style={{fontSize:9,fontWeight:700,color:C.purple}}>{c.reply.name[0].toUpperCase()}</span>
                        </div>
                        <div>
                          <div style={{display:"flex",alignItems:"baseline",gap:5,marginBottom:2}}>
                            <span style={{fontSize:11,fontWeight:700,color:C.text}}>{c.reply.name}</span>
                            <span style={{fontSize:9,color:C.muted}}>{timeAgo(c.reply.time)}</span>
                          </div>
                          <div style={{fontSize:11,color:C.sub,lineHeight:1.5}}>{c.reply.text}</div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const KIT_COLORS=['#3B82F6','#EF4444','#22C55E','#F59E0B','#A855F7','#EC4899','#06B6D4','#F97316','#E2E8F0','#6B7280'];

function CreateTab({teams}){
  const freshDraft=()=>({id:String(Date.now()+Math.random()),name:'',color:'#3B82F6',formation:'2-2-1',players:[]});
  const[myTeams,setMyTeams]=useState(()=>{try{return JSON.parse(localStorage.getItem('bmls_my_teams')||'[]');}catch{return[];}});
  const[draft,setDraft]=useState(freshDraft);
  const[editSlot,setEditSlot]=useState(null);
  const[slotSearch,setSlotSearch]=useState('');
  const[slotShowAll,setSlotShowAll]=useState(false);
  const[saved,setSaved]=useState(false);

  const allPlayers=useMemo(()=>(teams||[]).flatMap(t=>t.players.filter(p=>p.name).map(p=>({...p,teamName:t.name||'',teamColor:t.color||C.accent,teamId:t.id}))),[teams]);

  const form=FORMATIONS.find(f=>f.id===draft.formation)||FORMATIONS[0];
  const totalSlots=1+form.def+form.mdf+form.fwd;
  const rows=[{pos:'FWD',n:form.fwd},{pos:'MDF',n:form.mdf},{pos:'DEF',n:form.def},{pos:'GK',n:1}].filter(r=>r.n>0);

  const getSlot=(pos,i)=>draft.players.find(p=>p.pos===pos&&p.i===i);
  const clearSlot=(pos,i)=>setDraft(d=>({...d,players:d.players.filter(p=>!(p.pos===pos&&p.i===i))}));

  const filteredPlayers=useMemo(()=>{
    if(!editSlot)return[];
    const q=slotSearch.toLowerCase();
    let list=slotShowAll?allPlayers:allPlayers.filter(p=>p.position===editSlot.pos||p.altPosition===editSlot.pos);
    if(q)list=list.filter(p=>p.name.toLowerCase().includes(q)||(p.teamName||'').toLowerCase().includes(q));
    return list;
  },[allPlayers,editSlot,slotSearch,slotShowAll]);

  const openSlot=(pos,i)=>{setEditSlot({pos,i});setSlotSearch('');setSlotShowAll(false);};
  const closeSlot=()=>{setEditSlot(null);setSlotSearch('');setSlotShowAll(false);};

  const pickPlayer=p=>{
    const others=draft.players.filter(x=>!(x.pos===editSlot.pos&&x.i===editSlot.i));
    setDraft(d=>({...d,players:[...others,{pos:editSlot.pos,i:editSlot.i,name:p.name,playerId:p.id,teamId:p.teamId,teamColor:p.teamColor,position:p.position}]}));
    closeSlot();
  };

  const saveTeam=()=>{
    if(!draft.name.trim())return;
    const idx=myTeams.findIndex(t=>t.id===draft.id);
    const updated=idx>=0?myTeams.map((t,j)=>j===idx?draft:t):[...myTeams,draft];
    setMyTeams(updated);
    localStorage.setItem('bmls_my_teams',JSON.stringify(updated));
    setSaved(true);setTimeout(()=>setSaved(false),2000);
  };
  const loadTeam=t=>{setDraft({...t});closeSlot();};
  const deleteTeam=id=>{
    const updated=myTeams.filter(t=>t.id!==id);
    setMyTeams(updated);localStorage.setItem('bmls_my_teams',JSON.stringify(updated));
    if(draft.id===id){setDraft(freshDraft());closeSlot();}
  };

  const slotGap=n=>n===1?0:n===2?60:n===3?28:18;

  return(
    <div style={{padding:16,paddingBottom:40}}>
      <div style={{fontSize:13,fontWeight:800,letterSpacing:2,color:C.muted,textTransform:'uppercase',marginBottom:14}}>Build Your Team</div>

      {/* Name + Color */}
      <div style={{background:C.card,borderRadius:10,padding:14,marginBottom:10,border:`1px solid ${C.border}`}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:6}}>Team Name</div>
        <Inp value={draft.name} onChange={v=>setDraft(d=>({...d,name:v}))} placeholder="e.g. FC Thunderbolts"/>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginTop:12,marginBottom:8}}>Kit Color</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {KIT_COLORS.map(c=>(
            <div key={c} onClick={()=>setDraft(d=>({...d,color:c}))} style={{
              width:30,height:30,borderRadius:'50%',background:c,cursor:'pointer',
              border:`2.5px solid ${draft.color===c?'#fff':'transparent'}`,
              boxShadow:draft.color===c?`0 0 0 2.5px ${c}`:c==='#E2E8F0'?'0 0 0 1px #4B5563':'none',
              transition:'transform 0.1s',transform:draft.color===c?'scale(1.18)':'scale(1)',
            }}/>
          ))}
        </div>
      </div>

      {/* Formation */}
      <div style={{background:C.card,borderRadius:10,padding:14,marginBottom:10,border:`1px solid ${C.border}`}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:8}}>Formation</div>
        <div style={{display:'flex',gap:6}}>
          {FORMATIONS.map(f=>{
            const on=draft.formation===f.id;
            return(
              <button key={f.id} onClick={()=>{setDraft(d=>({...d,formation:f.id,players:[]}));closeSlot();}} style={{
                flex:1,padding:'10px 4px',borderRadius:8,cursor:'pointer',fontFamily:"'Bebas Neue',sans-serif",
                fontSize:18,letterSpacing:1,
                background:on?`${C.accent}22`:'transparent',color:on?C.accent:C.muted,
                border:`1px solid ${on?C.accent:C.border}`,
              }}>{f.label}</button>
            );
          })}
        </div>
      </div>

      {/* Pitch */}
      <div style={{background:'#1b6530',borderRadius:editSlot?'10px 10px 0 0':10,overflow:'hidden',marginBottom:editSlot?0:10}}>
        <div style={{padding:'18px 8px 10px',position:'relative'}}>
          <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',width:72,height:72,borderRadius:'50%',border:'1px solid rgba(255,255,255,0.13)',pointerEvents:'none'}}/>
          <div style={{position:'absolute',top:'50%',left:0,right:0,height:1,background:'rgba(255,255,255,0.1)',pointerEvents:'none'}}/>
          <div style={{display:'flex',flexDirection:'column',gap:22,position:'relative'}}>
            {rows.map(({pos,n})=>(
              <div key={pos} style={{display:'flex',justifyContent:'center',gap:slotGap(n),alignItems:'center'}}>
                {Array.from({length:n},(_,i)=>{
                  const sl=getSlot(pos,i);
                  const active=editSlot?.pos===pos&&editSlot?.i===i;
                  const dotColor=active?draft.color:sl?sl.teamColor||draft.color:draft.color+'55';
                  return(
                    <div key={i} onClick={()=>active?closeSlot():openSlot(pos,i)} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,cursor:'pointer'}}>
                      <div style={{
                        width:42,height:42,borderRadius:'50%',
                        background:dotColor,
                        border:`2.5px solid ${active?'#fff':sl?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.3)'}`,
                        boxShadow:active?'0 0 0 3px rgba(255,255,255,0.35),0 2px 8px rgba(0,0,0,0.5)':'0 2px 6px rgba(0,0,0,0.4)',
                        display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.15s',
                      }}>
                        <span style={{fontSize:8,fontWeight:900,color:active||sl?'rgba(255,255,255,0.95)':'rgba(255,255,255,0.45)',letterSpacing:.5}}>{pos}</span>
                      </div>
                      <span style={{fontSize:9,color:sl?'#fff':'rgba(255,255,255,0.4)',fontWeight:700,textAlign:'center',lineHeight:1.2,textShadow:'0 1px 3px rgba(0,0,0,0.9)',maxWidth:54,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {sl?.name?.trim().split(/\s+/).pop()||'+'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{textAlign:'center',fontSize:9,color:'rgba(255,255,255,0.28)',marginTop:12,letterSpacing:1}}>{draft.players.length}/{totalSlots} players added</div>
        </div>
      </div>

      {/* Player picker */}
      {editSlot&&(
        <div style={{background:C.card,border:`1px solid ${C.accent}`,borderTop:'none',borderRadius:'0 0 10px 10px',padding:12,marginBottom:10}}>
          <div style={{display:'flex',alignItems:'center',marginBottom:10}}>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',flex:1}}>{editSlot.pos} — Pick a Player</div>
            <button onClick={closeSlot} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,lineHeight:1,padding:'0 2px'}}>✕</button>
          </div>
          <input
            autoFocus
            value={slotSearch}
            onChange={e=>setSlotSearch(e.target.value)}
            placeholder="Search by name or team..."
            style={{width:'100%',background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,padding:'7px 10px',fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:'none',marginBottom:8}}
          />
          <div style={{display:'flex',gap:6,marginBottom:8}}>
            {[false,true].map(all=>(
              <button key={String(all)} onClick={()=>setSlotShowAll(all)} style={{padding:'4px 10px',borderRadius:5,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",background:slotShowAll===all?`${C.accent}22`:'transparent',color:slotShowAll===all?C.accent:C.muted,border:`1px solid ${slotShowAll===all?C.accent:C.border}`}}>
                {all?'All positions':`${editSlot.pos} only`}
              </button>
            ))}
          </div>
          <div style={{maxHeight:220,overflowY:'auto'}}>
            {filteredPlayers.length===0?(
              <div style={{fontSize:12,color:C.muted,textAlign:'center',padding:'18px 0',fontStyle:'italic'}}>
                {allPlayers.length===0?'No players in the BMLS yet':'No players match'}
              </div>
            ):filteredPlayers.map(p=>{
              const already=draft.players.some(x=>x.playerId===p.id);
              return(
                <div key={`${p.teamId}-${p.id}`} onClick={()=>pickPlayer(p)} style={{
                  display:'flex',alignItems:'center',gap:10,padding:'8px 6px',borderRadius:7,cursor:'pointer',marginBottom:2,
                  background:already?`${C.accent}18`:'transparent',
                  opacity:p.injured||p.suspended?0.45:1,
                }}>
                  <div style={{width:10,height:10,borderRadius:'50%',background:p.teamColor,flexShrink:0,border:'1px solid rgba(255,255,255,0.2)'}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}{(p.injured||p.suspended)&&<span style={{fontSize:10,color:p.injured?C.red:C.gold,marginLeft:6}}>{p.injured?'Inj':'Susp'}</span>}</div>
                    <div style={{fontSize:10,color:C.muted}}>{p.teamName}</div>
                  </div>
                  <div style={{background:posColor(p.position)+'22',color:posColor(p.position),borderRadius:4,padding:'2px 6px',fontSize:10,fontWeight:700,flexShrink:0}}>{p.position}</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.text,minWidth:20,textAlign:'right'}}>{p.position==='GK'?'—':p.position==='MDF'?p.mdfAtkScore:p.score}</div>
                </div>
              );
            })}
          </div>
          {getSlot(editSlot.pos,editSlot.i)&&(
            <button onClick={()=>{clearSlot(editSlot.pos,editSlot.i);closeSlot();}} style={{marginTop:8,background:'none',border:'none',color:C.red,fontSize:11,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",padding:'4px 0',display:'block'}}>✕ Remove player from slot</button>
          )}
        </div>
      )}

      {/* Save / New */}
      <div style={{display:'flex',gap:8,marginBottom:20}}>
        <Btn onClick={saveTeam} variant={saved?'success':'primary'} style={{flex:1}}>{saved?'✓ Saved':'Save Team'}</Btn>
        <Btn onClick={()=>{setDraft(freshDraft());closeSlot();}} variant="secondary">New</Btn>
      </div>

      {/* Saved teams */}
      {myTeams.length>0&&(
        <>
          <div style={{fontSize:13,fontWeight:800,letterSpacing:2,color:C.muted,textTransform:'uppercase',marginBottom:10}}>My Teams</div>
          {myTeams.map(t=>{
            const tf=FORMATIONS.find(f=>f.id===t.formation)||FORMATIONS[0];
            const total=1+tf.def+tf.mdf+tf.fwd;
            const isCurrent=draft.id===t.id;
            return(
              <div key={t.id} style={{background:isCurrent?`${C.accent}11`:C.card,border:`1px solid ${isCurrent?C.accent:C.border}`,borderRadius:10,padding:'12px 14px',marginBottom:8,display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:30,height:30,borderRadius:'50%',background:t.color,flexShrink:0,border:'2px solid rgba(255,255,255,0.2)'}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.name||'Unnamed'}</div>
                  <div style={{fontSize:11,color:C.muted}}>{t.formation} · {t.players.length}/{total} players</div>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <Btn onClick={()=>loadTeam(t)} variant="secondary" small>Edit</Btn>
                  <Btn onClick={()=>deleteTeam(t.id)} variant="danger" small>×</Btn>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ── Career Mode ──────────────────────────────────────────────────────────────

const moodInfo=s=>{
  if(s>=80)return{label:'Happy',color:C.green,mult:1.05};
  if(s>=60)return{label:'Content',color:C.muted,mult:1.0};
  if(s>=40)return{label:'Unsettled',color:'#F97316',mult:0.95};
  return{label:'Unhappy',color:C.red,mult:0.90};
};

function buildCareerLineup(team,starters,formation,moods={}){
  const form=FORMATIONS.find(f=>f.id===formation)||FORMATIONS[0];
  const getP=(pos,idx)=>{
    const s=starters.find(s=>s.slotPos===pos&&s.slotIdx===idx);if(!s)return null;
    const p=team.players.find(p=>p.id===s.playerId);if(!p||p.injured||p.suspended)return null;
    const oop=p.position!==pos;
    const mm=moodInfo(moods[p.id]??65).mult;
    const mult=oop?0.7*mm:mm;
    return{...p,score:Math.round((p.score||5)*mult),mdfAtkScore:Math.round((p.mdfAtkScore||5)*mult),mdfDefScore:Math.round((p.mdfDefScore||5)*mult),_oop:oop};
  };
  const gk=getP('GK',0);
  const defs=Array.from({length:form.def},(_,i)=>getP('DEF',i)).filter(Boolean);
  const mdfs=Array.from({length:form.mdf},(_,i)=>getP('MDF',i)).filter(Boolean);
  const fwds=Array.from({length:form.fwd},(_,i)=>getP('FWD',i)).filter(Boolean);
  const sids=new Set([gk?.id,...defs.map(p=>p.id),...mdfs.map(p=>p.id),...fwds.map(p=>p.id)].filter(Boolean));
  const bench=team.players.filter(p=>!p.injured&&!p.suspended&&!sids.has(p.id));
  return{gk,defs,mdfs,fwds,formation,bench};
}

function simulateFromLineups(hl,al,hTeam,aTeam){
  const{hxg,axg}=predictMatch(hTeam,aTeam);
  const pois=λ=>{if(λ<=0)return 0;const L=Math.exp(-Math.min(λ,12));let k=0,p=1;do{k++;p*=Math.random();}while(p>L);return k-1;};
  const wPick=(items,wFn)=>{const ws=items.map(wFn),tot=ws.reduce((s,w)=>s+w,0);if(tot<=0)return items[Math.floor(Math.random()*items.length)];let r=Math.random()*tot;for(let i=0;i<items.length;i++){r-=ws[i];if(r<=0)return items[i];}return items[items.length-1];};
  const scorW=p=>p.position==='FWD'?(p.score||5)*3:p.position==='MDF'?(p.mdfAtkScore||5)*1.2:p.position==='DEF'?(p.score||5)*.2:0;
  const astW=(p,sid)=>p.id===sid?0:p.position==='MDF'?(p.mdfAtkScore||5)*2.5:p.position==='FWD'?(p.score||5):0.3;
  const mnt=()=>Math.floor(Math.random()*90)+1;
  const events=[];
  const loP=lo=>[lo.gk,...lo.defs,...lo.mdfs,...lo.fwds].filter(Boolean);
  const hPlayers=loP(hl),aPlayers=loP(al);
  const redAt={},injuredAt={},subbedOff={},subOnInfo={};
  // Red cards first
  const doReds=(players,team)=>players.forEach(p=>{if(Math.random()<0.006){const m=mnt();redAt[p.id]=m;events.push({team,type:'red',player:p,minute:m});}});
  doReds(hPlayers,'home');doReds(aPlayers,'away');
  // Injuries (very rare, outfield only, not already red-carded)
  const doInjuries=(players,team)=>players.filter(p=>p.position!=='GK'&&!redAt[p.id]).forEach(p=>{if(Math.random()<0.008){const m=mnt();injuredAt[p.id]=m;events.push({team,type:'injury',player:p,minute:m});}});
  doInjuries(hPlayers,'home');doInjuries(aPlayers,'away');
  const firstRed=ps=>ps.reduce((m,p)=>redAt[p.id]?Math.min(m,redAt[p.id]):m,91);
  let hG=pois(hxg),aG=pois(axg);
  if(firstRed(hPlayers)<70&&Math.random()<0.45)hG=Math.max(0,hG-1);
  if(firstRed(aPlayers)<70&&Math.random()<0.45)aG=Math.max(0,aG-1);
  // Substitutions (46–85')
  const genSubs=(starters,bench,team)=>{
    if(!bench?.length)return;
    const n=Math.random()<.25?0:Math.random()<.6?1:2;
    const avB=bench.filter(p=>!redAt[p.id]&&!injuredAt[p.id]);
    const avS=starters.filter(p=>p.position!=='GK'&&!redAt[p.id]&&!injuredAt[p.id]);
    for(let i=0;i<n&&avB.length&&avS.length;i++){
      const min=Math.floor(Math.random()*40)+46;
      const pi=Math.floor(Math.random()*avB.length);
      const playerOn=avB.splice(pi,1)[0];
      const sp=avS.filter(p=>p.position===playerOn.position);
      const pool=sp.length?sp:avS;
      const oi=Math.floor(Math.random()*pool.length);
      const playerOff=pool[oi];
      avS.splice(avS.indexOf(playerOff),1);
      subbedOff[playerOff.id]=min;subOnInfo[playerOn.id]={player:playerOn,minute:min,team};
      events.push({team,type:'sub',minute:min,playerOn,playerOff});
    }
  };
  genSubs(hPlayers,hl.bench,'home');genSubs(aPlayers,al.bench,'away');
  const outAt=(starters,team,min)=>[...starters.filter(p=>p.position!=='GK'&&(!redAt[p.id]||redAt[p.id]>min)&&(!injuredAt[p.id]||injuredAt[p.id]>min)&&(!subbedOff[p.id]||subbedOff[p.id]>min)),...Object.values(subOnInfo).filter(s=>s.team===team&&s.minute<=min&&(!redAt[s.player.id]||redAt[s.player.id]>min)&&(!injuredAt[s.player.id]||injuredAt[s.player.id]>min)).map(s=>s.player)];
  const allAt=(starters,team,min)=>[...starters.filter(p=>(!redAt[p.id]||redAt[p.id]>min)&&(!injuredAt[p.id]||injuredAt[p.id]>min)&&(!subbedOff[p.id]||subbedOff[p.id]>min)),...Object.values(subOnInfo).filter(s=>s.team===team&&s.minute<=min&&(!redAt[s.player.id]||redAt[s.player.id]>min)&&(!injuredAt[s.player.id]||injuredAt[s.player.id]>min)).map(s=>s.player)];
  // Goals
  const genGoals=(n,starters,team)=>{
    const allT=[...starters,...Object.values(subOnInfo).filter(s=>s.team===team).map(s=>s.player)];
    const topFWD=starters.filter(p=>p.position==='FWD').sort((a,b)=>(b.score||0)-(a.score||0))[0]||starters.find(p=>p.position!=='GK');
    const pen=allT.find(p=>(p.roles||[]).includes('penTaker'))||topFWD;
    for(let i=0;i<n;i++){
      const min=mnt();
      const elig=outAt(starters,team,min);if(!elig.length)continue;
      const all=allAt(starters,team,min);
      const isPen=Math.random()<0.15;
      const pt=all.some(p=>p.id===pen?.id)?pen:(elig.find(p=>p.position==='FWD')||elig[0]);
      const scorer=isPen?pt:wPick(elig,scorW);
      const astCands=isPen?[]:all.filter(p=>p.id!==scorer.id);
      const assist=!isPen&&Math.random()<0.78&&astCands.length?wPick(astCands,p=>astW(p,scorer.id)):null;
      events.push({team,type:'goal',player:scorer,assist,minute:min,isPen});
    }
  };
  // Yellows (starters + subs, skip red-carded or injured)
  const genYellows=(starters,team)=>[...starters,...Object.values(subOnInfo).filter(s=>s.team===team).map(s=>s.player)].forEach(p=>{
    if(redAt[p.id]||injuredAt[p.id])return;
    const r=Math.random(),yc=p.position==='DEF'?0.13:p.position==='MDF'?.10:p.position==='FWD'?.07:.02;
    if(r<yc)events.push({team,type:'yellow',player:p,minute:mnt()});
  });
  genGoals(hG,hPlayers,'home');genGoals(aG,aPlayers,'away');
  genYellows(hPlayers,'home');genYellows(aPlayers,'away');
  events.sort((a,b)=>a.minute-b.minute);
  const finalH=events.filter(e=>e.team==='home'&&e.type==='goal').length;
  const finalA=events.filter(e=>e.team==='away'&&e.type==='goal').length;
  return{hGoals:finalH,aGoals:finalA,events};
}

const CAREER_KEY='bmls_career';
const loadCareer=()=>{try{return JSON.parse(localStorage.getItem(CAREER_KEY));}catch{return null;}};
const saveCareer=c=>localStorage.setItem(CAREER_KEY,JSON.stringify(c));

function playerValue(p,team){
  const{atk,def}=lineupRatings(team);
  const ps=p.position==='GK'?7:p.position==='MDF'?(p.mdfAtkScore+p.mdfDefScore)/2:(p.score||5);
  const ts=(p.position==='FWD'||p.position==='MDF')?atk:def;
  const age=p.age||25;
  const ageMult=Math.max(0.6,3.2-0.067*age);
  return Math.round(ps*ps*ageMult*Math.max(0.5,1+(ts-7)*0.08));
}
function valueKnown(p){
  const s=p.position==='MDF'?Math.max(p.mdfAtkScore||0,p.mdfDefScore||0):(p.score||0);
  return s>=8||(p.roles||[]).includes('captain');
}

function generateCareerFixtures(teamIds){
  const ids=[...teamIds];if(ids.length%2!==0)ids.push(-1);
  const n=ids.length,rounds=n-1,half=n/2;
  const fixtures=[],rot=[...ids];
  for(let r=0;r<rounds;r++){
    for(let m=0;m<half;m++){
      const h=rot[m],a=rot[n-1-m];
      if(h!==-1&&a!==-1)fixtures.push({id:`career-${r+1}-${m}`,homeId:h,awayId:a,matchWeek:r+1,played:false,homeScore:null,awayScore:null,playerStats:[]});
    }
    rot.splice(1,0,rot.pop());
  }
  return fixtures;
}

function createCareer(myTeamId,allTeams){
  const teams=allTeams.map(t=>({...t,careerBudget:t.budget||100,players:t.players.map(p=>({...p,untouchable:false}))}));
  const active=teams.filter(t=>t.name&&t.players.length>0);
  const playerMoods={};
  teams.find(t=>t.id===myTeamId)?.players.forEach(p=>{playerMoods[p.id]=65;});
  const myTeam=teams.find(t=>t.id===myTeamId);
  const cpuBids=genPreseasonBids(teams,myTeamId,myTeam);
  return{myTeamId,matchWeek:1,phase:'lineup',teams,fixtures:generateCareerFixtures(active.map(t=>t.id)),playerStats:{},playerMoods,transfers:[],cpuBids,lineup:{formation:myTeam?.formation||'2-2-1',starters:[]},createdAt:Date.now()};
}

function CareerSetupView({teams,onStart}){
  const[sel,setSel]=useState(null);
  const team=teams.find(t=>t.id===sel);
  return(
    <div style={{padding:16,paddingBottom:40}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:34,color:C.text,letterSpacing:2,marginBottom:4,lineHeight:1}}>Career Mode</div>
      <div style={{fontSize:13,color:C.muted,marginBottom:24}}>Pick a club and take them to the top of the BMLS.</div>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:'uppercase',marginBottom:10}}>Choose Your Club</div>
      {teams.filter(t=>t.name).map(t=>{
        const r=lineupRatings(t);
        return(
          <div key={t.id} onClick={()=>setSel(t.id)} style={{background:sel===t.id?`${t.color}22`:C.card,border:`1px solid ${sel===t.id?t.color:C.border}`,borderRadius:10,padding:'12px 14px',marginBottom:8,display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}>
            <TeamBadge color={t.color} crest={t.crest} size={36}/>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:700,color:C.text}}>{t.name}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{t.formation} · ATK {r.atk.toFixed(1)} · DEF {r.def.toFixed(1)} · Budget £{t.budget||0}M</div>
            </div>
            {sel===t.id&&<div style={{color:t.color,fontSize:22,fontWeight:900,flexShrink:0}}>✓</div>}
          </div>
        );
      })}
      {team&&<div style={{marginTop:16,position:'sticky',bottom:16}}><Btn onClick={()=>onStart(team.id)} variant="success" style={{width:'100%',padding:'13px 16px',fontSize:15}}>Start Career with {team.shortName||team.name} →</Btn></div>}
    </div>
  );
}

function CareerHubView({career,onNav}){
  const moods=career.playerMoods||{};
  const myTeam=career.teams.find(t=>t.id===career.myTeamId);
  const played=useMemo(()=>career.fixtures.filter(f=>f.played),[career.fixtures]);
  const table=useMemo(()=>computeTable(career.teams,played),[career.teams,played]);
  const myRow=table.find(r=>r.id===career.myTeamId);
  const myPos=table.findIndex(r=>r.id===career.myTeamId)+1;
  const myFix=career.fixtures.find(f=>f.matchWeek===career.matchWeek&&(f.homeId===career.myTeamId||f.awayId===career.myTeamId));
  const isHome=myFix?.homeId===career.myTeamId;
  const opp=myFix?career.teams.find(t=>t.id===(isHome?myFix.awayId:myFix.homeId)):null;
  const totalMW=career.fixtures.reduce((m,f)=>Math.max(m,f.matchWeek),0);
  const seasonDone=career.matchWeek>totalMW;
  return(
    <div style={{paddingBottom:16}}>
      {seasonDone&&(
        <div style={{background:`${C.gold}22`,border:`1px solid ${C.gold}44`,borderRadius:10,padding:16,marginBottom:12,textAlign:'center'}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,color:C.gold,letterSpacing:2}}>Season Complete</div>
          <div style={{fontSize:13,color:C.muted,marginTop:4}}>Final position: {myPos}{myPos===1?' 🏆':myPos<=3?' 🥉':''}</div>
        </div>
      )}
      {myFix&&!myFix.played&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:16,marginBottom:10}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:'uppercase',marginBottom:12}}>Matchweek {career.matchWeek}</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:8,marginBottom:14}}>
            <div style={{textAlign:'right',fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:C.text,letterSpacing:.5}}>{isHome?myTeam?.name:opp?.name}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:C.border,letterSpacing:4,textAlign:'center'}}>vs</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:C.text,letterSpacing:.5}}>{isHome?opp?.name:myTeam?.name}</div>
          </div>
          <div style={{display:'flex',gap:8,marginBottom:6}}>
            <Btn onClick={()=>onNav('lineup')} variant="secondary" style={{flex:1}}>Set Lineup</Btn>
            <Btn onClick={()=>onNav('sim')} style={{flex:1}}>▶ Play Match</Btn>
          </div>
          <Btn onClick={()=>onNav('opponent')} variant="secondary" style={{width:'100%',fontSize:11}}>Scout Report</Btn>
        </div>
      )}
      {myFix&&myFix.played&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:16,marginBottom:10}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:'uppercase',marginBottom:8}}>MW {career.matchWeek-1} Result</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:8}}>
            <div style={{textAlign:'right',fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:C.text}}>{isHome?myTeam?.name:opp?.name}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:38,color:C.gold,letterSpacing:3,padding:'0 8px'}}>{myFix.homeScore}–{myFix.awayScore}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:C.text}}>{isHome?opp?.name:myTeam?.name}</div>
          </div>
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:10}}>
        {[{label:'POS',val:myPos||'—',col:myPos===1?C.gold:C.accent},{label:'PTS',val:myRow?.pts??0,col:C.gold},{label:'W',val:myRow?.w??0,col:C.green},{label:'BUDGET',val:`£${myTeam?.careerBudget??0}M`,col:C.text}].map(({label,val,col})=>(
          <div key={label} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 4px',textAlign:'center'}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:label==='BUDGET'?16:26,color:col,lineHeight:1}}>{val}</div>
            <div style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:1.2,marginTop:3}}>{label}</div>
          </div>
        ))}
      </div>
      {(()=>{
        const prevMW=career.matchWeek-1;
        if(prevMW<1)return null;
        const mwFixtures=career.fixtures.filter(f=>f.matchWeek===prevMW&&f.played);
        if(!mwFixtures.length)return null;
        return(
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'12px 14px',marginBottom:10}}>
            <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10}}>MW{prevMW} Results</div>
            {mwFixtures.map(f=>{
              const home=career.teams.find(t=>t.id===f.homeId);
              const away=career.teams.find(t=>t.id===f.awayId);
              const isMe=f.homeId===career.myTeamId||f.awayId===career.myTeamId;
              return(
                <div key={f.matchWeek+'-'+f.homeId} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,opacity:isMe?1:0.75}}>
                  <div style={{flex:1,fontSize:12,color:isMe?C.text:C.sub,fontWeight:isMe?700:400,textAlign:'right',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{home?.shortName||home?.name||'?'}</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:isMe?C.gold:C.muted,letterSpacing:2,minWidth:44,textAlign:'center'}}>{f.homeScore}–{f.awayScore}</div>
                  <div style={{flex:1,fontSize:12,color:isMe?C.text:C.sub,fontWeight:isMe?700:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{away?.shortName||away?.name||'?'}</div>
                </div>
              );
            })}
          </div>
        );
      })()}
      {(()=>{
        const ps=myTeam?.players||[];
        const unhappy=ps.filter(p=>(moods[p.id]??65)<40);
        if(unhappy.length===0)return null;
        return(
          <div onClick={()=>onNav('transfers')} style={{background:`${C.red}18`,border:`1px solid ${C.red}44`,borderRadius:8,padding:'10px 12px',marginBottom:10,cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:C.red,flexShrink:0}}/>
            <div style={{flex:1,fontSize:12,color:C.sub,lineHeight:1.4}}><span style={{color:C.red,fontWeight:700}}>{unhappy.length} player{unhappy.length!==1?'s':''} unhappy</span> — {unhappy.map(p=>p.name).join(', ')} may request a transfer.</div>
          </div>
        );
      })()}
      {(myTeam?.players||[]).length>0&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'12px 14px',marginBottom:10}}>
          <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10}}>Squad Morale</div>
          {(myTeam.players).map(p=>{const sat=moods[p.id]??65;const mi=moodInfo(sat);return(
            <div key={p.id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:7}}>
              <div style={{fontSize:12,color:C.sub,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
              <div style={{width:80,height:5,borderRadius:3,background:C.border,overflow:'hidden',flexShrink:0}}><div style={{width:`${sat}%`,height:'100%',background:mi.color,borderRadius:3}}/></div>
              <div style={{fontSize:11,color:mi.color,fontWeight:700,minWidth:56,textAlign:'right'}}>{mi.label}</div>
            </div>
          );})}
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        {[{id:'table',label:'📊 Table'},{id:'transfers',label:'💰 Transfers'},{id:'stats',label:'⚽ Stats'},{id:'news',label:'📰 News'}].map(item=>(
          <button key={item.id} onClick={()=>onNav(item.id)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'12px 10px',cursor:'pointer',color:C.text,fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",textAlign:'left'}}>{item.label}</button>
        ))}
      </div>
    </div>
  );
}

function CareerTableView({career}){
  const played=useMemo(()=>career.fixtures.filter(f=>f.played),[career.fixtures]);
  const table=useMemo(()=>computeTable(career.teams,played),[career.teams,played]);
  return(
    <div>
      <div style={{fontSize:13,fontWeight:800,letterSpacing:2,color:C.muted,textTransform:'uppercase',marginBottom:12}}>League Table</div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
            {['#','Team','P','W','D','L','GD','Pts'].map(h=><th key={h} style={{padding:'8px 6px',fontSize:10,fontWeight:700,letterSpacing:1.5,color:C.muted,textAlign:h==='Team'?'left':'center',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {table.map((row,i)=>{
              const gd=row.gf-row.ga,isTop=i<3,isBot=i>=table.length-3,isMe=row.id===career.myTeamId;
              return(
                <tr key={row.id} style={{borderBottom:`1px solid ${C.border}22`,background:isMe?`${row.color}18`:'transparent'}}>
                  <td style={{padding:'11px 6px',textAlign:'center'}}><span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:22,height:22,borderRadius:4,background:isTop?C.accent:isBot?`${C.red}22`:'transparent',color:isTop?C.white:isBot?C.red:C.muted,fontSize:11,fontWeight:700}}>{i+1}</span></td>
                  <td style={{padding:'11px 6px'}}><div style={{display:'flex',alignItems:'center',gap:8}}><TeamBadge color={row.color} crest={row.crest} size={20}/><div style={{fontSize:13,fontWeight:isMe?700:500,color:C.text}}>{row.shortName||row.name}{isMe&&<span style={{fontSize:10,color:C.accent,marginLeft:5}}>▶</span>}</div></div></td>
                  {[row.p,row.w,row.d,row.l].map((v,j)=><td key={j} style={{padding:'11px 6px',textAlign:'center',fontSize:12,color:C.sub}}>{v}</td>)}
                  <td style={{padding:'11px 6px',textAlign:'center',fontSize:12,fontWeight:700,color:gd>0?C.green:gd<0?C.red:C.sub}}>{gd>0?`+${gd}`:gd}</td>
                  <td style={{padding:'11px 6px',textAlign:'center'}}><span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:isTop?C.gold:C.text}}>{row.pts}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CareerLineupView({career,onSave}){
  const moods=career.playerMoods||{};
  const myTeam=career.teams.find(t=>t.id===career.myTeamId);
  const[lineup,setLineup]=useState(career.lineup||{formation:myTeam?.formation||'2-2-1',starters:[]});
  const[selSlot,setSelSlot]=useState(null);
  const form=FORMATIONS.find(f=>f.id===lineup.formation)||FORMATIONS[0];
  const rows=[{pos:'FWD',n:form.fwd},{pos:'MDF',n:form.mdf},{pos:'DEF',n:form.def},{pos:'GK',n:1}].filter(r=>r.n>0);
  const totalSlots=1+form.def+form.mdf+form.fwd;
  const starterIds=new Set(lineup.starters.map(s=>s.playerId));
  const available=(myTeam?.players||[]).filter(p=>!p.injured&&!p.suspended);
  const bench=available.filter(p=>!starterIds.has(p.id));
  const getStarter=(pos,idx)=>{const s=lineup.starters.find(s=>s.slotPos===pos&&s.slotIdx===idx);if(!s)return null;const p=myTeam?.players.find(p=>p.id===s.playerId);return(p&&!p.injured&&!p.suspended)?p:null;};
  const assign=(pos,idx,pid)=>{
    const others=lineup.starters.filter(s=>!(s.slotPos===pos&&s.slotIdx===idx)&&s.playerId!==pid);
    setLineup(l=>({...l,starters:[...others,{slotPos:pos,slotIdx:idx,playerId:pid}]}));setSelSlot(null);
  };
  const remove=(pos,idx)=>{setLineup(l=>({...l,starters:l.starters.filter(s=>!(s.slotPos===pos&&s.slotIdx===idx))}));setSelSlot(null);};
  const slotGap=n=>n===1?0:n===2?56:n===3?26:16;
  return(
    <div style={{paddingBottom:20}}>
      <div style={{background:C.card,borderRadius:10,padding:14,marginBottom:10,border:`1px solid ${C.border}`}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:8}}>Formation</div>
        <div style={{display:'flex',gap:6}}>
          {FORMATIONS.map(f=>{const on=lineup.formation===f.id;return(
            <button key={f.id} onClick={()=>{setLineup(l=>({...l,formation:f.id,starters:[]}));setSelSlot(null);}} style={{flex:1,padding:'10px 4px',borderRadius:8,cursor:'pointer',fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:1,background:on?`${C.accent}22`:'transparent',color:on?C.accent:C.muted,border:`1px solid ${on?C.accent:C.border}`}}>{f.label}</button>
          );})}
        </div>
      </div>
      <div style={{background:'#1b6530',borderRadius:selSlot?'10px 10px 0 0':10,overflow:'hidden',marginBottom:selSlot?0:10}}>
        <div style={{padding:'18px 8px 10px',position:'relative'}}>
          <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',width:72,height:72,borderRadius:'50%',border:'1px solid rgba(255,255,255,0.12)',pointerEvents:'none'}}/>
          <div style={{position:'absolute',top:'50%',left:0,right:0,height:1,background:'rgba(255,255,255,0.09)',pointerEvents:'none'}}/>
          <div style={{display:'flex',flexDirection:'column',gap:20,position:'relative'}}>
            {rows.map(({pos,n})=>(
              <div key={pos} style={{display:'flex',justifyContent:'center',gap:slotGap(n),alignItems:'center'}}>
                {Array.from({length:n},(_,idx)=>{
                  const pl=getStarter(pos,idx);const active=selSlot?.pos===pos&&selSlot?.idx===idx;
                  const oop=pl&&pl.position!==pos;
                  return(
                    <div key={idx} onClick={()=>active?setSelSlot(null):setSelSlot({pos,idx})} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,cursor:'pointer'}}>
                      <div style={{width:42,height:42,borderRadius:'50%',position:'relative',background:active?(myTeam?.color||C.accent):pl?(pl.teamColor||myTeam?.color||C.accent):(myTeam?.color||C.accent)+'55',border:`2.5px solid ${active?'#fff':pl?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.3)'}`,boxShadow:active?'0 0 0 3px rgba(255,255,255,0.3),0 2px 8px rgba(0,0,0,0.5)':'0 2px 6px rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.15s'}}>
                        <span style={{fontSize:7.5,fontWeight:900,color:active||pl?'rgba(255,255,255,0.95)':'rgba(255,255,255,0.45)',letterSpacing:.5}}>{pl?pl.position:pos}</span>
                        {oop&&<div style={{position:'absolute',top:-3,right:-3,width:13,height:13,borderRadius:'50%',background:C.gold,fontSize:7,fontWeight:900,color:'#000',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2}}>!</div>}
                      </div>
                      <span style={{fontSize:9,color:pl?'#fff':'rgba(255,255,255,0.4)',fontWeight:700,textAlign:'center',lineHeight:1.2,textShadow:'0 1px 3px rgba(0,0,0,0.9)',maxWidth:54,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{pl?.name?.trim().split(/\s+/).pop()||'+'}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{textAlign:'center',fontSize:9,color:'rgba(255,255,255,0.28)',marginTop:12,letterSpacing:1}}>{lineup.starters.length}/{totalSlots} selected</div>
        </div>
      </div>
      {selSlot&&(
        <div style={{background:C.card,border:`1px solid ${C.accent}`,borderTop:'none',borderRadius:'0 0 10px 10px',padding:12,marginBottom:10}}>
          <div style={{display:'flex',alignItems:'center',marginBottom:8}}>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',flex:1}}>{selSlot.pos} slot — pick player</div>
            <button onClick={()=>setSelSlot(null)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,padding:'0 2px'}}>✕</button>
          </div>
          <div style={{maxHeight:210,overflowY:'auto'}}>
            {available.map(p=>{
              const inOtherSlot=starterIds.has(p.id)&&!lineup.starters.find(s=>s.slotPos===selSlot.pos&&s.slotIdx===selSlot.idx&&s.playerId===p.id);
              const oop=p.position!==selSlot.pos;
              return(
                <div key={p.id} onClick={()=>assign(selSlot.pos,selSlot.idx,p.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 6px',borderRadius:7,cursor:'pointer',marginBottom:2,opacity:inOtherSlot?.5:1,background:getStarter(selSlot.pos,selSlot.idx)?.id===p.id?`${C.accent}22`:'transparent'}}>
                  <div style={{background:posColor(p.position)+'22',color:posColor(p.position),borderRadius:4,padding:'2px 6px',fontSize:10,fontWeight:700,flexShrink:0}}>{p.position}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}{oop&&<span style={{fontSize:9,color:C.gold,marginLeft:6}}>OOP ×0.7</span>}{inOtherSlot&&<span style={{fontSize:9,color:C.muted,marginLeft:6}}>in lineup</span>}</div>
                    <div style={{fontSize:10,color:moodInfo(moods[p.id]??65).color,fontWeight:700,marginTop:1}}>{moodInfo(moods[p.id]??65).label}</div>
                  </div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.text,minWidth:20,textAlign:'right'}}>{p.position==='GK'?'—':p.position==='MDF'?p.mdfAtkScore:p.score}</div>
                </div>
              );
            })}
          </div>
          {getStarter(selSlot.pos,selSlot.idx)&&<button onClick={()=>remove(selSlot.pos,selSlot.idx)} style={{marginTop:8,background:'none',border:'none',color:C.red,fontSize:11,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",padding:'4px 0',display:'block'}}>✕ Remove from slot</button>}
        </div>
      )}
      {bench.length>0&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginBottom:10}}>
          <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:8}}>Bench</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {bench.map(p=><div key={p.id} style={{background:C.surface,borderRadius:6,padding:'4px 8px',fontSize:11,color:C.sub,fontWeight:600}}><span style={{color:posColor(p.position),marginRight:4}}>{p.position}</span>{p.name?.split(/\s+/).pop()}</div>)}
          </div>
        </div>
      )}
      <Btn onClick={()=>onSave(lineup)} variant="success" style={{width:'100%',padding:'12px'}}>Save Lineup ✓</Btn>
    </div>
  );
}

function CareerSimView({career,onMatchComplete}){
  const myTeam=career.teams.find(t=>t.id===career.myTeamId);
  const myFix=career.fixtures.find(f=>f.matchWeek===career.matchWeek&&(f.homeId===career.myTeamId||f.awayId===career.myTeamId));
  const isHome=myFix?.homeId===career.myTeamId;
  const oppTeam=myFix?career.teams.find(t=>t.id===(isHome?myFix.awayId:myFix.homeId)):null;
  const[simData,setSimData]=useState(null);
  const[minute,setMinute]=useState(0);
  const[shown,setShown]=useState([]);
  const[score,setScore]=useState({h:0,a:0});
  const[speed,setSpeed]=useState(1);
  const[running,setRunning]=useState(false);
  const[done,setDone]=useState(false);
  const iRef=useRef(null);
  const feedRef=useRef(null);
  const hName=isHome?myTeam?.name:oppTeam?.name;
  const aName=isHome?oppTeam?.name:myTeam?.name;

  const kick=()=>{
    if(!myFix||!oppTeam)return;
    const myLo=buildCareerLineup(myTeam,career.lineup?.starters||[],career.lineup?.formation||myTeam.formation,career.playerMoods||{});
    const oppLo=predictedLineup(oppTeam,career.fixtures);
    const r=isHome?simulateFromLineups(myLo,oppLo,myTeam,oppTeam):simulateFromLineups(oppLo,myLo,oppTeam,myTeam);
    setSimData(r);setMinute(0);setShown([]);setScore({h:0,a:0});setDone(false);setRunning(true);
  };
  const reset=()=>{setSimData(null);setMinute(0);setShown([]);setScore({h:0,a:0});setDone(false);setRunning(false);};

  useEffect(()=>{
    if(!running||!simData)return;
    clearInterval(iRef.current);
    iRef.current=setInterval(()=>setMinute(m=>m<90?m+1:90),1000/speed);
    return()=>clearInterval(iRef.current);
  },[running,speed,simData]);

  useEffect(()=>{
    if(!simData||minute===0)return;
    const now=simData.events.filter(e=>e.minute===minute);
    if(now.length){
      setShown(p=>[...p,...now]);
      const goals=now.filter(e=>e.type==='goal');
      if(goals.length)setScore(s=>{let h=s.h,a=s.a;goals.forEach(e=>{if(e.team==='home')h++;else a++;});return{h,a};});
    }
    if(minute>=90){clearInterval(iRef.current);setRunning(false);setDone(true);}
  },[minute]);

  useEffect(()=>{if(feedRef.current)feedRef.current.scrollTop=feedRef.current.scrollHeight;},[shown]);

  const apply=()=>{
    if(!simData||!myFix)return;
    const stats={};
    const upd=(pid,f,v)=>{if(!stats[pid])stats[pid]={goals:0,penGoals:0,assists:0,yellowCards:0,redCards:0,cleanSheets:0};stats[pid][f]=typeof v==='boolean'?(stats[pid][f]||0)+(v?1:0):(stats[pid][f]||0)+v;};
    simData.events.forEach(e=>{
      if(e.type==='goal'){upd(e.player.id,'goals',1);if(e.isPen)upd(e.player.id,'penGoals',1);if(e.assist)upd(e.assist.id,'assists',1);}
      else if(e.type==='yellow')upd(e.player.id,'yellowCards',1);
      else if(e.type==='red')upd(e.player.id,'redCards',1);
    });
    const hT=isHome?myTeam:oppTeam,aT=isHome?oppTeam:myTeam;
    if(simData.aGoals===0){const gk=hT.players.find(p=>p.position==='GK');if(gk)upd(gk.id,'cleanSheets',1);}
    if(simData.hGoals===0){const gk=aT.players.find(p=>p.position==='GK');if(gk)upd(gk.id,'cleanSheets',1);}
    let updated={...career,fixtures:career.fixtures.map(f=>f.id===myFix.id?{...f,played:true,homeScore:simData.hGoals,awayScore:simData.aGoals}:f)};
    // CPU vs CPU
    const cpuFixes=updated.fixtures.filter(f=>f.matchWeek===career.matchWeek&&f.id!==myFix.id&&!f.played);
    cpuFixes.forEach(f=>{
      const ht=updated.teams.find(t=>t.id===f.homeId),at=updated.teams.find(t=>t.id===f.awayId);
      if(!ht||!at)return;
      const r=simulateFromLineups(predictedLineup(ht,updated.fixtures),predictedLineup(at,updated.fixtures),ht,at);
      r.events.forEach(e=>{
        if(e.type==='goal'){upd(e.player.id,'goals',1);if(e.isPen)upd(e.player.id,'penGoals',1);if(e.assist)upd(e.assist.id,'assists',1);}
        else if(e.type==='yellow')upd(e.player.id,'yellowCards',1);
        else if(e.type==='red')upd(e.player.id,'redCards',1);
      });
      if(r.aGoals===0){const gk=ht.players.find(p=>p.position==='GK');if(gk)upd(gk.id,'cleanSheets',1);}
      if(r.hGoals===0){const gk=at.players.find(p=>p.position==='GK');if(gk)upd(gk.id,'cleanSheets',1);}
      updated={...updated,fixtures:updated.fixtures.map(x=>x.id===f.id?{...x,played:true,homeScore:r.hGoals,awayScore:r.aGoals}:x)};
    });
    // Merge stats
    const merged={...career.playerStats};
    Object.entries(stats).forEach(([pid,s])=>{
      if(!merged[pid])merged[pid]={goals:0,penGoals:0,assists:0,yellowCards:0,redCards:0,cleanSheets:0};
      Object.keys(s).forEach(k=>merged[pid][k]=(merged[pid][k]||0)+s[k]);
    });
    // Auto-suspend my players who got red cards; mark injuries (both clear next matchweek)
    const myRedIds=new Set(simData.events.filter(e=>e.type==='red'&&e.team===(isHome?'home':'away')).map(e=>e.player.id));
    const myInjuredIds=new Set(simData.events.filter(e=>e.type==='injury'&&e.team===(isHome?'home':'away')).map(e=>e.player.id));
    updated={...updated,teams:updated.teams.map(t=>t.id!==career.myTeamId?t:{...t,players:t.players.map(p=>({...p,suspended:myRedIds.has(p.id),injured:myInjuredIds.has(p.id)}))})};
    // Update player moods
    const mySide=isHome?'home':'away';
    const myRes=isHome?(simData.hGoals>simData.aGoals?'W':simData.hGoals<simData.aGoals?'L':'D'):(simData.aGoals>simData.hGoals?'W':simData.aGoals<simData.hGoals?'L':'D');
    const myStarterIds=new Set(career.lineup?.starters?.map(s=>s.playerId)||[]);
    const mySubIds=new Set(simData.events.filter(e=>e.type==='sub'&&e.team===mySide).map(e=>e.playerOn.id));
    const updMoods={...career.playerMoods};
    (updated.teams.find(t=>t.id===career.myTeamId)?.players||[]).forEach(p=>{
      const cur=updMoods[p.id]??65;
      let delta=0;
      if(myStarterIds.has(p.id)){delta+=8;if(myRes==='W')delta+=3;else if(myRes==='L')delta-=2;}
      else if(mySubIds.has(p.id)){delta+=3;if(myRes==='W')delta+=2;else if(myRes==='L')delta-=1;}
      else if(!p.injured&&!p.suspended){delta-=5;if(myRes==='L')delta-=1;}
      updMoods[p.id]=Math.max(0,Math.min(100,Math.round((cur+delta)+(65-(cur+delta))*0.08)));
    });
    // Transfer window: MW1–3 — run one CPU-CPU trade per matchweek, close after MW3
    if(career.matchWeek<=3){
      const cpuTrade=maybeDoCpuTrade(career,updated.teams);
      if(cpuTrade){
        const{player,seller,buyer,amount,swapPlayer}=cpuTrade;
        updated={...updated,teams:updated.teams.map(t=>{
          if(t.id===seller.id)return{...t,careerBudget:(t.careerBudget||0)+amount,players:[...t.players.filter(p=>p.id!==player.id),{...swapPlayer,untouchable:false}]};
          if(t.id===buyer.id)return{...t,careerBudget:(t.careerBudget||0)-amount,players:[...t.players.filter(p=>p.id!==swapPlayer.id),{...player,untouchable:false}]};
          return t;
        })};
        updated={...updated,transfers:[...(updated.transfers||[]),{id:Date.now()+1,playerName:player.name,fromTeam:seller.name,toTeam:buyer.name,amount,swapPlayerName:swapPlayer.name,matchWeek:career.matchWeek,cpuTrade:true}]};
      }
    }
    // Window closes after MW3 — clear any unresolved CPU bids
    const nextCpuBids=career.matchWeek===3?[]:(career.cpuBids||[]);
    onMatchComplete({...updated,playerStats:merged,playerMoods:updMoods,cpuBids:nextCpuBids,matchWeek:career.matchWeek+1,phase:'lineup'});
  };

  const ico=t=>t==='goal'?'⚽':t==='yellow'?'🟡':t==='sub'?'🔄':t==='injury'?'🤕':'🟥';
  const evMain=e=>e.type==='goal'?`${e.player.name}${e.isPen?' (pen)':''}`:e.type==='sub'?`↑ ${e.playerOn.name}`:`${e.player.name}`;
  const evSub=e=>e.type==='sub'?`↓ ${e.playerOff.name}`:e.assist?`↗ ${e.assist.name}`:'';
  if(!myFix||myFix.played)return<div style={{color:C.muted,textAlign:'center',paddingTop:40,fontSize:13}}>{myFix?.played?'Already played — check Hub.':'No fixture this matchweek.'}</div>;

  return(
    <div style={{paddingBottom:20}}>
      {!simData?(
        <div style={{textAlign:'center',paddingTop:32}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:8,marginBottom:28}}>
            <div style={{textAlign:'right',fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:isHome?C.text:C.muted,letterSpacing:.5}}>{hName}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.border,letterSpacing:4}}>vs</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:!isHome?C.text:C.muted,letterSpacing:.5}}>{aName}</div>
          </div>
          <Btn onClick={kick} style={{padding:'14px 44px',fontSize:16}}>▶ Kick Off</Btn>
        </div>
      ):(
        <div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'14px 16px',marginBottom:8}}>
            <div style={{textAlign:'center',fontSize:11,fontWeight:700,color:done?C.green:running?C.red:C.muted,letterSpacing:2,marginBottom:6}}>{done?'FULL TIME':minute===45?'HALF TIME':running?`${minute}'`:'—'}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:8}}>
              <div style={{textAlign:'right',fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.text}}>{hName}</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:52,color:C.gold,letterSpacing:4,textAlign:'center',lineHeight:1,padding:'0 10px'}}>{score.h}–{score.a}</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.text}}>{aName}</div>
            </div>
          </div>
          {running&&<div style={{height:3,background:C.surface,borderRadius:2,marginBottom:8,overflow:'hidden'}}><div style={{height:'100%',background:C.accent,width:`${(minute/90)*100}%`,transition:'width 0.9s linear'}}/></div>}
          {running&&<div style={{display:'flex',gap:6,marginBottom:8,justifyContent:'center'}}>{[1,2,5].map(s=><button key={s} onClick={()=>setSpeed(s)} style={{background:speed===s?`${C.accent}22`:'transparent',color:speed===s?C.accent:C.muted,border:`1px solid ${speed===s?C.accent:C.border}`,borderRadius:5,padding:'4px 12px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>{s}×</button>)}</div>}
          <div ref={feedRef} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginBottom:10,minHeight:120,maxHeight:260,overflowY:'auto'}}>
            {shown.length===0?<div style={{fontSize:11,color:C.muted,textAlign:'center',fontStyle:'italic',padding:'24px 0'}}>Waiting for kick off…</div>:shown.map((e,i)=>{
              const isH=e.team==='home';
              const main=evMain(e),sub2=evSub(e);
              return(
                <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 34px 1fr',gap:2,marginBottom:6,alignItems:'start'}}>
                  {isH?<div style={{textAlign:'right',paddingRight:4}}><div style={{fontSize:12,color:e.type==='sub'?C.muted:C.text,fontWeight:600}}>{main} {ico(e.type)}</div>{sub2&&<div style={{fontSize:10,color:C.muted}}>{sub2}</div>}</div>:<div/>}
                  <div style={{textAlign:'center',fontSize:10,color:C.muted,fontWeight:700,paddingTop:2}}>{e.minute}'</div>
                  {!isH?<div style={{paddingLeft:4}}><div style={{fontSize:12,color:e.type==='sub'?C.muted:C.text,fontWeight:600}}>{ico(e.type)} {main}</div>{sub2&&<div style={{fontSize:10,color:C.muted,paddingLeft:14}}>{sub2}</div>}</div>:<div/>}
                </div>
              );
            })}
          </div>
          {done&&<div style={{display:'flex',gap:8}}><Btn onClick={reset} variant="secondary" style={{flex:1}}>Re-simulate</Btn><Btn onClick={apply} variant="success" style={{flex:1}}>Accept Result ✓</Btn></div>}
        </div>
      )}
    </div>
  );
}

const ord=n=>{const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);};

function CareerStatsView({career}){
  const[tab,setTab]=useState('goals');
  const reg={};career.teams.forEach(t=>t.players.forEach(p=>{reg[p.id]={...p,teamName:t.name,teamShort:t.shortName||t.name};}));
  const entries=Object.entries(career.playerStats).map(([id,s])=>({...reg[id],...s,id})).filter(e=>e.name);
  const TABS=[
    {id:'goals',label:'⚽ Goals',field:'goals',sub:e=>`${e.penGoals||0} pen`},
    {id:'assists',label:'🅰 Assists',field:'assists'},
    {id:'cs',label:'🧤 Clean Sheets',field:'cleanSheets',only:'GK'},
    {id:'cards',label:'🟡 Cards',field:'yellowCards',sub:e=>`${e.redCards||0} red`},
  ];
  const cur=TABS.find(t=>t.id===tab);
  const list=[...entries].filter(e=>!cur.only||e.position===cur.only).sort((a,b)=>(b[cur.field]||0)-(a[cur.field]||0)).filter(e=>(e[cur.field]||0)>0).slice(0,15);
  return(
    <div>
      <div style={{display:'flex',gap:5,marginBottom:14,overflowX:'auto'}}>
        {TABS.map(t=>{const on=tab===t.id;return<button key={t.id} onClick={()=>setTab(t.id)} style={{background:on?`${C.accent}22`:'transparent',color:on?C.accent:C.muted,border:`1px solid ${on?C.accent:C.border}`,borderRadius:6,padding:'5px 10px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",whiteSpace:'nowrap'}}>{t.label}</button>;})}
      </div>
      {list.length===0?<div style={{color:C.muted,fontSize:13,textAlign:'center',paddingTop:32,fontStyle:'italic'}}>No data yet — play some matches.</div>:list.map((e,i)=>(
        <div key={e.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:6}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:i<3?C.gold:C.muted,width:26,textAlign:'center'}}>{i+1}</div>
          <div style={{width:8,height:8,borderRadius:'50%',background:e.teamColor||C.accent,flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.name}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:1}}>{e.teamShort} · {e.position}</div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:C.text,lineHeight:1}}>{e[cur.field]||0}</div>
            {cur.sub&&<div style={{fontSize:9,color:C.muted}}>{cur.sub(e)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function genPreseasonBids(teams,myTeamId,myTeam){
  const bids=[];
  const eligible=(myTeam?.players||[]).filter(p=>p.position!=='GK'&&!p.untouchable&&(p.score||0)>=6);
  const others=teams.filter(t=>t.id!==myTeamId&&t.name&&t.players.length>=2);
  if(!eligible.length||!others.length)return bids;
  const n=Math.random()<0.25?2:Math.random()<0.5?1:0;
  const sh=a=>[...a].sort(()=>Math.random()-.5);
  const quality=p=>p.position==='MDF'?Math.max(p.mdfAtkScore||0,p.mdfDefScore||0):(p.score||0);
  const{atk,def}=lineupRatings(myTeam);
  const userNeedsAtk=atk<=def;
  const swapPosPref=userNeedsAtk?['FWD','MDF']:['DEF','MDF'];
  sh(eligible).slice(0,n).forEach((p,i)=>{
    const val=playerValue(p,myTeam);
    const bidTeam=others[Math.floor(Math.random()*others.length)];
    const swapCands=bidTeam.players.filter(bp=>swapPosPref.includes(bp.position)&&bp.position!=='GK').sort((a,b)=>quality(b)-quality(a));
    const anyOut=bidTeam.players.filter(bp=>bp.position!=='GK').sort((a,b)=>quality(b)-quality(a));
    const pool=swapCands.length>0?swapCands:anyOut;
    const swapPlayer=pool.length>0?pool[Math.min(Math.floor(pool.length/2),pool.length-1)]:null;
    bids.push({id:Date.now()+i,player:p,bidTeam,amount:Math.round(val*(0.40+Math.random()*.20)),val,swapPlayer,negotiationRound:0});
  });
  return bids;
}

function maybeDoCpuTrade(career,teams){
  if(Math.random()>0.18)return null;
  const eligible=teams.filter(t=>t.id!==career.myTeamId&&t.name&&t.players.length>=6);
  if(eligible.length<2)return null;
  const sh=a=>[...a].sort(()=>Math.random()-.5);
  const quality=p=>p.position==='MDF'?Math.max(p.mdfAtkScore||0,p.mdfDefScore||0):(p.score||0);
  const atkScore=p=>p.position==='FWD'?(p.score||0):p.position==='MDF'?(p.mdfAtkScore||0):0;
  const defScore=p=>p.position==='DEF'?(p.score||0):p.position==='MDF'?(p.mdfDefScore||0):0;
  for(const buyer of sh(eligible)){
    const{atk,def}=lineupRatings(buyer);
    const needsAtk=atk<def||(atk===def&&Math.random()<.5);
    // Find target player from a different team in the area buyer needs
    const targetFilter=needsAtk
      ?(p=>p.position!=='GK'&&(p.position==='FWD'||(p.position==='MDF'&&(p.mdfAtkScore||0)>=6))&&atkScore(p)>=6)
      :(p=>p.position!=='GK'&&(p.position==='DEF'||(p.position==='MDF'&&(p.mdfDefScore||0)>=6))&&defScore(p)>=6);
    for(const seller of sh(eligible.filter(t=>t.id!==buyer.id))){
      const targets=seller.players.filter(targetFilter).sort((a,b)=>(needsAtk?atkScore(b)-atkScore(a):defScore(b)-defScore(a)));
      if(!targets.length)continue;
      const player=targets[0];
      const amount=Math.round(playerValue(player,seller)*(0.80+Math.random()*.25));
      if((buyer.careerBudget||0)<amount)continue;
      // Swap: send a player the SELLER wants (fills seller's weakness), not buyer's worst
      const{atk:sAtk,def:sDef}=lineupRatings(seller);
      const sellerNeedsAtk=sAtk<=sDef;
      const swapPosPref=sellerNeedsAtk?['FWD','MDF']:['DEF','MDF'];
      const swapCands=buyer.players.filter(p=>swapPosPref.includes(p.position)&&p.position!=='GK').sort((a,b)=>quality(b)-quality(a));
      const anyOut=buyer.players.filter(p=>p.position!=='GK').sort((a,b)=>quality(b)-quality(a));
      const pool=swapCands.length>0?swapCands:anyOut;
      if(!pool.length)continue;
      // Pick a decent player — not their star, not their worst; middle of the pool
      const swapPlayer=pool[Math.min(Math.floor(pool.length/2),pool.length-1)];
      return{player,seller,buyer,amount,swapPlayer};
    }
  }
  return null;
}

function CareerTransferView({career,onUpdate}){
  const moods=career.playerMoods||{};
  const myTeam=career.teams.find(t=>t.id===career.myTeamId);
  const[pane,setPane]=useState('market');
  const[posFilter,setPosFilter]=useState('ALL');
  const[search,setSearch]=useState('');
  const[sel,setSel]=useState(null);
  const[bid,setBid]=useState('');
  const[tradePlayer,setTradePlayer]=useState(null);
  const[result,setResult]=useState(null);
  const[counterBid,setCounterBid]=useState(null);
  const[counterCashInput,setCounterCashInput]=useState('');
  const cpuBids=career.cpuBids||[];

  const resetBid=()=>{setSel(null);setBid('');setTradePlayer(null);};

  const windowOpen=career.matchWeek<=3;
  const otherPlayers=career.teams.filter(t=>t.id!==career.myTeamId&&t.name).flatMap(t=>t.players.map(p=>({...p,_team:t}))).filter(p=>p.position!=='GK');
  const filtered=otherPlayers.filter(p=>(posFilter==='ALL'||p.position===posFilter)&&(!search||p.name.toLowerCase().includes(search.toLowerCase())));

  const doTrade=(target,fromTeam,cashAmt,tradeP=null)=>{
    if((myTeam.careerBudget||0)<cashAmt){setResult({type:'no_budget',amount:cashAmt});return;}
    const{_team,...cleanTarget}=target;
    const record={id:Date.now(),playerId:target.id,playerName:target.name,fromTeam:fromTeam.name,toTeam:myTeam.name,amount:cashAmt,tradePlayerName:tradeP?.name||null,matchWeek:career.matchWeek};
    const updTeams=career.teams.map(t=>{
      if(t.id===fromTeam.id)return{...t,careerBudget:(t.careerBudget||0)+cashAmt,players:[...t.players.filter(p=>p.id!==target.id),...(tradeP?[{...tradeP,untouchable:false}]:[])]};
      if(t.id===career.myTeamId)return{...t,careerBudget:(t.careerBudget||0)-cashAmt,players:[...t.players.filter(p=>p.id!==target.id&&(!tradeP||p.id!==tradeP.id)),cleanTarget]};
      return t;
    });
    onUpdate({...career,teams:updTeams,transfers:[...career.transfers,record]});
    resetBid();
  };

  const submitBid=()=>{
    if(!sel)return;
    const cashAmt=parseInt(bid)||0;
    const tradeVal=tradePlayer?playerValue(tradePlayer,myTeam):0;
    if(cashAmt<=0&&!tradePlayer)return;
    const totalOffer=cashAmt+tradeVal;
    const targetVal=playerValue(sel,sel._team);
    const pct=targetVal>0?totalOffer/targetVal:0;
    if(pct>=.95){doTrade(sel,sel._team,cashAmt,tradePlayer);setResult({type:'accepted',player:sel,amount:cashAmt,tradePlayer});}
    else if(pct>=.75){
      const counterTotal=Math.round(targetVal*(.92+Math.random()*.06));
      const counterCash=Math.max(0,counterTotal-tradeVal);
      resetBid();setResult({type:'counter',player:sel,counter:counterCash,selTeam:sel._team,tradePlayer});
    }else if(pct>=.55){resetBid();setResult({type:'rejected',player:sel,amount:cashAmt});}
    else{resetBid();setResult({type:'flat',player:sel,amount:cashAmt});}
  };

  const toggleUntouchable=pid=>{
    const updTeams=career.teams.map(t=>t.id===career.myTeamId?{...t,players:t.players.map(p=>p.id===pid?{...p,untouchable:!p.untouchable}:p)}:t);
    onUpdate({...career,teams:updTeams});
  };
  const removeCpuBid=b=>onUpdate({...career,cpuBids:(career.cpuBids||[]).filter(cb=>cb.id!==b.id)});
  const acceptCpuBid=b=>{
    const{player,bidTeam,amount,swapPlayer}=b;
    const record={id:Date.now(),playerId:player.id,playerName:player.name,fromTeam:myTeam.name,toTeam:bidTeam.name,amount,tradePlayerName:swapPlayer?.name||null,matchWeek:career.matchWeek};
    const updTeams=career.teams.map(t=>{
      if(t.id===career.myTeamId)return{...t,careerBudget:(t.careerBudget||0)+amount,players:[...t.players.filter(p=>p.id!==player.id),...(swapPlayer?[{...swapPlayer,untouchable:false}]:[])]};
      if(t.id===bidTeam.id)return{...t,careerBudget:(t.careerBudget||0)-amount,players:[...t.players.filter(p=>!swapPlayer||p.id!==swapPlayer.id),{...player,untouchable:false}]};
      return t;
    });
    onUpdate({...career,teams:updTeams,transfers:[...career.transfers,record],cpuBids:(career.cpuBids||[]).filter(cb=>cb.id!==b.id)});
  };

  const submitCounterBid=()=>{
    if(!counterBid)return;
    const demandCash=parseInt(counterCashInput)||0;
    const{player,bidTeam,swapPlayer,negotiationRound=0}=counterBid;
    const myVal=playerValue(player,myTeam);
    const swapVal=swapPlayer?playerValue(swapPlayer,career.teams.find(t=>t.id===bidTeam.id)||bidTeam):0;
    const totalDemand=demandCash+swapVal;
    const pct=myVal>0?totalDemand/myVal:1;
    const isLastRound=negotiationRound>=1;
    if(pct<=0.75){
      // CPU accepts — deal done at user's terms
      acceptCpuBid({...counterBid,amount:demandCash});
      setCounterBid(null);setCounterCashInput('');
    } else if(pct<=0.90&&!isLastRound){
      // CPU meets in the middle — final offer
      const midCash=Math.round((demandCash+counterBid.amount)/2);
      const updBids=(career.cpuBids||[]).map(b=>b.id===counterBid.id?{...b,amount:midCash,negotiationRound:1,finalOffer:true}:b);
      onUpdate({...career,cpuBids:updBids});
      setCounterBid(null);setCounterCashInput('');
    } else {
      // CPU walks away — too greedy
      removeCpuBid(counterBid);
      setCounterBid(null);setCounterCashInput('');
    }
  };

  const valDisplay=(p,team)=>{
    const v=playerValue(p,team);const s=p.position==='MDF'?Math.max(p.mdfAtkScore||0,p.mdfDefScore||0):(p.score||0);
    if(valueKnown(p))return`£${v}M`;
    if(s>=5)return`£${Math.round(v*.8)}M–£${Math.round(v*1.2)}M`;
    return'Unknown';
  };
  const scoreDisplay=p=>{
    if(p.position==='GK')return'—';
    const s=p.position==='MDF'?p.mdfAtkScore:p.score;
    const max=p.position==='MDF'?Math.max(p.mdfAtkScore||0,p.mdfDefScore||0):(p.score||0);
    if(valueKnown(p))return String(s||5);
    if(max>=5)return`${Math.max(1,(s||5)-1)}–${Math.min(10,(s||5)+1)}`;
    return'?';
  };

  const resultColors={accepted:C.green,counter:C.gold,rejected:C.red,flat:C.red,no_budget:C.red};
  const resultMsg=r=>{
    if(r.type==='accepted'){const parts=[r.amount>0?`£${r.amount}M`:null,r.tradePlayer?`${r.tradePlayer.name}`:null].filter(Boolean);return`✓ Deal done! ${r.player.name} signed for ${parts.join(' + ')}`;}
    if(r.type==='counter'){const parts=[r.counter>0?`£${r.counter}M`:null,r.tradePlayer?`+ ${r.tradePlayer.name}`:null].filter(Boolean);return`Counter: they want ${parts.join(' ')} for ${r.player.name}`;}
    if(r.type==='flat')return'✕ Bid too low — increase offer or include a player';
    if(r.type==='no_budget')return`✕ Insufficient budget (need £${r.amount}M cash)`;
    if(r.type==='rejected')return'✕ Offer rejected';
    return'';
  };

  return(
    <div style={{paddingBottom:20}}>
      {cpuBids.length>0&&(
        <div style={{background:`${C.gold}15`,border:`1px solid ${C.gold}55`,borderRadius:10,padding:12,marginBottom:12}}>
          <div style={{fontSize:10,color:C.gold,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:8}}>Incoming Offers</div>
          {cpuBids.map(b=>(
            <div key={b.id} style={{marginBottom:8,background:C.card,borderRadius:8,overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px'}}>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:13,fontWeight:700,color:C.text}}>{b.player.name}</span>
                    {b.finalOffer&&<span style={{fontSize:9,color:C.red,fontWeight:700,letterSpacing:1,background:`${C.red}22`,borderRadius:3,padding:'1px 5px'}}>FINAL OFFER</span>}
                  </div>
                  <div style={{fontSize:10,color:C.muted,marginTop:1}}>{b.bidTeam.name} offer £{b.amount}M{b.swapPlayer?` + ${b.swapPlayer.name} (${b.swapPlayer.position})`:''}</div>
                </div>
                <Btn onClick={()=>acceptCpuBid(b)} variant="success" small>Accept</Btn>
                {!b.finalOffer&&<Btn onClick={()=>{setCounterBid(b);setCounterCashInput('');}} variant="secondary" small>Counter</Btn>}
                <Btn onClick={()=>{removeCpuBid(b);if(counterBid?.id===b.id){setCounterBid(null);setCounterCashInput('');}}} variant="secondary" small>Decline</Btn>
              </div>
              {counterBid?.id===b.id&&(
                <div style={{borderTop:`1px solid ${C.border}`,padding:'8px 10px',background:C.surface}}>
                  <div style={{fontSize:10,color:C.muted,marginBottom:6}}>How much cash do you want? (swap: {b.swapPlayer?.name||'none'} stays in deal)</div>
                  <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    <span style={{fontSize:12,color:C.muted}}>£</span>
                    <input type="number" min="0" value={counterCashInput} onChange={e=>setCounterCashInput(e.target.value)} placeholder="0" style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:'6px 8px',color:C.text,fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:'none'}}/>
                    <span style={{fontSize:12,color:C.muted}}>M</span>
                    <Btn onClick={submitCounterBid} small>Send</Btn>
                    <Btn onClick={()=>{setCounterBid(null);setCounterCashInput('');}} variant="secondary" small>Cancel</Btn>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{display:'flex',gap:6,marginBottom:12}}>
        {['market','squad'].map(p=>{const on=pane===p;return<button key={p} onClick={()=>setPane(p)} style={{flex:1,padding:'8px',borderRadius:7,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:12,background:on?`${C.accent}22`:'transparent',color:on?C.accent:C.muted,border:`1px solid ${on?C.accent:C.border}`}}>{p==='market'?'Transfer Market':'My Squad'}</button>;})}
      </div>
      {pane==='market'&&(
        <div>
          {!windowOpen&&<div style={{background:`${C.muted}18`,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 12px',marginBottom:12,fontSize:12,color:C.muted,textAlign:'center',fontWeight:600}}>Transfer window closed after MW3 — deals resume next season</div>}
          <div style={{opacity:windowOpen?1:0.4,pointerEvents:windowOpen?'auto':'none'}}>
          <div style={{display:'flex',gap:6,marginBottom:8}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search players…" style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:7,padding:'7px 10px',color:C.text,fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:'none'}}/>
            <select value={posFilter} onChange={e=>setPosFilter(e.target.value)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:7,padding:'7px 8px',color:C.muted,fontSize:12,fontFamily:"'DM Sans',sans-serif",outline:'none'}}>
              {['ALL','GK','DEF','MDF','FWD'].map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {result&&(
            <div style={{background:`${resultColors[result.type]}22`,border:`1px solid ${resultColors[result.type]}55`,borderRadius:8,padding:'10px 12px',marginBottom:10,display:'flex',alignItems:'center',gap:10}}>
              <div style={{flex:1,fontSize:13,color:C.text,fontWeight:600}}>{resultMsg(result)}</div>
              {result.type==='counter'&&<Btn onClick={()=>{doTrade(result.player,result.selTeam,result.counter,result.tradePlayer);setResult(null);}} variant="success" small>Accept</Btn>}
              <button onClick={()=>setResult(null)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:16}}>✕</button>
            </div>
          )}
          <div style={{maxHeight:400,overflowY:'auto'}}>
            {filtered.map(p=>{
              const isSel=sel?.id===p.id;
              const val=valDisplay(p,p._team);
              const cashAmt=parseInt(bid)||0;
              const tradeVal=tradePlayer?playerValue(tradePlayer,myTeam):0;
              const totalOffer=cashAmt+tradeVal;
              const targetVal=playerValue(p,p._team);
              const canSubmit=!!tradePlayer;
              return(
                <div key={p.id}>
                  <div onClick={()=>{setSel(isSel?null:p);setBid('');setTradePlayer(null);setResult(null);}} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:isSel?`${C.accent}15`:C.card,border:`1px solid ${isSel?C.accent:C.border}`,borderRadius:isSel?'8px 8px 0 0':8,marginBottom:isSel?0:6,cursor:'pointer'}}>
                    <div style={{background:posColor(p.position)+'22',color:posColor(p.position),borderRadius:4,padding:'2px 6px',fontSize:10,fontWeight:700,flexShrink:0}}>{p.position}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                      <div style={{fontSize:10,color:C.muted}}>{p._team.name}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:C.text}}>{scoreDisplay(p)}</div>
                      <div style={{fontSize:9,color:C.muted}}>{val}</div>
                    </div>
                  </div>
                  {isSel&&(
                    <div style={{background:C.surface,border:`1px solid ${C.accent}`,borderTop:'none',borderRadius:'0 0 8px 8px',padding:'12px',marginBottom:6}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                        <span style={{fontSize:10,color:C.muted,flexShrink:0,width:52}}>Cash (£M)</span>
                        <input value={bid} onChange={e=>setBid(e.target.value)} type="number" min="0" placeholder="0" style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:'6px 8px',color:C.text,fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:'none'}}/>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                        <span style={{fontSize:10,color:C.muted,flexShrink:0,width:52}}>Include</span>
                        <select value={tradePlayer?.id||''} onChange={e=>{const found=(myTeam?.players||[]).find(mp=>String(mp.id)===e.target.value);setTradePlayer(found||null);}} style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:'6px 8px',color:tradePlayer?C.text:C.muted,fontSize:12,fontFamily:"'DM Sans',sans-serif",outline:'none'}}>
                          <option value=''>Select a player (required)</option>
                          {(myTeam?.players||[]).map(mp=><option key={mp.id} value={mp.id}>{mp.name} ({mp.position}) — £{playerValue(mp,myTeam)}M</option>)}
                        </select>
                      </div>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                        <span style={{fontSize:11,color:totalOffer>=targetVal*.9?C.green:totalOffer>=targetVal*.65?C.gold:C.muted}}>
                          Total £{totalOffer}M vs {valDisplay(sel,sel._team)}
                        </span>
                        <Btn onClick={submitBid} small disabled={!canSubmit}>Submit Bid</Btn>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length===0&&<div style={{color:C.muted,fontSize:13,textAlign:'center',paddingTop:24,fontStyle:'italic'}}>No players found.</div>}
          </div>
          </div>
        </div>
      )}
      {pane==='squad'&&(
        <div>
          <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:8}}>Mark untouchable to block CPU bids</div>
          {(myTeam?.players||[]).map(p=>{
            const sat=moods[p.id]??65;
            const mi=moodInfo(sat);
            const wantsOut=sat<40;
            return(
              <div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:C.card,border:`1px solid ${wantsOut?C.red+'55':C.border}`,borderRadius:8,marginBottom:6}}>
                <div style={{background:posColor(p.position)+'22',color:posColor(p.position),borderRadius:4,padding:'2px 6px',fontSize:10,fontWeight:700}}>{p.position}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>{p.name}{wantsOut&&<span style={{fontSize:9,color:C.red,marginLeft:6,fontWeight:700}}>WANTS OUT</span>}</div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginTop:3}}>
                    <div style={{width:64,height:5,borderRadius:3,background:C.border,overflow:'hidden',flexShrink:0}}><div style={{width:`${sat}%`,height:'100%',background:mi.color,borderRadius:3}}/></div>
                    <span style={{fontSize:11,color:mi.color,fontWeight:700}}>{mi.label}</span>
                    <span style={{fontSize:10,color:C.muted}}>{valDisplay(p,myTeam)}</span>
                  </div>
                </div>
                <button onClick={()=>toggleUntouchable(p.id)} style={{background:p.untouchable?`${C.gold}22`:'transparent',border:`1px solid ${p.untouchable?C.gold:C.border}`,borderRadius:6,padding:'4px 10px',color:p.untouchable?C.gold:C.muted,fontSize:10,fontWeight:700,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>{p.untouchable?'🔒 Untouchable':'Lock'}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function genCareerNews(career){
  const articles=[];
  const myTeam=career.teams.find(t=>t.id===career.myTeamId);
  const myName=myTeam?.name||'Your team';
  const played=career.fixtures.filter(f=>f.played);
  const myPlayed=played.filter(f=>f.homeId===career.myTeamId||f.awayId===career.myTeamId);
  if(myPlayed.length>0){
    const last=myPlayed[myPlayed.length-1];
    const isH=last.homeId===career.myTeamId;
    const opp=career.teams.find(t=>t.id===(isH?last.awayId:last.homeId));
    const ms=isH?last.homeScore:last.awayScore,os=isH?last.awayScore:last.homeScore;
    const outcome=ms>os?'WIN':ms<os?'DEFEAT':'DRAW';
    const verb=ms>os?'beat':ms<os?'lost to':'drew with';
    articles.push({id:'result',tag:outcome,tagColor:ms>os?C.green:ms<os?C.red:C.gold,title:`MW${last.matchWeek}: ${myName} ${outcome}`,body:`${myName} ${verb} ${opp?.name||'their opponents'} ${ms}–${os}. ${ms>os?'A solid performance.':ms<os?'A tough night.':'A hard fought point.'}`});
  }
  const reg={};career.teams.forEach(t=>t.players.forEach(p=>{reg[p.id]={...p,teamName:t.name};}));
  const scorers=Object.entries(career.playerStats).filter(([_,s])=>(s.goals||0)>0).map(([id,s])=>({...reg[id],...s,id})).sort((a,b)=>(b.goals||0)-(a.goals||0));
  if(scorers.length>0){
    const top=scorers[0];
    articles.push({id:'scorer',tag:'GOLDEN BOOT',tagColor:C.gold,title:`${top.name} tops the charts`,body:`${top.name} leads the career scoring charts with ${top.goals} goal${top.goals!==1?'s':''} for ${top.teamName||'their club'}${scorers.length>1?`, ${scorers.length-1} ahead of ${scorers[1].name} on ${scorers[1].goals}`:''}.`});
  }
  const table=computeTable(career.teams,played);
  const myRow=table.find(r=>r.id===career.myTeamId);
  const myPos=table.findIndex(r=>r.id===career.myTeamId)+1;
  if(myRow&&played.length>0){
    const comment=myPos===1?'top of the league':myPos<=3?'in the promotion places':myPos>=table.length-2?'fighting to avoid the drop':'in mid-table';
    const leader=table[0];const leaderTeam=career.teams.find(t=>t.id===leader.id);
    articles.push({id:'table',tag:'LEAGUE',tagColor:C.accent,title:`${myName} ${comment}`,body:`${myName} sit ${ord(myPos)} with ${myRow.pts} point${myRow.pts!==1?'s':''} from ${myRow.p} game${myRow.p!==1?'s':''}. ${myPos>1?`${leaderTeam?.name||'The leaders'} lead on ${leader.pts} points.`:''}`});
  }
  if(career.transfers.length>0){
    const all=[...career.transfers].reverse();
    const cpuT=all.find(t=>t.cpuTrade);
    const userT=all.find(t=>!t.cpuTrade);
    if(cpuT)articles.push({id:'cpu_transfer',tag:'TRANSFER',tagColor:C.accent,title:`${cpuT.playerName} swaps clubs`,body:`${cpuT.playerName} moved from ${cpuT.fromTeam} to ${cpuT.toTeam} for £${cpuT.amount}M, with ${cpuT.swapPlayerName} heading the other way.`});
    if(userT){const dealStr=[userT.amount>0?`£${userT.amount}M`:null,userT.tradePlayerName?`${userT.tradePlayerName} going the other way`:null].filter(Boolean).join(' + ')||'a swap deal';articles.push({id:'transfer',tag:'TRANSFER',tagColor:C.accent,title:`${userT.playerName} arrives`,body:`${userT.playerName} moved from ${userT.fromTeam} to ${userT.toTeam} for ${dealStr} in Matchweek ${userT.matchWeek}.`});}
  }
  const myMoods=career.playerMoods||{};
  const unhappy=(myTeam?.players||[]).filter(p=>(myMoods[p.id]??65)<40).sort((a,b)=>(myMoods[a.id]??65)-(myMoods[b.id]??65));
  if(unhappy.length>0){
    const p=unhappy[0];const sat=myMoods[p.id]??0;
    articles.push({id:'mood_bad',tag:'SQUAD UNREST',tagColor:C.red,title:`${p.name} wants to leave`,body:`${p.name} has become deeply unhappy at ${myName} (morale: ${sat}/100) and is believed to be seeking a transfer. Giving them more playing time could help turn things around.`});
  } else {
    const happy=(myTeam?.players||[]).filter(p=>(myMoods[p.id]??65)>=80).length;
    if(happy>=3){
      articles.push({id:'mood_good',tag:'SQUAD HARMONY',tagColor:C.green,title:`High spirits at ${myName}`,body:`${happy} players are in excellent spirits at the club. Strong morale is translating into performances on the pitch.`});
    }
  }
  const injured=(myTeam?.players||[]).filter(p=>p.injured);
  if(injured.length>0){
    const names=injured.map(p=>p.name);
    const list=names.length===1?names[0]:names.length===2?`${names[0]} and ${names[1]}`:`${names.slice(0,-1).join(', ')} and ${names[names.length-1]}`;
    articles.push({id:'injury',tag:'INJURY',tagColor:'#F97316',title:`${injured.length===1?list+' sidelined':`${injured.length} players out injured`}`,body:`${list} ${injured.length===1?'is':'are'} sidelined through injury and will miss the next fixture. The manager will need to reshuffle the squad.`});
  }
  if(articles.length===0)articles.push({id:'empty',tag:'WELCOME',tagColor:C.muted,title:'Career mode — day one',body:`${myName} are ready for the season. Set your lineup and play your first match to get things started.`});
  return articles;
}

function CareerOpponentView({career}){
  const played=career.fixtures.filter(f=>f.played);
  const myFix=career.fixtures.find(f=>f.matchWeek===career.matchWeek&&(f.homeId===career.myTeamId||f.awayId===career.myTeamId));
  if(!myFix||myFix.played)return<div style={{color:C.muted,textAlign:'center',paddingTop:40,fontSize:13}}>No upcoming fixture to scout.</div>;
  const isHome=myFix.homeId===career.myTeamId;
  const myTeam=career.teams.find(t=>t.id===career.myTeamId);
  const opp=career.teams.find(t=>t.id===(isHome?myFix.awayId:myFix.homeId));
  if(!opp)return null;
  const lo=predictedLineup(opp,played);
  const pred=isHome?predictMatch(myTeam,opp):predictMatch(opp,myTeam);
  const myGoals=isHome?pred.hGoals:pred.aGoals;
  const oppGoals=isHome?pred.aGoals:pred.hGoals;
  const myXg=isHome?pred.hxg:pred.axg;
  const oppXg=isHome?pred.axg:pred.hxg;
  const oppPlayed=played.filter(f=>f.homeId===opp.id||f.awayId===opp.id).slice(-3);
  const form=oppPlayed.map(f=>{const h=f.homeId===opp.id;const gs=h?f.homeScore:f.awayScore,ga=h?f.awayScore:f.homeScore;return gs>ga?'W':gs<ga?'L':'D';});
  const Dot=({p})=>(
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,width:54}}>
      <div style={{width:34,height:34,borderRadius:'50%',background:opp.color,border:'2.5px solid rgba(255,255,255,0.9)',boxShadow:'0 2px 8px rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <span style={{fontSize:7,fontWeight:900,color:'rgba(255,255,255,0.95)',letterSpacing:.5}}>{p.position==='GK'?'GK':p.position}</span>
      </div>
      <span style={{fontSize:9,color:'#fff',fontWeight:700,textAlign:'center',lineHeight:1.2,textShadow:'0 1px 3px rgba(0,0,0,0.9)',maxWidth:54,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{(p.name||'?').trim().split(/\s+/).pop()}</span>
    </div>
  );
  const Row=({players})=>(
    <div style={{display:'flex',justifyContent:'center',gap:players.length===2?36:players.length===3?20:6,padding:'0 4px',alignItems:'center'}}>
      {players.map(p=><Dot key={p.id} p={p}/>)}
    </div>
  );
  return(
    <div style={{paddingBottom:20}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'14px 16px',marginBottom:12}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10,textAlign:'center'}}>MW{career.matchWeek} Prediction — {isHome?'Home':'Away'}</div>
        <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:12}}>
          <div style={{textAlign:'center',flex:1}}>
            <div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{myTeam?.name}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:56,lineHeight:1,color:myGoals>oppGoals?C.green:myGoals<oppGoals?C.red:C.gold}}>{myGoals}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:2}}>xG {myXg}</div>
          </div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.border,letterSpacing:4}}>vs</div>
          <div style={{textAlign:'center',flex:1}}>
            <div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{opp.name}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:56,lineHeight:1,color:oppGoals>myGoals?C.green:oppGoals<myGoals?C.red:C.gold}}>{oppGoals}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:2}}>xG {oppXg}</div>
          </div>
        </div>
        {form.length>0&&<div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:4,marginTop:10}}><span style={{fontSize:10,color:C.muted,marginRight:2}}>{opp.name} form:</span>{form.map((r,i)=><span key={i} style={{background:r==='W'?`${C.green}22`:r==='L'?`${C.red}22`:`${C.gold}22`,color:r==='W'?C.green:r==='L'?C.red:C.gold,borderRadius:4,padding:'2px 6px',fontSize:10,fontWeight:700}}>{r}</span>)}</div>}
      </div>
      <div style={{borderRadius:10,overflow:'hidden',position:'relative',background:'#1b6530'}}>
        <div style={{position:'absolute',inset:0,background:'repeating-linear-gradient(180deg,rgba(0,0,0,0) 0px,rgba(0,0,0,0) 36px,rgba(0,0,0,0.07) 36px,rgba(0,0,0,0.07) 72px)',pointerEvents:'none'}}/>
        <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}} viewBox="0 0 300 240" preserveAspectRatio="none">
          <rect x="8" y="6" width="284" height="228" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5"/>
          <rect x="82" y="6" width="136" height="68" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2"/>
          <rect x="114" y="6" width="72" height="24" fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="1"/>
        </svg>
        <div style={{position:'relative',zIndex:1,padding:'16px 10px 10px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,padding:'0 4px'}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:10,height:10,borderRadius:2,background:opp.color,flexShrink:0}}/><span style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.9)',letterSpacing:.5}}>{opp.name}</span></div>
            <span style={{fontSize:9,color:'rgba(255,255,255,0.5)',fontWeight:600,letterSpacing:1}}>{lo.formation?.label}</span>
          </div>
          {lo.gk&&<div style={{display:'flex',justifyContent:'center',marginBottom:22}}><Dot p={lo.gk}/></div>}
          {lo.defs.length>0&&<div style={{marginBottom:22}}><Row players={lo.defs}/></div>}
          {lo.mdfs.length>0&&<div style={{marginBottom:22}}><Row players={lo.mdfs}/></div>}
          {lo.fwds.length>0&&<div style={{marginBottom:8}}><Row players={lo.fwds}/></div>}
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:16,marginBottom:4}}>
            <div style={{flex:1,height:1,background:'rgba(255,255,255,0.2)'}}/><span style={{fontSize:8,color:'rgba(255,255,255,0.4)',fontWeight:700,letterSpacing:2,textTransform:'uppercase'}}>midfield</span><div style={{flex:1,height:1,background:'rgba(255,255,255,0.2)'}}/>
          </div>
        </div>
      </div>
    </div>
  );
}

function CareerNewsView({career}){
  const articles=useMemo(()=>genCareerNews(career),[career]);
  return(
    <div>
      {articles.map(a=>(
        <div key={a.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'12px 14px',marginBottom:10}}>
          <div style={{display:'inline-block',background:`${a.tagColor}22`,color:a.tagColor,fontSize:9,fontWeight:900,letterSpacing:2,borderRadius:4,padding:'2px 7px',textTransform:'uppercase',marginBottom:8}}>{a.tag}</div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:C.text,letterSpacing:.5,lineHeight:1.15,marginBottom:6}}>{a.title}</div>
          <div style={{fontSize:13,color:C.sub,lineHeight:1.55}}>{a.body}</div>
        </div>
      ))}
    </div>
  );
}

const CAREER_VIEWS=[{id:'hub',label:'Hub'},{id:'lineup',label:'Lineup'},{id:'sim',label:'Match'},{id:'transfers',label:'Transfers'},{id:'table',label:'Table'},{id:'stats',label:'Stats'},{id:'news',label:'News'}];

function CareerTab({teams}){
  const[career,setCareer]=useState(()=>loadCareer());
  const[view,setView]=useState('hub');
  const update=c=>{saveCareer(c);setCareer(c);};
  if(!career){return<CareerSetupView teams={teams} onStart={id=>{update(createCareer(id,teams));setView('hub');}}/>;}
  const myTeam=career.teams.find(t=>t.id===career.myTeamId);
  return(
    <div>
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:'10px 16px 0'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <TeamBadge color={myTeam?.color} crest={myTeam?.crest} size={28}/>
          <div style={{flex:1}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:C.text,letterSpacing:1,lineHeight:1}}>{myTeam?.name}</div>
            <div style={{fontSize:10,color:C.muted}}>Matchweek {career.matchWeek} · £{myTeam?.careerBudget??0}M</div>
          </div>
          <button onClick={()=>{if(window.confirm('Abandon career? This cannot be undone.')){localStorage.removeItem(CAREER_KEY);setCareer(null);}}} style={{background:'none',border:`1px solid ${C.border}`,borderRadius:5,color:C.muted,fontSize:10,padding:'3px 8px',cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>Abandon</button>
        </div>
        <div style={{display:'flex',overflowX:'auto',marginBottom:-1}}>
          {CAREER_VIEWS.map(v=><button key={v.id} onClick={()=>setView(v.id)} style={{background:'none',border:'none',cursor:'pointer',color:view===v.id?C.accent:C.muted,fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,padding:'6px 10px',whiteSpace:'nowrap',borderBottom:view===v.id?`2px solid ${C.accent}`:'2px solid transparent',flexShrink:0}}>{v.label}</button>)}
        </div>
      </div>
      <div style={{padding:16,paddingBottom:40}}>
        {view==='hub'      &&<CareerHubView career={career} onNav={setView}/>}
        {view==='table'    &&<CareerTableView career={career}/>}
        {view==='lineup'   &&<CareerLineupView career={career} onSave={lineup=>{update({...career,lineup});setView('hub');}}/>}
        {view==='sim'      &&<CareerSimView career={career} onMatchComplete={c=>{update(c);setView('hub');}}/>}
        {view==='transfers'&&<CareerTransferView career={career} onUpdate={update}/>}
        {view==='stats'    &&<CareerStatsView career={career}/>}
        {view==='news'     &&<CareerNewsView career={career}/>}
        {view==='opponent' &&<CareerOpponentView career={career}/>}
      </div>
    </div>
  );
}

const TABS=[
  {id:"fixtures",  label:"Fixtures"},
  {id:"table",     label:"Table"},
  {id:"stats",     label:"Stats"},
  {id:"ratings",   label:"Ratings"},
  {id:"squads",    label:"Squads"},
  {id:"transfers", label:"Transfers"},
  {id:"news",      label:"News"},
  {id:"odds",      label:"Odds"},
  {id:"create",    label:"Create"},
  {id:"career",    label:"Career"},
  {id:"manage",    label:"⚙ Manage"},
];

function App(){
  const[tab,setTab]=useState("fixtures");
  const[toast,setToast]=useState(null);
  const[loaded,setLoaded]=useState(false);
  const[showManagePrompt,setShowManagePrompt]=useState(false);
  const[teams,setTeams]=useState([]);
  const[fixtures,setFixtures]=useState([]);
  const[transfers,setTransfers]=useState([]);
  const[activeMatchWeek,setActiveMatchWeek]=useState(1);
  const[profilePlayer,setProfilePlayer]=useState(null);
  useEffect(()=>{
    loadState().then(data=>{
      setTeams(data?.teams?.length?data.teams:Array.from({length:12},(_,i)=>makeTeam(i+1)));
      setFixtures(data?.fixtures||[]);
      setTransfers(data?.transfers||[]);
      setActiveMatchWeek(data?.activeMatchWeek||1);
      setLoaded(true);
    });
  },[]);

  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(null),2500);};

  const handleExport=useCallback(()=>{
    const data=JSON.stringify({teams,fixtures,transfers},null,2);
    const blob=new Blob([data],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download=`bmls-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();URL.revokeObjectURL(url);
    showToast("📤 Exported!");
  },[teams,fixtures,transfers]);

  const handleImport=useCallback(async raw=>{
    try{
      const data=JSON.parse(raw);
      if(!data.teams||!data.fixtures)throw new Error("Invalid file");
      setTeams(data.teams);
      setFixtures(data.fixtures);
      setTransfers(data.transfers||[]);
      await syncTeams(data.teams);
      await Promise.all(data.fixtures.map(f=>syncFixture(f)));
      await Promise.all((data.transfers||[]).map(t=>syncTransfer(t)));
      showToast("📥 Imported & synced!");
    }catch{showToast("❌ Invalid file");}
  },[]);

  if(!loaded)return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:16}}>⚽</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:3,color:C.white,lineHeight:1}}>BMLS</div>
        <div style={{fontSize:12,color:C.muted,marginTop:8,letterSpacing:2,textTransform:"uppercase"}}>Loading...</div>
      </div>
    </div>
  );

  const named=teams.filter(t=>t.name).length;
  const played=fixtures.filter(f=>f.played).length;

  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans',sans-serif",color:C.text}}>
      {toast&&<div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:600,color:C.text,zIndex:999,boxShadow:"0 4px 20px #00000066",whiteSpace:"nowrap"}}>{toast}</div>}
      {profilePlayer&&<PlayerProfileModal data={profilePlayer} fixtures={fixtures} onClose={()=>setProfilePlayer(null)}/>}
      {showManagePrompt&&<ManagePasswordModal onSuccess={()=>{setShowManagePrompt(false);setTab('manage');}} onCancel={()=>setShowManagePrompt(false)}/>}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:720,margin:"0 auto",padding:"0 16px"}}>
          <div style={{paddingTop:16,display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
            <div style={{width:40,height:40,borderRadius:10,background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>⚽</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:3,color:C.white,lineHeight:1}}>BMLS</div>
              <div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginTop:1}}>{named}/12 Teams · MW{activeMatchWeek} · {played} Results</div>
            </div>
          </div>
          <div style={{display:"flex",gap:0,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
            {TABS.map(t=><button key={t.id} onClick={()=>{if(t.id==='manage'){setShowManagePrompt(true);}else{setTab(t.id);}}} style={{background:"transparent",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,color:tab===t.id?C.accent:C.sub,padding:"8px 11px",whiteSpace:"nowrap",borderBottom:tab===t.id?`2px solid ${C.accent}`:"2px solid transparent",marginBottom:-1}}>{t.label}</button>)}
          </div>
        </div>
      </div>
      <div style={{maxWidth:720,margin:"0 auto",padding:"24px 16px 100px"}}>
        {tab==="fixtures"&&<FixturesTab teams={teams} fixtures={fixtures} onPlayerClick={setProfilePlayer} activeMatchWeek={activeMatchWeek} onApplySim={(f,sim,h,a)=>{
          const sm={};
          const upd=(pid,tid,field,val)=>{if(!sm[pid])sm[pid]={playerId:pid,teamId:tid,goals:0,penGoals:0,assists:0,yellowCards:0,redCard:false,cleanSheet:false,rating:0};sm[pid][field]=typeof val==='boolean'?val:(sm[pid][field]||0)+val;};
          sim.events.forEach(e=>{const tid=e.team==='home'?h.id:a.id;if(e.type==='goal'){upd(e.player.id,tid,'goals',1);if(e.isPen)upd(e.player.id,tid,'penGoals',1);if(e.assist)upd(e.assist.id,tid,'assists',1);}else if(e.type==='yellow')upd(e.player.id,tid,'yellowCards',1);else if(e.type==='red')upd(e.player.id,tid,'redCard',true);});
          const hGK=h.players.find(p=>p.position==='GK');const aGK=a.players.find(p=>p.position==='GK');
          if(hGK&&sim.aGoals===0)upd(hGK.id,h.id,'cleanSheet',true);
          if(aGK&&sim.hGoals===0)upd(aGK.id,a.id,'cleanSheet',true);
          const nf={...f,played:true,homeScore:sim.hGoals,awayScore:sim.aGoals,playerStats:Object.values(sm)};
          setFixtures(fs=>fs.map(x=>x.id===nf.id?nf:x));syncFixture(nf);showToast('Result applied!');
        }}/>}
        {tab==="table"   &&<TableTab teams={teams} fixtures={fixtures}/>}
        {tab==="stats"   &&<StatsTab teams={teams} fixtures={fixtures}/>}
        {tab==="ratings" &&<RatingsTab teams={teams}/>}
        {tab==="squads"    &&<SquadsTab teams={teams} setTeams={setTeams}/>}
        {tab==="transfers" &&<TransfersTab transfers={transfers} teams={teams}/>}
        {tab==="news"      &&<NewsTab teams={teams} fixtures={fixtures} transfers={transfers} activeMatchWeek={activeMatchWeek}/>}
        {tab==="odds"      &&<OddsTab teams={teams} fixtures={fixtures} activeMatchWeek={activeMatchWeek}/>}
        {tab==="create"    &&<CreateTab teams={teams}/>}
        {tab==="career"    &&<CareerTab teams={teams}/>}
        {tab==="manage"    &&<ManageTab teams={teams} setTeams={setTeams} fixtures={fixtures} setFixtures={setFixtures} transfers={transfers} setTransfers={setTransfers} activeMatchWeek={activeMatchWeek} setActiveMatchWeek={setActiveMatchWeek} onExport={handleExport} onImport={handleImport} onToast={showToast}/>}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App/>)
