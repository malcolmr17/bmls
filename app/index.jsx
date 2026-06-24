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

const makeTeam=id=>({id,name:"",shortName:"",color:"#3B82F6",players:[],formation:"2-2-1"});
const makePlayer=()=>({id:Date.now()+Math.random(),name:"",position:"DEF",score:7,mdfAtkScore:7,mdfDefScore:7,injured:false,benched:false,wide:false,altPosition:null});
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

async function loadState(){try{const r=await fetch('/api/state');if(!r.ok)return null;return r.json();}catch{return null;}}
async function syncTeams(teams){try{await fetch('/api/teams',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(teams)});}catch(e){console.error('sync teams:',e);}}
async function syncFixture(f){try{await fetch(`/api/fixture/${f.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)});}catch(e){console.error('sync fixture:',e);}}
async function deleteFixture(id){try{await fetch(`/api/fixture/${id}`,{method:'DELETE'});}catch(e){console.error('delete fixture:',e);}}

function depthMultiplier(n){if(n<=1)return 0.9;if(n>=4)return 1.05;return 1.0;}

function lineupRatings(team){
  if(!team)return{atk:0,def:0};
  const active=team.players.filter(p=>!p.injured&&!p.benched);
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
  const available=team.players.filter(p=>!p.injured&&!p.benched);
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
  const fwds=[...primaryFwds];
  altPool.filter(p=>p.altPosition==="DEF"&&!altUsed.has(p.id)).slice(0,formation.def-defs.length).forEach(p=>{defs.push({...p,position:"DEF",wide:true});altUsed.add(p.id);});
  altPool.filter(p=>p.altPosition==="FWD"&&!altUsed.has(p.id)).slice(0,formation.fwd-fwds.length).forEach(p=>{fwds.push({...p,position:"FWD",wide:true});altUsed.add(p.id);});
  return{gk:gk||null,defs:arrangeWide(defs),mdfs:primaryMdfs,fwds:arrangeWide(fwds),formation};
}

function predictMatch(home,away){
  const h=lineupRatings(home),a=lineupRatings(away);
  const hxg=+((1.4*(h.atk+0.4)/Math.max(a.def,0.5))*0.85).toFixed(1);
  const axg=+((1.4*a.atk/Math.max(h.def,0.5))*0.85).toFixed(1);
  return{hxg,axg,hGoals:Math.round(hxg),aGoals:Math.round(axg)};
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
const Btn=({children,onClick,variant="primary",small})=>{
  const bg=variant==="primary"?C.accent:variant==="danger"?"#7f1d1d":variant==="success"?"#14532d":variant==="export"?"#1e3a5f":C.border;
  const col=variant==="danger"?"#fca5a5":variant==="success"?"#86efac":variant==="export"?"#93c5fd":C.white;
  return <button onClick={onClick} style={{background:bg,color:col,border:"none",borderRadius:6,cursor:"pointer",padding:small?"5px 10px":"8px 16px",fontSize:small?12:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>{children}</button>;
};
const SLabel=({children})=><div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:"uppercase",marginBottom:10}}>{children}</div>;
const TeamBadge=({color,size=28})=><span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:size,height:size,borderRadius:6,background:color,fontSize:size*0.45,flexShrink:0}}>⚽</span>;
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

function FieldLineup({home,away,fixtures}){
  if(!home||!away)return null;
  const hl=predictedLineup(home,fixtures);
  const al=predictedLineup(away,fixtures);
  const homeRows=[hl.defs,hl.mdfs,hl.fwds].filter(r=>r.length>0);
  const awayRows=[al.fwds,al.mdfs,al.defs].filter(r=>r.length>0);
  const Dot=({p,color})=>(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,width:54}}>
      <div style={{width:34,height:34,borderRadius:"50%",background:color,border:"2.5px solid rgba(255,255,255,0.9)",boxShadow:"0 2px 8px rgba(0,0,0,0.5)",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <span style={{fontSize:7,fontWeight:900,color:"rgba(255,255,255,0.95)",letterSpacing:.5,textShadow:"0 1px 2px rgba(0,0,0,0.4)"}}>{p.position==="GK"?"GK":p.position}</span>
      </div>
      <span style={{fontSize:9,color:"#fff",fontWeight:700,textAlign:"center",lineHeight:1.2,textShadow:"0 1px 3px rgba(0,0,0,0.9)",maxWidth:54,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>{(p.name||"?").trim().split(/\s+/).pop()||"?"}</span>
    </div>
  );
  const PlayerRow=({players,color})=>(
    <div style={{display:"flex",justifyContent:players.length===2?"space-between":"center",gap:players.length===2?0:6,padding:players.length===2?"0 8px":"0 4px",flexWrap:"wrap"}}>
      {players.map(p=><Dot key={p.id} p={p} color={color}/>)}
    </div>
  );
  return(
    <div style={{position:"relative",borderRadius:10,overflow:"hidden",background:"#1b6530"}}>
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
        {hl.gk&&<div style={{display:"flex",justifyContent:"center",marginBottom:28}}><Dot p={hl.gk} color={home.color}/></div>}
        {homeRows.map((row,i)=><div key={i} style={{marginBottom:28}}><PlayerRow players={row} color={home.color}/></div>)}
        <div style={{display:"flex",alignItems:"center",gap:8,margin:"20px 0"}}>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,0.15)"}}/><span style={{fontSize:8,color:"rgba(255,255,255,0.4)",fontWeight:700,letterSpacing:2,textTransform:"uppercase"}}>kick off</span><div style={{flex:1,height:1,background:"rgba(255,255,255,0.15)"}}/>
        </div>
        {awayRows.map((row,i)=><div key={i} style={{marginBottom:28}}><PlayerRow players={row} color={away.color}/></div>)}
        {al.gk&&<div style={{display:"flex",justifyContent:"center",marginBottom:24}}><Dot p={al.gk} color={away.color}/></div>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 4px"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:2,background:away.color,flexShrink:0}}/><span style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.9)",letterSpacing:.5}}>{away.name}</span></div>
          <span style={{fontSize:9,color:"rgba(255,255,255,0.5)",fontWeight:600,letterSpacing:1}}>{al.formation.label}</span>
        </div>
      </div>
    </div>
  );
}

function FixturesTab({teams,fixtures}){
  const[filter,setFilter]=useState("all");
  const[expandedId,setExpandedId]=useState(null);
  const currentMW=useMemo(()=>currentMatchWeek(fixtures),[fixtures]);
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
                    <TeamBadge color={h.color} size={26}/>
                  </div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:f.played?26:15,color:f.played?C.gold:C.muted,background:C.surface,borderRadius:8,padding:"6px 16px",textAlign:"center",letterSpacing:2,minWidth:80}}>
                    {f.played?`${f.homeScore}  ${f.awayScore}`:"vs"}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <TeamBadge color={a.color} size={26}/>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:C.text,letterSpacing:.5}}>{a.name}</span>
                  </div>
                </div>
                {expanded&&!f.played&&(f.matchWeek==null||f.matchWeek===currentMW)&&(
                  <div style={{borderTop:`1px solid ${C.border}`,padding:"14px 14px",background:C.surface}}>
                    <div style={{fontSize:13,fontWeight:800,letterSpacing:2,color:C.text,textTransform:"uppercase",textAlign:"center",marginBottom:14}}>Predicted Lineups</div>
                    <FieldLineup home={h} away={a} fixtures={fixtures}/>
                    <div style={{fontSize:10,color:C.muted,marginTop:8,textAlign:"center"}}>Based on form & availability</div>
                  </div>
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
                    <TeamBadge color={row.color} size={22}/>
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
  const allPlayers=teams.flatMap(t=>t.players.filter(p=>p.name&&p.position!=="GK").map(p=>({...p,teamName:t.name,teamColor:t.color,teamShort:t.shortName||(t.name&&t.name.slice(0,3).toUpperCase())})));
  const sorted=[...allPlayers].map(p=>({...p,val:getPlayerVal(p,metric)})).filter(p=>p.val>0).sort((a,b)=>b.val-a.val);
  if(allPlayers.length===0)return<Empty icon="🎖️" msg="No players yet." hint="Go to Manage → Teams."/>;
  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        {[{key:"atk",label:"Attack",color:C.red},{key:"def",label:"Defense",color:C.green}].map(m=>(
          <button key={m.key} onClick={()=>setMetric(m.key)} style={{background:metric===m.key?m.color:C.card,color:metric===m.key?"#000":C.sub,border:"none",borderRadius:6,padding:"7px 16px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{m.label}</button>
        ))}
      </div>
      <SLabel>Team Ratings</SLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:24}}>
        {teamStats.map(t=>{const val=metric==="atk"?t.atk:t.def,color=metric==="atk"?C.red:C.green;return(
          <div key={t.id} style={{background:C.card,borderRadius:8,padding:"12px 14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <TeamBadge color={t.color} size={20}/>
              <span style={{fontSize:13,fontWeight:600,color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</span>
              <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color}}>{val||"—"}</span>
            </div>
            <div style={{height:4,background:C.border,borderRadius:2,overflow:"hidden"}}><div style={{width:`${((val||0)/10)*100}%`,height:"100%",background:color,borderRadius:2}}/></div>
          </div>
        );})}
      </div>
      <SLabel>Top Players</SLabel>
      {sorted.slice(0,12).map((p,i)=>{const color=metric==="atk"?C.red:C.green;return(
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
  );
}

function SquadsTab({teams,setTeams}){
  const named=teams.filter(t=>t.name&&t.players.length>0);
  const[selId,setSelId]=useState(null);
  const team=teams.find(t=>t.id===selId);
  const toggle=(pid,field)=>{
    const nt=teams.map(t=>t.id!==selId?t:{...t,players:t.players.map(p=>p.id!==pid?p:{...p,[field]:!p[field],...(field==="benched"&&!p.benched?{injured:false}:{}),...(field==="injured"&&!p.injured?{benched:false}:{})})});
    setTeams(nt);syncTeams(nt);
  };
  const setFormation=fid=>{const nt=teams.map(t=>t.id!==selId?t:{...t,formation:fid});setTeams(nt);syncTeams(nt);};
  if(named.length===0)return<Empty icon="📋" msg="No teams with players yet." hint="Go to Manage → Teams first."/>;
  const ratings=team?lineupRatings(team):null;
  const activeOut=team?team.players.filter(p=>p.position!=="GK"&&!p.injured&&!p.benched):[];
  const gk=team?team.players.find(p=>p.position==="GK"&&!p.injured&&!p.benched):null;
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
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {FORMATIONS.map(f=><button key={f.id} onClick={()=>setFormation(f.id)} style={{background:(team.formation||"2-2-1")===f.id?C.accent:C.card,color:(team.formation||"2-2-1")===f.id?C.white:C.sub,border:`1px solid ${(team.formation||"2-2-1")===f.id?C.accent:C.border}`,borderRadius:6,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{f.label}</button>)}
          </div>
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
                const active=!p.injured&&!p.benched,isGK=p.position==="GK";
                const widePrefix=p.wide&&(p.position==="DEF"||p.position==="FWD")?"Wide ":"";
                const altLabel=p.position==="MDF"&&p.altPosition?` · Also ${p.altPosition}`:"";
                const scoreLabel=isGK?"Not rated":p.position==="FWD"?`${widePrefix}ATK ${p.score}`:p.position==="DEF"?`${widePrefix}DEF ${p.score}`:`ATK ${p.mdfAtkScore} · DEF ${p.mdfDefScore}${altLabel}`;
                return(
                  <div key={p.id} style={{background:active?C.card:C.surface,border:`1px solid ${active?C.border:C.border+"44"}`,borderRadius:8,padding:"11px 14px",marginBottom:7,opacity:p.injured?0.5:1,display:"flex",alignItems:"center",gap:12}}>
                    <div style={{background:posColor(p.position)+"22",color:posColor(p.position),borderRadius:5,padding:"3px 7px",fontSize:10,fontWeight:700,minWidth:36,textAlign:"center",flexShrink:0}}>{p.position}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,fontWeight:600,color:active?C.text:C.muted}}>{p.name||"Unnamed"}</div>
                      <div style={{fontSize:11,color:C.muted,marginTop:2}}>{scoreLabel}</div>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>toggle(p.id,"benched")} style={{background:p.benched?`${C.gold}33`:"transparent",color:p.benched?C.gold:C.muted,border:`1px solid ${p.benched?C.gold:C.border}`,borderRadius:5,padding:"4px 9px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Bench</button>
                      <button onClick={()=>toggle(p.id,"injured")} style={{background:p.injured?`${C.red}33`:"transparent",color:p.injured?C.red:C.muted,border:`1px solid ${p.injured?C.red:C.border}`,borderRadius:5,padding:"4px 9px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Injury</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {team.players.some(p=>p.benched||p.injured)&&(
          <div style={{marginTop:8,background:C.surface,borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Out</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {team.players.filter(p=>p.benched||p.injured).map(p=><span key={p.id} style={{background:p.injured?`${C.red}22`:`${C.gold}22`,color:p.injured?C.red:C.gold,border:`1px solid ${p.injured?C.red:C.gold}44`,borderRadius:5,padding:"3px 9px",fontSize:11,fontWeight:600}}>{p.name||"Unnamed"} · {p.injured?"Injured":"Bench"}</span>)}
            </div>
          </div>
        )}
      </div>}
    </div>
  );
}

function OddsTab({teams,fixtures}){
  const hasMW=fixtures.some(f=>f.matchWeek!=null);
  const currentMW=hasMW?currentMatchWeek(fixtures):null;
  const upcoming=fixtures.filter(f=>!f.played&&f.homeId&&f.awayId&&(!hasMW||f.matchWeek===currentMW));
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
                  <TeamBadge color={h.color} size={30}/>
                  <div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:C.text}}>{h.name}</div><div style={{fontSize:10,color:C.muted}}>ATK {hr.atk} · DEF {hr.def}</div></div>
                </div>
                <div style={{textAlign:"center",fontFamily:"'Bebas Neue',sans-serif",fontSize:13,color:C.muted,letterSpacing:2}}>VS</div>
                <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end"}}>
                  <div style={{textAlign:"right"}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:C.text}}>{a.name}</div><div style={{fontSize:10,color:C.muted}}>ATK {ar.atk} · DEF {ar.def}</div></div>
                  <TeamBadge color={a.color} size={30}/>
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

function ManageTab({teams,setTeams,fixtures,setFixtures,onExport,onImport,onToast}){
  const[view,setView]=useState("teams");
  const[editTeam,setEditTeam]=useState(null);
  const[editFix,setEditFix]=useState(null);
  const named=teams.filter(t=>t.name);
  const importRef=useRef();

  const saveTeam=t=>{const nt=teams.map(x=>x.id===t.id?t:x);setTeams(nt);syncTeams(nt);setEditTeam(null);};
  const addPlayer=t=>{if(t.players.length<8)setEditTeam({...t,players:[...t.players,makePlayer()]});};
  const updPlayer=(t,pid,field,val)=>setEditTeam({...t,players:t.players.map(p=>p.id===pid?{...p,[field]:val}:p)});
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
        {["teams","fixtures"].map(v=>(
          <button key={v} onClick={()=>{setView(v);setEditTeam(null);setEditFix(null);}} style={{background:view===v?C.accent:C.card,color:view===v?C.white:C.sub,border:"none",borderRadius:6,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",textTransform:"capitalize"}}>{v}</button>
        ))}
      </div>
      {view==="teams"&&!editTeam&&(
        <div>
          <SLabel>12 Teams — click to edit</SLabel>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {teams.map(t=>(
              <div key={t.id} onClick={()=>setEditTeam({...t,players:t.players.map(p=>({...p}))})} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                <TeamBadge color={t.name?t.color:C.border} size={32}/>
                <div><div style={{fontWeight:600,fontSize:14,color:t.name?C.text:C.muted}}>{t.name||`Team ${t.id}`}</div><div style={{fontSize:11,color:C.muted}}>{t.players.length}/8{t.shortName?` · ${t.shortName}`:""}</div></div>
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
          </div>
          <div style={{marginBottom:20}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:4}}>Team Colour</div>
            <input type="color" value={editTeam.color} onChange={e=>setEditTeam({...editTeam,color:e.target.value})} style={{width:48,height:32,border:"none",background:"none",cursor:"pointer"}}/>
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
            <div style={{marginBottom:12}}><div style={{fontSize:11,color:C.muted,marginBottom:4}}>Date</div><Inp type="date" value={editFix.date} onChange={v=>setEditFix({...editFix,date:v})}/></div>
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
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}><TeamBadge color={team.color} size={20}/><span style={{fontWeight:700,fontSize:14,color:C.text}}>{team.name}</span></div>
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
      {!editTeam&&!editFix&&(
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

const TABS=[
  {id:"fixtures",label:"Fixtures"},
  {id:"table",   label:"Table"},
  {id:"stats",   label:"Stats"},
  {id:"ratings", label:"Ratings"},
  {id:"squads",  label:"Squads"},
  {id:"odds",    label:"Odds"},
  {id:"manage",  label:"⚙ Manage"},
];

function App(){
  const[tab,setTab]=useState("fixtures");
  const[toast,setToast]=useState(null);
  const[loaded,setLoaded]=useState(false);
  const[teams,setTeams]=useState([]);
  const[fixtures,setFixtures]=useState([]);

  useEffect(()=>{
    loadState().then(data=>{
      setTeams(data?.teams?.length?data.teams:Array.from({length:12},(_,i)=>makeTeam(i+1)));
      setFixtures(data?.fixtures||[]);
      setLoaded(true);
    });
  },[]);

  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(null),2500);};

  const handleExport=useCallback(()=>{
    const data=JSON.stringify({teams,fixtures},null,2);
    const blob=new Blob([data],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download=`bmls-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();URL.revokeObjectURL(url);
    showToast("📤 Exported!");
  },[teams,fixtures]);

  const handleImport=useCallback(async raw=>{
    try{
      const data=JSON.parse(raw);
      if(!data.teams||!data.fixtures)throw new Error("Invalid file");
      setTeams(data.teams);
      setFixtures(data.fixtures);
      await syncTeams(data.teams);
      await Promise.all(data.fixtures.map(f=>syncFixture(f)));
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
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:720,margin:"0 auto",padding:"0 16px"}}>
          <div style={{paddingTop:16,display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
            <div style={{width:40,height:40,borderRadius:10,background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>⚽</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:3,color:C.white,lineHeight:1}}>BMLS</div>
              <div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginTop:1}}>{named}/12 Teams · {played} Results</div>
            </div>
          </div>
          <div style={{display:"flex",gap:0,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
            {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{background:"transparent",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,color:tab===t.id?C.accent:C.sub,padding:"8px 11px",whiteSpace:"nowrap",borderBottom:tab===t.id?`2px solid ${C.accent}`:"2px solid transparent",marginBottom:-1}}>{t.label}</button>)}
          </div>
        </div>
      </div>
      <div style={{maxWidth:720,margin:"0 auto",padding:"24px 16px 100px"}}>
        {tab==="fixtures"&&<FixturesTab teams={teams} fixtures={fixtures}/>}
        {tab==="table"   &&<TableTab teams={teams} fixtures={fixtures}/>}
        {tab==="stats"   &&<StatsTab teams={teams} fixtures={fixtures}/>}
        {tab==="ratings" &&<RatingsTab teams={teams}/>}
        {tab==="squads"  &&<SquadsTab teams={teams} setTeams={setTeams}/>}
        {tab==="odds"    &&<OddsTab teams={teams} fixtures={fixtures}/>}
        {tab==="manage"  &&<ManageTab teams={teams} setTeams={setTeams} fixtures={fixtures} setFixtures={setFixtures} onExport={handleExport} onImport={handleImport} onToast={showToast}/>}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App/>)
