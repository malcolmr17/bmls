import React,{useState,useRef,useEffect,useMemo}from'react'
import{createRoot}from'react-dom/client'

const C={
  bg:"#0a0e1a",surface:"#0f1624",card:"#141b2d",border:"#1a2540",
  accent:"#3B82F6",gold:"#F59E0B",green:"#22C55E",red:"#EF4444",
  muted:"#64748B",sub:"#94A3B8",text:"#E2E8F0",white:"#F8FAFC",purple:"#A855F7"
};
const POSITIONS=["GK","DEF","MDF","FWD"];
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

function simWCMatch(home,away){
  const hr=lineupRatings(home),ar=lineupRatings(away);
  const hxg=Math.max(0.1,hr.atk*0.14+(10-ar.def)*0.09+0.25);
  const axg=Math.max(0.1,ar.atk*0.14+(10-hr.def)*0.09+0.25);
  const pois=λ=>{const L=Math.exp(-Math.min(λ,8));let k=0,p=1;do{k++;p*=Math.random();}while(p>L);return k-1;};
  return{hGoals:pois(hxg),aGoals:pois(axg)};
}
function simWCKnockout(home,away){
  const r=simWCMatch(home,away);
  if(r.hGoals===r.aGoals)return Math.random()<0.5?{...r,hGoals:r.hGoals+1,et:true}:{...r,aGoals:r.aGoals+1,et:true};
  return r;
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

// ── NationsManageView ────────────────────────────────────────────────────────
function NationsManageView({nations,setNations,teams,onToast}){
  const[editNation,setEditNation]=useState(null);
  const[addMode,setAddMode]=useState(null);
  const[search,setSearch]=useState('');
  const[newPlayer,setNewPlayer]=useState(null);
  const flagRef=useRef();
  const allBmlsPlayers=(teams||[]).flatMap(t=>t.players.map(p=>({...p,club:t.name,clubColor:t.color})));
  const filtered=allBmlsPlayers.filter(p=>p.name&&p.name.toLowerCase().includes(search.toLowerCase()));
  const saveNation=n=>{const nn=nations.map(x=>x.id===n.id?n:x);setNations(nn);syncNations(nn);};
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
        {editNation.players.map(p=>(
          <div key={p.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 12px',marginBottom:6,display:'flex',alignItems:'center',gap:10}}>
            <div style={{background:posColor(p.position)+"22",color:posColor(p.position),borderRadius:4,padding:'2px 6px',fontSize:10,fontWeight:700,flexShrink:0}}>{p.position}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:C.text}}>{p.name}</div>
              <div style={{fontSize:11,color:C.muted}}>{p.club||'—'}</div>
            </div>
            <button onClick={()=>{const u={...editNation,players:editNation.players.filter(x=>x.id!==p.id)};setEditNation(u);saveNation(u);}} style={{background:'none',border:'none',color:C.red,fontSize:16,cursor:'pointer',padding:'0 4px'}}>×</button>
          </div>
        ))}
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
function GroupDrawView({nations,wcMeta,onSaveGroups,onToast}){
  const named=nations.filter(n=>n.name);
  const[groups,setGroups]=useState({A:[null,null,null],B:[null,null,null],C:[null,null,null],D:[null,null,null]});
  const allAssigned=Object.values(groups).flat().filter(Boolean);
  const available=named.filter(n=>!allAssigned.includes(n.id));
  const setSlot=(gid,idx,nid)=>{
    const prev=Object.entries(groups).find(([,slots])=>slots.includes(nid));
    if(prev&&prev[0]!==gid){const[pg,ps]=prev;const ns=[...ps];ns[ns.indexOf(nid)]=null;setGroups(g=>({...g,[pg]:ns}));}
    setGroups(g=>{const s=[...g[gid]];s[idx]=nid?Number(nid):null;return{...g,[gid]:s};});
  };
  const valid=GROUPS.every(g=>groups[g].filter(Boolean).length===3)&&new Set(allAssigned).size===allAssigned.length;
  const save=()=>{
    if(!valid){onToast('Each group needs exactly 3 different nations.');return;}
    const g=GROUPS.map(id=>({id,nationIds:groups[id].map(Number)}));
    onSaveGroups(g);
  };
  const sel={background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:'7px 10px',color:C.text,fontSize:13,fontFamily:"'DM Sans',sans-serif",width:'100%',outline:'none'};
  return(
    <div>
      <div style={{background:'linear-gradient(135deg,#0a1628 0%,#0f2044 50%,#0a1628 100%)',border:`1px solid #1a3060`,borderRadius:12,padding:'20px',marginBottom:20,textAlign:'center'}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:C.gold,letterSpacing:4}}>GROUP DRAW</div>
        <div style={{fontSize:12,color:C.muted,marginTop:4}}>Assign 12 nations to 4 groups of 3</div>
      </div>
      {named.length<12&&<div style={{background:C.surface,border:`1px solid ${C.gold}44`,borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:C.gold}}>⚠ Only {named.length}/12 nations set up. Go to Manage → Nations to add more.</div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20}}>
        {GROUPS.map(gid=>(
          <div key={gid} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:C.gold,letterSpacing:2,marginBottom:10}}>Group {gid}</div>
            {[0,1,2].map(i=>{
              const nid=groups[gid][i];
              const nation=nid?nations.find(n=>n.id===nid):null;
              return(
                <div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                  {nation&&<TeamBadge color={nation.color} crest={nation.crest} size={20}/>}
                  <select value={nid||''} onChange={e=>setSlot(gid,i,e.target.value||null)} style={sel}>
                    <option value="">— pick nation —</option>
                    {named.map(n=><option key={n.id} value={n.id} disabled={allAssigned.includes(n.id)&&n.id!==nid}>{n.name}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <Btn onClick={save} style={{width:'100%',opacity:valid?1:0.5}}>Set Groups & Generate Fixtures</Btn>
    </div>
  );
}

// ── GroupCard ────────────────────────────────────────────────────────────────
function GroupCard({group,nations,groupMatches,onResult,onSim}){
  const ms=getGroupMatches(group.id,groupMatches);
  const standings=computeStandings(group.nationIds,ms,nations);
  const[hi,setHi]=useState({});const[ai,setAi]=useState({});
  const inp={background:C.surface,border:`1px solid ${C.border}`,borderRadius:5,padding:'5px 0',color:C.text,fontSize:15,fontFamily:"'Bebas Neue',sans-serif",outline:'none',width:'100%',textAlign:'center'};
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:14,marginBottom:16}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:C.gold,letterSpacing:3,marginBottom:10}}>Group {group.id}</div>
      <table style={{width:'100%',borderCollapse:'collapse',marginBottom:14,fontSize:11}}>
        <thead><tr style={{color:C.muted}}><th style={{textAlign:'left',paddingBottom:6,fontWeight:600}}>Nation</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th style={{color:C.gold}}>Pts</th></tr></thead>
        <tbody>
          {standings.map((s,i)=>{
            const n=s.nation;
            return(
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
            );
          })}
        </tbody>
      </table>
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:8}}>Fixtures</div>
        {GROUP_PAIRS.map(([ai2,bi2],idx)=>{
          const m=ms[idx];
          const hNation=nations.find(n=>n.id===group.nationIds[ai2]);
          const aNation=nations.find(n=>n.id===group.nationIds[bi2]);
          const mid=`wc_gm_${group.id}${idx+1}`;
          const hv=hi[mid]??'',av=ai[mid]??'';
          const canSave=hv!==''&&av!==''&&!isNaN(parseInt(hv))&&!isNaN(parseInt(av));
          if(m?.played){
            return(
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
            );
          }
          return(
            <div key={idx} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 12px',marginBottom:8}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:8,marginBottom:8}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:5,overflow:'hidden'}}>
                  <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{hNation?.name||'?'}</span>
                  <TeamBadge color={hNation?.color||C.border} crest={hNation?.crest} size={16}/>
                </div>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:C.muted,letterSpacing:2,textAlign:'center'}}>vs</span>
                <div style={{display:'flex',alignItems:'center',gap:5,overflow:'hidden'}}>
                  <TeamBadge color={aNation?.color||C.border} crest={aNation?.crest} size={16}/>
                  <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{aNation?.name||'?'}</span>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 20px 1fr',gap:4,alignItems:'center',marginBottom:8}}>
                <input type="number" min="0" value={hv} onChange={e=>setHi(x=>({...x,[mid]:e.target.value}))} placeholder="0" style={inp}/>
                <div style={{textAlign:'center',color:C.muted,fontFamily:"'Bebas Neue',sans-serif"}}>–</div>
                <input type="number" min="0" value={av} onChange={e=>setAi(x=>({...x,[mid]:e.target.value}))} placeholder="0" style={inp}/>
              </div>
              <div style={{display:'flex',gap:6}}>
                <Btn onClick={()=>{if(canSave)onResult(mid,group.nationIds[ai2],group.nationIds[bi2],parseInt(hv),parseInt(av));}} style={{flex:1,fontSize:11,opacity:canSave?1:0.4}}>Save</Btn>
                <Btn onClick={()=>onSim(mid,group,ai2,bi2)} variant="secondary" style={{flex:1,fontSize:11}}>▶ Sim</Btn>
              </div>
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
  const onSim=(mid,group,ai2,bi2)=>{
    const hNation=nations.find(n=>n.id===group.nationIds[ai2]);
    const aNation=nations.find(n=>n.id===group.nationIds[bi2]);
    if(!hNation||!aNation)return;
    const r=simWCMatch(hNation,aNation);
    onResult(mid,group.nationIds[ai2],group.nationIds[bi2],r.hGoals,r.aGoals);
  };
  const resetGroups=async()=>{
    if(!confirm('Reset group draw? Match results will also be cleared.'))return;
    const toDelete=[...(wcMeta?.groups||[]).flatMap(g=>GROUP_PAIRS.map((_,i)=>`wc_gm_${g.id}${i+1}`)),'wc_meta'];
    await Promise.all(toDelete.map(deleteFixture));
    setWcMeta(null);setGroupMatches([]);
  };
  if(!wcMeta?.groups){return<div style={{paddingBottom:40}}><GroupDrawView nations={nations} wcMeta={wcMeta} onSaveGroups={saveGroups} onToast={showToast}/>{toast&&<div style={{position:'fixed',bottom:80,left:'50%',transform:'translateX(-50%)',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 18px',fontSize:13,color:C.text,zIndex:50,whiteSpace:'nowrap'}}>{toast}</div>}</div>;}
  return(
    <div style={{paddingBottom:40}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:C.gold,letterSpacing:3}}>Group Stage</div>
        <button onClick={resetGroups} style={{background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>Reset Draw</button>
      </div>
      {wcMeta.groups.map(g=><GroupCard key={g.id} group={g} nations={nations} groupMatches={groupMatches} onResult={onResult} onSim={onSim}/>)}
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

function KnockoutMatchCard({match,nations,onResult,onSim,disabled}){
  const[hi,setHi]=useState('');const[ai,setAi]=useState('');
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
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 14px',marginBottom:8,opacity:disabled?0.6:1}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:8,marginBottom:8}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:5,overflow:'hidden'}}>
          <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{hN?.name||'TBD'}</span>
          <TeamBadge color={hN?.color||C.border} crest={hN?.crest} size={16}/>
        </div>
        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:C.muted,letterSpacing:2}}>vs</span>
        <div style={{display:'flex',alignItems:'center',gap:5,overflow:'hidden'}}>
          <TeamBadge color={aN?.color||C.border} crest={aN?.crest} size={16}/>
          <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{aN?.name||'TBD'}</span>
        </div>
      </div>
      {!disabled&&<>
        <div style={{display:'grid',gridTemplateColumns:'1fr 20px 1fr',gap:4,alignItems:'center',marginBottom:8}}>
          <input type="number" min="0" value={hi} onChange={e=>setHi(e.target.value)} placeholder="0" style={inp}/>
          <div style={{textAlign:'center',color:C.muted,fontFamily:"'Bebas Neue',sans-serif"}}>–</div>
          <input type="number" min="0" value={ai} onChange={e=>setAi(e.target.value)} placeholder="0" style={inp}/>
        </div>
        <div style={{fontSize:10,color:C.muted,textAlign:'center',marginBottom:6}}>No draws — scores must differ</div>
        <div style={{display:'flex',gap:6}}>
          <Btn onClick={()=>{if(canSave)onResult(match,parseInt(hi),parseInt(ai));}} style={{flex:1,fontSize:11,opacity:canSave?1:0.4}}>Save</Btn>
          <Btn onClick={()=>onSim(match)} variant="secondary" style={{flex:1,fontSize:11}}>▶ Sim</Btn>
        </div>
      </>}
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
  const onResult=async(round,idx,match,hs,as)=>{
    if(!bracket)return;
    const b=JSON.parse(JSON.stringify(bracket));
    const updated={...match,played:true,homeScore:hs,awayScore:as,et:false};
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
  const doSim=(round,idx,match)=>{
    const hN=nations.find(n=>n.id===match.homeId);
    const aN=nations.find(n=>n.id===match.awayId);
    if(!hN||!aN)return;
    const r=simWCKnockout(hN,aN);
    onResult(round,idx,match,r.hGoals,r.aGoals);
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
        {(bracket?.qf||[]).map((m,i)=><KnockoutMatchCard key={i} match={m} nations={nations} onResult={(m,hs,as)=>onResult('qf',i,m,hs,as)} onSim={m=>doSim('qf',i,m)} disabled={!m?.homeId||!m?.awayId}/>)}
      </div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10}}>Semi Finals</div>
        {(bracket?.sf||[{},{},]).map((m,i)=><KnockoutMatchCard key={i} match={m} nations={nations} onResult={(m,hs,as)=>onResult('sf',i,m,hs,as)} onSim={m=>doSim('sf',i,m)} disabled={!m?.homeId||!m?.awayId}/>)}
      </div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10}}>3rd Place</div>
        <KnockoutMatchCard match={bracket?.third} nations={nations} onResult={(m,hs,as)=>onResult('third',0,m,hs,as)} onSim={m=>doSim('third',0,m)} disabled={!bracket?.third?.homeId||!bracket?.third?.awayId}/>
      </div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10}}>Final</div>
        <KnockoutMatchCard match={bracket?.final} nations={nations} onResult={(m,hs,as)=>onResult('final',0,m,hs,as)} onSim={m=>doSim('final',0,m)} disabled={!bracket?.final?.homeId||!bracket?.final?.awayId}/>
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
      {view==='wc_setup'&&<GroupDrawView nations={nations} wcMeta={wcMeta} onSaveGroups={async gs=>{const meta={id:'wc_meta',type:'wc_meta',groups:gs,phase:'group'};setWcMeta(meta);await syncFixture(meta);const newMatches=[];for(const g of gs){for(let i=0;i<3;i++){const[ai2,bi2]=GROUP_PAIRS[i];const fix={id:`wc_gm_${g.id}${i+1}`,type:'wc_group',group:g.id,homeId:g.nationIds[ai2],awayId:g.nationIds[bi2],played:false,homeScore:null,awayScore:null};await syncFixture(fix);newMatches.push(fix);}}setGroupMatches(newMatches);onToast('Groups reset!');}} onToast={onToast}/>}
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
    const hN=isHome?myNation:nations.find(n=>n.id===oppId);
    const aN=isHome?nations.find(n=>n.id===oppId):myNation;
    if(!hN||!aN)return;
    const r=simWCMatch(hN,aN);
    updates[mid]={homeScore:r.hGoals,awayScore:r.aGoals};
    saveCareer({...career,results:{...careerResults,...updates}});
  };
  // Knockout phase
  const[koPhase,setKoPhase]=useState(career.koPhase||'qf');
  const[koResults,setKoResults]=useState(career.koResults||{});
  const[koHi,setKoHi]=useState('');const[koAi,setKoAi]=useState('');
  const[koOpponent,setKoOpponent]=useState(career.koOpponent||null);
  const saveKo=(phase,result,nextOpp,nextPhase)=>{
    const kr={...koResults,[phase]:result};
    setKoResults(kr);setKoOpponent(nextOpp||null);setKoPhase(nextPhase||phase);
    saveCareer({...career,koPhase:nextPhase||phase,koResults:kr,koOpponent:nextOpp||null});
  };
  const doKoMatch=(isHome,oppNation)=>{
    const hN=isHome?myNation:oppNation;
    const aN=isHome?oppNation:myNation;
    const r=simWCKnockout(hN,aN);
    const hv=parseInt(koHi),av=parseInt(koAi);
    const res=(!isNaN(hv)&&!isNaN(av)&&hv!==av)?{homeScore:hv,awayScore:av}:{homeScore:r.hGoals,awayScore:r.aGoals,simmed:true};
    const myWon=isHome?res.homeScore>res.awayScore:res.awayScore>res.homeScore;
    const phaseOrder=['qf','sf','final'];
    const nextPhase=myWon?phaseOrder[phaseOrder.indexOf(koPhase)+1]||'champion':'eliminated';
    // Pick random opponent for next round
    const nextOpp=myWon&&nextPhase!=='champion'?named.filter(n=>n.id!==career.nationId)[Math.floor(Math.random()*named.filter(n=>n.id!==career.nationId).length)]?.id||null:null;
    saveKo(koPhase,res,nextOpp,nextPhase);
    setKoHi('');setKoAi('');
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
      {/* Squad */}
      <div style={{marginBottom:20}}>
        <SLabel>Your Squad</SLabel>
        {['GK','DEF','MDF','FWD'].map(pos=>{const ps=myNation.players.filter(p=>p.position===pos&&p.name);if(!ps.length)return null;return(
          <div key={pos} style={{marginBottom:8}}>
            <div style={{fontSize:9,color:posColor(pos),fontWeight:700,letterSpacing:2,textTransform:'uppercase',marginBottom:4}}>{pos}</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {ps.map(p=><div key={p.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:'5px 10px',fontSize:12,color:C.text}}>{p.name}</div>)}
            </div>
          </div>
        );})}
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
        const isHome=Math.random()<0.5;
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
        if(!oppNation&&!koOpponent){
          const nextOpp=named.filter(n=>n.id!==career.nationId)[Math.floor(Math.random()*(named.length-1))]?.id;
          if(nextOpp)saveCareer({...career,koOpponent:nextOpp});
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
              <Btn onClick={()=>doKoMatch(true,oppNation)} style={{flex:1,fontSize:11,opacity:canSave?1:0.4}}>Save</Btn>
              <Btn onClick={()=>doKoMatch(true,oppNation)} variant="secondary" style={{flex:1,fontSize:11}}>▶ Sim</Btn>
            </div>
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
const WC_TABS=[{id:'groups',label:'Groups'},{id:'knockout',label:'Knockout'},{id:'nations',label:'Nations'},{id:'career',label:'Career'},{id:'manage',label:'Manage'}];

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
        {tab==='nations'&&<NationsTab nations={nations}/>}
        {tab==='career'&&<CareerTab nations={nations} wcMeta={wcMeta} groupMatches={groupMatches}/>}
        {tab==='manage'&&<ManageTab nations={nations} setNations={setNations} teams={teams} wcMeta={wcMeta} setWcMeta={setWcMeta} groupMatches={groupMatches} setGroupMatches={setGroupMatches} onToast={showToast}/>}
        {toast&&<div style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 18px',fontSize:13,color:C.text,zIndex:50,whiteSpace:'nowrap'}}>{toast}</div>}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<WCApp/>)
