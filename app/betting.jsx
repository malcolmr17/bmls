import React,{useState,useEffect,useMemo,useRef} from 'react'
import{createRoot}from 'react-dom/client'

const C={bg:"#0a0e1a",card:"#111827",surface:"#1E293B",border:"#1E293B",accent:"#3B82F6",gold:"#F59E0B",green:"#22c55e",red:"#ef4444",purple:"#A855F7",muted:"#64748B",sub:"#94A3B8",text:"#E2E8F0",white:"#F8FAFC"};
const posColor=p=>p==='GK'?C.purple:p==='DEF'?C.accent:p==='MDF'?'#f97316':C.red;
const isLight=hex=>{if(!hex||hex[0]!=='#')return false;const h=hex.replace('#','');const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);return(r*299+g*587+b*114)/1000>140;};

// ── pure helpers ──────────────────────────────────────────────────────────────

function lineupRatings(team){
  if(!team)return{atk:0,def:0};
  const active=team.players.filter(p=>!p.injured&&!p.suspended);
  const fwds=active.filter(p=>p.position==='FWD');
  const defs=active.filter(p=>p.position==='DEF');
  const mdfs=active.filter(p=>p.position==='MDF');
  const fwdAvg=fwds.length?fwds.reduce((s,p)=>s+p.score,0)/fwds.length:null;
  const defAvg=defs.length?defs.reduce((s,p)=>s+p.score,0)/defs.length:null;
  const dm=n=>n>=4?1.1:n===3?1.0:n===2?0.9:n===1?0.75:0.5;
  let atkP=[...fwds.map(p=>p.score)];
  mdfs.forEach(p=>{if(fwdAvg===null||p.mdfAtkScore>fwdAvg)atkP.push(p.mdfAtkScore);});
  const atkAvg=atkP.length?atkP.reduce((a,b)=>a+b,0)/atkP.length:0;
  const atk=Math.min(10,Math.round(atkAvg*dm(fwds.length)));
  let defP=[...defs.map(p=>p.score)];
  mdfs.forEach(p=>{if(defAvg===null||p.mdfDefScore>defAvg)defP.push(p.mdfDefScore);});
  const defAvgF=defP.length?defP.reduce((a,b)=>a+b,0)/defP.length:0;
  const def=Math.min(10,Math.round(defAvgF*dm(defs.length)));
  return{atk,def};
}

function predictMatch(home,away){
  const h=lineupRatings(home),a=lineupRatings(away);
  const hxg=+((1.25*(h.atk+0.4)/Math.max(a.def,0.5))*0.85).toFixed(1);
  const axg=+((1.25*a.atk/Math.max(h.def,0.5))*0.85).toFixed(1);
  const diff=hxg-axg;
  const hBoost=diff>0?1+Math.max(0,diff-0.4)*0.22:1;
  const aBoost=diff<0?1+Math.max(0,-diff-0.4)*0.22:1;
  const xgToGoals=xg=>Math.max(0,Math.round(xg*1.20-0.10));
  return{hxg,axg,hGoals:xgToGoals(hxg*hBoost),aGoals:xgToGoals(axg*aBoost)};
}

function calcOdds(home,away){
  const{hxg,axg}=predictMatch(home,away);
  const diff=hxg-axg;
  const pH=Math.min(0.94,Math.max(0.04,0.5+diff*0.38));
  const pA=Math.min(0.94,Math.max(0.04,0.5-diff*0.38));
  const pD=Math.max(0.04,0.30-Math.abs(diff)*0.10);
  const n=pH+pD+pA,mg=1.07;
  return{home:+((mg/(pH/n))).toFixed(2),draw:+((mg/(pD/n))).toFixed(2),away:+((mg/(pA/n))).toFixed(2),pHome:Math.round(pH/n*100),pDraw:Math.round(pD/n*100),pAway:Math.round(pA/n*100),hxg,axg};
}

function calcMatchRating(ps,position,result){
  let r=6;
  const g=ps.goals||0,a=ps.assists||0,y=ps.yellowCards||0,red=ps.redCard||false;
  if(position==='GK'){r+=Math.floor((ps.saves||0)/2);}
  else if(position==='DEF'){r+=(ps.tackles||0)-1;r+=g*2.5;r+=a*1.5;}
  else if(position==='MDF'){r+=(g===1?1:g===2?3:g>=3?5:0);r+=a;}
  else if(position==='FWD'){r+=(g===1?1:g===2?2.5:g>=3?4.5:0);r+=a*1.5;}
  r-=y*0.5;if(red)r-=1.5;
  if(result==='win')r+=0.5;else if(result==='loss')r-=0.5;
  return Math.min(10,Math.max(1,+r.toFixed(1)));
}

function generateMarkets(f,home,away){
  const o=calcOdds(home,away);
  const tot=o.hxg+o.axg;
  const pOver15=1-Math.exp(-tot)*(1+tot);
  const pOver25=1-Math.exp(-tot)*(1+tot+tot*tot/2);
  const mg=1.07;
  const toOdds=p=>Math.max(1.05,+((mg/Math.max(0.05,Math.min(0.95,p)))).toFixed(2));
  const pBtts=(1-Math.exp(-o.hxg))*(1-Math.exp(-o.axg));
  return[
    {market:'home_win',label:'Home Win',group:'Match Result',odds:o.home},
    {market:'draw',label:'Draw',group:'Match Result',odds:o.draw},
    {market:'away_win',label:'Away Win',group:'Match Result',odds:o.away},
    {market:'over_1_5',label:'Over 1.5 Goals',group:'Goals',odds:toOdds(pOver15)},
    {market:'under_1_5',label:'Under 1.5 Goals',group:'Goals',odds:toOdds(1-pOver15)},
    {market:'over_2_5',label:'Over 2.5 Goals',group:'Goals',odds:toOdds(pOver25)},
    {market:'under_2_5',label:'Under 2.5 Goals',group:'Goals',odds:toOdds(1-pOver25)},
    {market:'btts_yes',label:'Both Teams to Score',group:'BTTS',odds:toOdds(pBtts)},
    {market:'btts_no',label:'Clean Sheet Either Side',group:'BTTS',odds:toOdds(1-pBtts)},
    {market:'home_win_2plus',label:`${home.name} Win by 2+`,group:'Margin',odds:toOdds(o.pHome/100*0.45)},
    {market:'away_win_2plus',label:`${away.name} Win by 2+`,group:'Margin',odds:toOdds(o.pAway/100*0.45)},
  ];
}

function checkBetResult(bet,fixture){
  if(!fixture.played)return null;
  const h=fixture.homeScore,a=fixture.awayScore,tot=h+a;
  switch(bet.market){
    case 'home_win':return h>a;
    case 'draw':return h===a;
    case 'away_win':return a>h;
    case 'over_1_5':return tot>1;
    case 'under_1_5':return tot<2;
    case 'over_2_5':return tot>2;
    case 'under_2_5':return tot<3;
    case 'btts_yes':return h>0&&a>0;
    case 'btts_no':return h===0||a===0;
    case 'home_win_2plus':return h-a>=2;
    case 'away_win_2plus':return a-h>=2;
    default:return null;
  }
}

const DEFAULT_SETTINGS={
  fantasyBudget:60,
  points:{goal:6,assist:3,appearance:1,gkCleanSheet:4,penSave:5,ratingHigh:2,ratingLow:-1,yellow:-1,red:-3,mwTopBonus:2},
  playerCosts:{},
};

function ratingToCost(score){
  if(score>=9.5)return 10.0;
  if(score>=8.5)return 9.0;
  if(score>=7.5)return 7.5;
  if(score>=6.5)return 6.0;
  if(score>=5.5)return 5.0;
  if(score>=4.5)return 4.0;
  return 3.0;
}

function fantasyPlayerCost(p,settings=DEFAULT_SETTINGS){
  const overrides=settings.playerCosts||{};
  if(overrides[p.id]!=null)return overrides[p.id];
  const raw=p.position==='MDF'?((p.mdfAtkScore||5)+(p.mdfDefScore||5))/2:(p.score||5);
  return ratingToCost(raw);
}

function scorePlayer(pid,player,mwF,pts,top5){
  let score=0;
  mwF.forEach(f=>{
    const isHome=f.homeId===player.teamId,isAway=f.awayId===player.teamId;
    if(!isHome&&!isAway)return;
    const ps=(f.playerStats||[]).find(s=>s.playerId===pid);if(!ps)return;
    score+=pts.appearance;
    const result=isHome?(f.homeScore>f.awayScore?'win':f.homeScore<f.awayScore?'loss':'draw'):(f.awayScore>f.homeScore?'win':f.awayScore<f.homeScore?'loss':'draw');
    const rating=calcMatchRating(ps,player.position,result);
    score+=(ps.goals||0)*pts.goal+(ps.assists||0)*pts.assist;
    if((player.position==='GK'||player.position==='DEF')&&((isHome&&f.awayScore===0)||(isAway&&f.homeScore===0)))score+=pts.gkCleanSheet;
    if(player.position==='GK'&&ps.penSaves)score+=ps.penSaves*(pts.penSave??5);
    if(ps.yellowCards)score+=ps.yellowCards*pts.yellow;
    if(ps.redCard)score+=pts.red;
    if(rating>=8)score+=pts.ratingHigh;else if(rating<=4)score+=pts.ratingLow;
    if(top5.has(pid))score+=(pts.mwTopBonus??2);
  });
  return score;
}

function calcFantasyPoints(fantasySquad,fantasyHistory,teams,fixtures,settings=DEFAULT_SETTINGS){
  const pts=settings.points||DEFAULT_SETTINGS.points;
  const allPlayers={};
  teams.forEach(t=>t.players.forEach(p=>{allPlayers[p.id]={...p,teamId:t.id,teamName:t.name};}));
  const byMW={};
  fixtures.filter(f=>f.played).forEach(f=>{
    const mw=f.matchWeek||0;
    if(!byMW[mw])byMW[mw]=[];
    byMW[mw].push(f);
  });
  let totalPoints=0;
  const breakdown=[];
  const squad=fantasySquad||[];
  const history=fantasyHistory||{};
  Object.entries(byMW).forEach(([mw,mwF])=>{
    const hist=history[String(mw)]||{};
    const starting=hist.starting&&hist.starting.length>0?hist.starting:squad;
    const captain=hist.captain||null;
    const boostUsed=hist.boostUsed||null;
    const deduction=hist.transferDeduction||0;
    const scoringIds=boostUsed==='benchBoost'?squad:starting;

    const mwRatings=[];
    mwF.forEach(f=>{
      (f.playerStats||[]).forEach(ps=>{
        const pl=allPlayers[ps.playerId];if(!pl)return;
        const ih=f.homeId===pl.teamId,ia=f.awayId===pl.teamId;if(!ih&&!ia)return;
        const res=ih?(f.homeScore>f.awayScore?'win':f.homeScore<f.awayScore?'loss':'draw'):(f.awayScore>f.homeScore?'win':f.awayScore<f.homeScore?'loss':'draw');
        mwRatings.push({playerId:ps.playerId,rating:calcMatchRating(ps,pl.position,res)});
      });
    });
    const top5=new Set(mwRatings.sort((a,b)=>b.rating-a.rating).slice(0,5).map(r=>r.playerId));

    let mwPts=0;const details=[];
    scoringIds.forEach(pid=>{
      const player=allPlayers[pid];if(!player)return;
      let score=scorePlayer(pid,player,mwF,pts,top5);
      if(score===0)return;
      const captainMult=pid===captain?(boostUsed==='tripleCaptain'?3:2):1;
      const finalScore=score*captainMult;
      mwPts+=finalScore;
      details.push({playerName:player.name,pts:finalScore,isCaptain:pid===captain,captainMult,topRated:top5.has(pid)});
    });
    mwPts-=deduction;
    totalPoints+=mwPts;
    breakdown.push({mw:+mw,pts:mwPts,details,deduction,boostUsed,captain:allPlayers[captain]?.name});
  });
  return{totalPoints,breakdown:breakdown.sort((a,b)=>a.mw-b.mw)};
}

function activeMatchWeek(fixtures){
  const unplayed=fixtures.filter(f=>f.played===false&&f.homeId&&f.awayId&&f.matchWeek!=null);
  if(unplayed.length){const mws=unplayed.map(f=>f.matchWeek);return Math.min(...mws);}
  const played=fixtures.filter(f=>f.played&&f.matchWeek!=null);
  if(played.length){const mws=played.map(f=>f.matchWeek);return Math.max(...mws);}
  return 1;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function loadBMLSState(){
  const r=await fetch('/api/state');return r.json();
}
async function saveRecord(id,data){
  await fetch(`/api/fixture/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,id})});
}

// ── small UI components ───────────────────────────────────────────────────────

function Btn({children,onClick,variant='primary',disabled,style={}}){
  const bg=variant==='primary'?C.accent:variant==='gold'?C.gold:variant==='danger'?C.red:C.surface;
  const col=variant==='gold'?'#000':C.text;
  return<button onClick={onClick} disabled={disabled} style={{background:disabled?C.surface:bg,color:disabled?C.muted:col,border:`1px solid ${disabled?C.border:bg}`,borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:700,cursor:disabled?'not-allowed':'pointer',fontFamily:"'DM Sans',sans-serif",opacity:disabled?0.6:1,...style}}>{children}</button>;
}

function Inp({value,onChange,placeholder,type='text',maxLength,style={}}){
  return<input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type={type} maxLength={maxLength} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",color:C.text,fontSize:14,fontFamily:"'DM Sans',sans-serif",outline:"none",width:"100%",boxSizing:"border-box",...style}}/>;
}

function SLabel({children}){return<div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:"uppercase",marginBottom:12}}>{children}</div>;}

function Badge({children,color}){return<span style={{background:color+'22',color,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700,letterSpacing:.5}}>{children}</span>;}

function TeamCircle({color,size=24}){return<div style={{width:size,height:size,borderRadius:"50%",background:color||C.muted,flexShrink:0}}/>;}

// ── UsernameScreen ────────────────────────────────────────────────────────────

function UsernameScreen({allUsers,onLogin}){
  const[name,setName]=useState('');
  const[err,setErr]=useState('');
  const valid=/^[a-zA-Z0-9_]{3,20}$/.test(name);
  const submit=()=>{
    if(!valid){setErr('3–20 chars, letters/numbers/underscores only');return;}
    const existing=allUsers.find(u=>u.username.toLowerCase()===name.toLowerCase());
    if(existing){onLogin(existing,false);}
    else{onLogin({id:`betting_user_${name.toLowerCase()}`,type:'betting_user',username:name.toLowerCase(),balance:100,bets:[],leagueName:null,fantasySquad:[],fantasyHistory:{},freeTransfers:1,boostsAvailable:{benchBoost:true,tripleCaptain:true,wildcard:true},lastResetHighestMW:0},true);}
  };
  return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:48,color:C.gold,letterSpacing:2,lineHeight:1}}>BMLS</div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:C.text,letterSpacing:3}}>BETTING & FANTASY</div>
          <div style={{fontSize:12,color:C.muted,marginTop:8}}>Enter your username to get started</div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:24}}>
          <SLabel>Username</SLabel>
          <Inp value={name} onChange={v=>{setName(v);setErr('');}} placeholder="e.g. BigLeagueFan" maxLength={20}/>
          {err&&<div style={{fontSize:11,color:C.red,marginTop:6}}>{err}</div>}
          <div style={{marginTop:16}}>
            <Btn onClick={submit} disabled={!valid} style={{width:"100%",justifyContent:"center"}}>Continue</Btn>
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:12,textAlign:"center"}}>New username = new account with $100 · Returning = loads your data</div>
        </div>
      </div>
    </div>
  );
}

// ── LeagueScreen ──────────────────────────────────────────────────────────────

function LeagueScreen({username,allFixtures,onDone}){
  const[mode,setMode]=useState(null); // null | 'create' | 'join'
  const[input,setInput]=useState('');
  const[err,setErr]=useState('');
  const[saving,setSaving]=useState(false);

  const createLeague=async()=>{
    const slug=input.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
    if(slug.length<3){setErr('Name too short (min 3 chars)');return;}
    const id=`betting_league_${slug}`;
    if(allFixtures.find(f=>f.id===id)){setErr('League name already taken');return;}
    setSaving(true);
    const league={id,type:'betting_league',name:slug,displayName:input.trim(),members:[username],createdBy:username,createdAt:new Date().toISOString()};
    await saveRecord(id,league);
    onDone(slug,league);
  };

  const joinLeague=async()=>{
    const slug=input.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
    const id=`betting_league_${slug}`;
    const league=allFixtures.find(f=>f.id===id);
    if(!league){setErr('League not found — check the name');return;}
    setSaving(true);
    const updated={...league,members:[...new Set([...league.members,username])]};
    await saveRecord(id,updated);
    onDone(slug,updated);
  };

  return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:C.text,letterSpacing:2}}>Join a League</div>
          <div style={{fontSize:12,color:C.muted,marginTop:4}}>Compete with friends on the leaderboard</div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:24}}>
          {!mode&&(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <Btn onClick={()=>setMode('create')} variant="primary" style={{width:"100%"}}>Create a League</Btn>
              <Btn onClick={()=>setMode('join')} variant="gold" style={{width:"100%"}}>Join Existing League</Btn>
              <Btn onClick={()=>onDone(null,null)} variant="secondary" style={{width:"100%"}}>Play Solo (Skip)</Btn>
            </div>
          )}
          {mode&&(
            <>
              <SLabel>{mode==='create'?'League Display Name':'League Name'}</SLabel>
              <Inp value={input} onChange={v=>{setInput(v);setErr('');}} placeholder={mode==='create'?'e.g. Premier Punters':'Enter league name'}/>
              {err&&<div style={{fontSize:11,color:C.red,marginTop:6}}>{err}</div>}
              <div style={{display:"flex",gap:8,marginTop:16}}>
                <Btn onClick={mode==='create'?createLeague:joinLeague} disabled={!input.trim()||saving} variant="primary">{saving?'Saving…':mode==='create'?'Create':'Join'}</Btn>
                <Btn onClick={()=>{setMode(null);setInput('');setErr('');}} variant="secondary">Back</Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── BettingTab ────────────────────────────────────────────────────────────────

function BettingTab({teams,fixtures,userData,onPlaceBet}){
  const[expanded,setExpanded]=useState(null);
  const[stakes,setStakes]=useState({});
  const[selectedMarket,setSelectedMarket]=useState({});

  const currentMW=activeMatchWeek(fixtures);
  const upcoming=fixtures.filter(f=>!f.played&&f.homeId&&f.awayId&&f.matchWeek===currentMW);

  if(!upcoming.length)return<div style={{padding:32,textAlign:"center",color:C.muted,fontSize:13}}>No fixtures to bet on for Match Week {currentMW}.</div>;

  const groups=['Match Result','Goals','BTTS','Margin'];

  return(
    <div>
      <div style={{background:C.surface,borderRadius:12,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{fontSize:12,color:C.muted}}>Balance</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.gold}}>${userData.balance.toFixed(2)}</div>
      </div>
      <SLabel>Match Week {currentMW}</SLabel>
      <div style={{marginBottom:24}}>
          {upcoming.map(f=>{
            const h=teams.find(t=>t.id===f.homeId),a=teams.find(t=>t.id===f.awayId);
            if(!h||!a)return null;
            const isOpen=expanded===f.id;
            const markets=generateMarkets(f,h,a);
            const pred=predictMatch(h,a);
            const openBets=(userData.bets||[]).filter(b=>b.fixtureId===f.id&&b.status==='open');
            return(
              <div key={f.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,marginBottom:12,overflow:"hidden"}}>
                <button onClick={()=>setExpanded(isOpen?null:f.id)} style={{width:"100%",background:"none",border:"none",cursor:"pointer",padding:"14px 16px",textAlign:"left"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <TeamCircle color={h.color} size={20}/>
                      <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.text}}>{h.name}</span>
                      <span style={{fontSize:11,color:C.muted}}>vs</span>
                      <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.text}}>{a.name}</span>
                      <TeamCircle color={a.color} size={20}/>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {openBets.length>0&&<Badge color={C.gold}>{openBets.length} bet{openBets.length!==1?'s':''}</Badge>}
                      <span style={{color:C.muted,fontSize:16}}>{isOpen?'▲':'▼'}</span>
                    </div>
                  </div>
                </button>
                {isOpen&&(
                  <div style={{borderTop:`1px solid ${C.border}`}}>
                    <div style={{padding:"10px 16px",background:C.surface,display:"flex",justifyContent:"center",gap:32}}>
                      <div style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:36,color:C.gold,lineHeight:1}}>{pred.hGoals}</div><div style={{fontSize:9,color:C.muted}}>xG {pred.hxg}</div></div>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:C.muted,alignSelf:"center"}}>–</div>
                      <div style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:36,color:C.gold,lineHeight:1}}>{pred.aGoals}</div><div style={{fontSize:9,color:C.muted}}>xG {pred.axg}</div></div>
                    </div>
                    {groups.map(grp=>{
                      const grpMarkets=markets.filter(m=>m.group===grp);
                      return(
                        <div key={grp} style={{padding:"12px 16px",borderTop:`1px solid ${C.border}`}}>
                          <div style={{fontSize:9,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:"uppercase",marginBottom:8}}>{grp}</div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                            {grpMarkets.map(m=>{
                              const key=`${f.id}_${m.market}`;
                              const sel=selectedMarket[key];
                              const stake=parseFloat(stakes[key])||0;
                              return(
                                <div key={m.market} style={{flex:"1 1 140px"}}>
                                  <button onClick={()=>setSelectedMarket(prev=>({...prev,[key]:prev[key]?null:m}))} style={{width:"100%",background:sel?C.gold+'22':C.surface,border:`1px solid ${sel?C.gold:C.border}`,borderRadius:8,padding:"8px 10px",cursor:"pointer",textAlign:"left"}}>
                                    <div style={{fontSize:11,color:sel?C.gold:C.muted,fontWeight:600}}>{m.label}</div>
                                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:sel?C.gold:C.text,marginTop:2}}>{m.odds}</div>
                                  </button>
                                  {sel&&(
                                    <div style={{marginTop:6,display:"flex",gap:6,alignItems:"center"}}>
                                      <div style={{position:"relative",flex:1}}>
                                        <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:13}}>$</span>
                                        <input
                                          type="number" min="1" max={userData.balance} step="1"
                                          value={stakes[key]||''}
                                          onChange={e=>setStakes(prev=>({...prev,[key]:e.target.value}))}
                                          placeholder="Stake"
                                          style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 8px 6px 22px",color:C.text,fontSize:12,fontFamily:"'DM Sans',sans-serif",outline:"none",width:"100%",boxSizing:"border-box"}}
                                        />
                                      </div>
                                      <button
                                        onClick={()=>{
                                          if(stake<1||stake>userData.balance)return;
                                          onPlaceBet({id:Date.now()+Math.random(),fixtureId:f.id,homeTeamName:h.name,awayTeamName:a.name,market:m.market,label:m.label,odds:m.odds,stake,status:'open',payout:null,placedAt:new Date().toISOString(),matchWeek:f.matchWeek||null});
                                          setSelectedMarket(prev=>({...prev,[key]:null}));
                                          setStakes(prev=>({...prev,[key]:''}));
                                        }}
                                        disabled={stake<1||stake>userData.balance}
                                        style={{background:C.green,color:"#fff",border:"none",borderRadius:6,padding:"6px 10px",fontSize:11,fontWeight:700,cursor:stake<1||stake>userData.balance?'not-allowed':'pointer',opacity:stake<1||stake>userData.balance?0.5:1,whiteSpace:"nowrap"}}
                                      >
                                        {stake>=1?`Return $${(stake*m.odds).toFixed(2)}`:'Bet'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
    </div>
  );
}

// ── MyBetsTab ─────────────────────────────────────────────────────────────────

function MyBetsTab({userData}){
  const bets=userData.bets||[];
  const open=bets.filter(b=>b.status==='open');
  const settled=bets.filter(b=>b.status!=='open').sort((a,b)=>new Date(b.placedAt)-new Date(a.placedAt));
  const won=settled.filter(b=>b.status==='won');
  const totalStaked=settled.reduce((s,b)=>s+b.stake,0);
  const totalReturn=won.reduce((s,b)=>s+(b.payout||0),0);
  const profit=totalReturn-totalStaked;

  const betColor=b=>b.status==='won'?C.green:b.status==='lost'?C.red:C.gold;

  return(
    <div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:20}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,textAlign:"center"}}>
          {[{label:"Balance",val:`$${userData.balance.toFixed(2)}`,color:C.gold},{label:"Bets Won",val:`${won.length}/${settled.length}`,color:C.green},{label:"Profit/Loss",val:`${profit>=0?'+':''}$${profit.toFixed(2)}`,color:profit>=0?C.green:C.red},{label:"Open",val:open.length,color:C.accent}].map(({label,val,color})=>(
            <div key={label}>
              <div style={{fontSize:9,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{label}</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color}}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {open.length>0&&(
        <>
          <SLabel>Open Bets</SLabel>
          {open.map(b=>(
            <div key={b.id} style={{background:C.card,border:`1px solid ${C.gold}33`,borderLeft:`3px solid ${C.gold}`,borderRadius:10,padding:"12px 14px",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{fontSize:12,color:C.text,fontWeight:600}}>{b.homeTeamName} vs {b.awayTeamName}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{b.label}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.gold}}>{b.odds}</div>
                  <div style={{fontSize:10,color:C.muted}}>odds</div>
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:8,fontSize:11}}>
                <span style={{color:C.muted}}>Stake: <span style={{color:C.text,fontWeight:600}}>${b.stake.toFixed(2)}</span></span>
                <span style={{color:C.green,fontWeight:600}}>Return: ${(b.stake*b.odds).toFixed(2)}</span>
              </div>
            </div>
          ))}
        </>
      )}

      {settled.length>0&&(
        <>
          <SLabel style={{marginTop:16}}>Settled Bets</SLabel>
          {settled.map(b=>(
            <div key={b.id} style={{background:C.card,border:`1px solid ${betColor(b)}33`,borderLeft:`3px solid ${betColor(b)}`,borderRadius:10,padding:"12px 14px",marginBottom:8,opacity:0.9}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{fontSize:12,color:C.text,fontWeight:600}}>{b.homeTeamName} vs {b.awayTeamName}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{b.label}</div>
                </div>
                <Badge color={betColor(b)}>{b.status.toUpperCase()}</Badge>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:8,fontSize:11}}>
                <span style={{color:C.muted}}>Stake: <span style={{color:C.text}}>${b.stake.toFixed(2)}</span></span>
                <span style={{color:betColor(b),fontWeight:600}}>{b.status==='won'?`+$${(b.payout-b.stake).toFixed(2)}`:`-$${b.stake.toFixed(2)}`}</span>
              </div>
            </div>
          ))}
        </>
      )}

      {!bets.length&&<div style={{padding:40,textAlign:"center",color:C.muted}}>No bets placed yet. Head to the Bet tab to get started.</div>}
    </div>
  );
}

// ── FantasyTab ────────────────────────────────────────────────────────────────

const REQUIRED={GK:1,DEF:3,MDF:2,FWD:3};

function FantasyTab({teams,fixtures,userData,settings=DEFAULT_SETTINGS,onSaveFantasy}){
  const BUDGET=settings.fantasyBudget??DEFAULT_SETTINGS.fantasyBudget;
  const currentMW=activeMatchWeek(fixtures);
  const squad=userData.fantasySquad||userData.fantasyPlayerIds||[];
  const hasFullSquad=squad.length===9;

  const[subView,setSubView]=useState(hasFullSquad?'team':'squad');
  const[picking,setPicking]=useState([...squad]);
  const[localStarting,setLocalStarting]=useState(()=>{
    const hist=(userData.fantasyHistory||{})[String(currentMW)];
    return hist?.starting||squad.slice(0,6);
  });
  const[localCaptain,setLocalCaptain]=useState(()=>{
    const hist=(userData.fantasyHistory||{})[String(currentMW)];
    return hist?.captain||null;
  });
  const[activeBoost,setActiveBoost]=useState(()=>{
    const hist=(userData.fantasyHistory||{})[String(currentMW)];
    return hist?.boostUsed||null;
  });
  const[transferOut,setTransferOut]=useState(null);
  const[pendingTransfers,setPendingTransfers]=useState([]);
  const[saving,setSaving]=useState(false);
  const[pickingSlot,setPickingSlot]=useState(null);
  const isLocked=!!(userData.fantasyHistory||{})[String(currentMW)];
  const freeTransfers=userData.freeTransfers??1;
  const boosts=userData.boostsAvailable||{benchBoost:true,tripleCaptain:true,wildcard:true};

  const allPlayers=useMemo(()=>{
    const arr=[];
    teams.forEach(t=>t.players.filter(p=>p.name).forEach(p=>arr.push({...p,teamName:t.name,teamColor:t.color,cost:fantasyPlayerCost(p,settings)})));
    return arr;
  },[teams,settings]);

  const squadPlayers=squad.map(id=>allPlayers.find(p=>p.id===id)).filter(Boolean);
  const squadBudget=squadPlayers.reduce((s,p)=>s+p.cost,0);

  // Squad builder counts
  const pickCounts={};
  ['GK','DEF','MDF','FWD'].forEach(pos=>{pickCounts[pos]=picking.filter(id=>allPlayers.find(p=>p.id===id)?.position===pos).length;});
  const pickingPlayers=picking.map(id=>allPlayers.find(p=>p.id===id)).filter(Boolean);
  const pickingSpent=pickingPlayers.reduce((s,p)=>s+p.cost,0);
  const pickingRemaining=BUDGET-pickingSpent;
  const squadComplete=Object.entries(REQUIRED).every(([pos,req])=>pickCounts[pos]===req);

  const togglePick=p=>{
    if(picking.includes(p.id)){setPicking(prev=>prev.filter(id=>id!==p.id));return;}
    if((pickCounts[p.position]||0)>=REQUIRED[p.position])return;
    if(p.cost>pickingRemaining)return;
    setPicking(prev=>[...prev,p.id]);
  };

  const confirmSquad=async()=>{
    if(!squadComplete)return;
    setSaving(true);
    await onSaveFantasy({squad:picking,history:userData.fantasyHistory||{},freeTransfers:userData.freeTransfers??1,boostsAvailable:userData.boostsAvailable||{benchBoost:true,tripleCaptain:true,wildcard:true}});
    setSaving(false);
    setSubView('team');
  };

  // Transfers
  const extraTransfers=Math.max(0,pendingTransfers.length-(activeBoost==='wildcard'?999:freeTransfers));
  const deduction=extraTransfers*4;

  const toggleStarting=pid=>{
    if(isLocked)return;
    if(localStarting.includes(pid)){
      setLocalStarting(prev=>prev.filter(id=>id!==pid));
      if(localCaptain===pid)setLocalCaptain(null);
    } else {
      if(localStarting.length>=6)return;
      setLocalStarting(prev=>[...prev,pid]);
    }
  };

  const setCaptain=pid=>{
    if(!localStarting.includes(pid))return;
    setLocalCaptain(prev=>prev===pid?null:pid);
  };

  const hasStartingGK=localStarting.some(id=>allPlayers.find(p=>p.id===id)?.position==='GK');
  const canLock=localStarting.length===6&&hasStartingGK&&!!localCaptain&&!isLocked;

  const lockLineup=async()=>{
    if(!canLock)return;
    setSaving(true);
    const hist={...(userData.fantasyHistory||{})};
    hist[String(currentMW)]={starting:localStarting,captain:localCaptain,boostUsed:activeBoost,transferDeduction:deduction};
    const newFT=activeBoost==='wildcard'?1:Math.min(2,Math.max(1,freeTransfers-pendingTransfers.length+1));
    const newBoosts={...boosts};
    if(activeBoost)newBoosts[activeBoost]=false;
    let newSquad=[...squad];
    pendingTransfers.forEach(({outId,inId})=>{newSquad=newSquad.map(id=>id===outId?inId:id);});
    await onSaveFantasy({squad:newSquad,history:hist,freeTransfers:newFT,boostsAvailable:newBoosts});
    setSaving(false);
    setPendingTransfers([]);
    setTransferOut(null);
  };

  const{totalPoints,breakdown}=useMemo(()=>calcFantasyPoints(squad,userData.fantasyHistory||{},teams,fixtures,settings),[squad,userData.fantasyHistory,teams,fixtures,settings]);

  const posOrder=['GK','DEF','MDF','FWD'];
  const byPos={};
  posOrder.forEach(pos=>{byPos[pos]=allPlayers.filter(p=>p.position===pos).sort((a,b)=>b.cost-a.cost);});

  // Squad builder view
  if(!hasFullSquad||subView==='squad'){
    const slotMap={};
    ['GK','DEF','MDF','FWD'].forEach(pos=>{
      const ids=picking.filter(id=>allPlayers.find(p=>p.id===id)?.position===pos);
      slotMap[pos]=Array.from({length:REQUIRED[pos]},(_,i)=>ids[i]?allPlayers.find(p=>p.id===ids[i]):null);
    });
    const addToSlot=p=>{
      if(picking.includes(p.id)||p.cost>pickingRemaining)return;
      setPicking(prev=>[...prev,p.id]);
      setPickingSlot(null);
    };
    const removeFromSlot=(pos,idx)=>{
      const ids=picking.filter(id=>allPlayers.find(p=>p.id===id)?.position===pos);
      const rid=ids[idx];
      if(rid)setPicking(prev=>prev.filter(id=>id!==rid));
    };
    const PitchSlot=({player,pos,idx})=>{
      const empty=!player;
      const col=posColor(pos);
      const isActive=pickingSlot&&pickingSlot.pos===pos&&pickingSlot.idx===idx;
      return(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,minWidth:52}}>
          <div
            onClick={()=>empty?setPickingSlot(isActive?null:{pos,idx}):removeFromSlot(pos,idx)}
            style={{position:"relative",width:52,height:52,borderRadius:"50%",
              background:empty?(isActive?"rgba(255,255,255,0.18)":"rgba(255,255,255,0.08)"):player.teamColor||col,
              border:`2.5px ${empty?"dashed":"solid"} ${empty?(isActive?"rgba(255,255,255,0.7)":"rgba(255,255,255,0.3)"):player.teamColor||col}`,
              display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",
              boxShadow:empty?"none":`0 2px 10px ${player.teamColor||col}77`,transition:"all 0.15s"}}
          >
            {empty
              ?<span style={{fontSize:26,lineHeight:1,color:isActive?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.45)",fontWeight:300}}>+</span>
              :<span style={{fontSize:8,fontWeight:700,color:isLight(player.teamColor||'')?"#000":"#fff"}}>{player.position}</span>
            }
            {!empty&&<div style={{position:"absolute",top:-2,right:-2,width:16,height:16,borderRadius:"50%",background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"rgba(255,255,255,0.8)",fontWeight:700}}>×</div>}
          </div>
          <span style={{fontSize:8,fontWeight:700,color:"#fff",textAlign:"center",maxWidth:56,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textShadow:"0 1px 3px rgba(0,0,0,0.9)"}}>
            {empty?pos:(player.name||'').trim().split(/\s+/).pop()}
          </span>
          <span style={{fontSize:7,color:"rgba(255,255,255,0.55)",textShadow:"0 1px 2px rgba(0,0,0,0.8)"}}>{empty?'':`${player.cost}cr`}</span>
        </div>
      );
    };
    const pickerPos=pickingSlot?.pos;
    const pickerOptions=pickerPos?byPos[pickerPos].filter(p=>!picking.includes(p.id)):[];
    return(
      <div>
        {/* Header */}
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 16px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.gold,letterSpacing:1}}>Build Your Squad</div>
            <div style={{fontSize:12,fontWeight:700,color:pickingRemaining<0?C.red:C.text}}>{pickingRemaining} cr left</div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {['GK','DEF','MDF','FWD'].map(pos=>(
              <div key={pos} style={{background:posColor(pos)+'22',borderRadius:6,padding:"3px 10px",display:"flex",gap:4,alignItems:"center"}}>
                <span style={{fontSize:9,fontWeight:700,color:posColor(pos)}}>{pos}</span>
                <span style={{fontSize:12,fontWeight:700,color:pickCounts[pos]===REQUIRED[pos]?C.green:C.text}}>{pickCounts[pos]}/{REQUIRED[pos]}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Pitch */}
        <div style={{position:"relative",background:"linear-gradient(180deg,#1a7340 0%,#1e8a4a 40%,#1a7340 100%)",borderRadius:12,padding:"16px 8px",marginBottom:12,overflow:"hidden"}}>
          <div style={{position:"absolute",top:"50%",left:"8%",right:"8%",height:1,background:"rgba(255,255,255,0.12)",transform:"translateY(-50%)"}}/>
          <div style={{position:"absolute",top:"50%",left:"50%",width:54,height:54,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.12)",transform:"translate(-50%,-50%)"}}/>
          <div style={{position:"absolute",bottom:0,left:"28%",right:"28%",height:"16%",border:"1px solid rgba(255,255,255,0.1)",borderBottom:"none"}}/>
          <div style={{position:"absolute",top:0,left:"28%",right:"28%",height:"16%",border:"1px solid rgba(255,255,255,0.1)",borderTop:"none"}}/>
          {['FWD','MDF','DEF','GK'].map(pos=>(
            <div key={pos} style={{display:"flex",justifyContent:"center",gap:pos==='GK'?0:8,marginBottom:pos==='GK'?0:14}}>
              {slotMap[pos].map((player,idx)=><PitchSlot key={idx} player={player} pos={pos} idx={idx}/>)}
            </div>
          ))}
        </div>
        {/* Player picker panel */}
        {pickingSlot&&(
          <div style={{background:C.card,border:`2px solid ${posColor(pickerPos)}`,borderRadius:12,padding:16,marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontWeight:700,fontSize:13,color:posColor(pickerPos)}}>Pick a {pickerPos}</div>
              <button onClick={()=>setPickingSlot(null)} style={{background:"none",border:"none",color:C.muted,fontSize:18,cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            {pickerOptions.length===0
              ?<div style={{color:C.muted,fontSize:12,textAlign:"center",padding:"12px 0"}}>All {pickerPos}s already selected</div>
              :pickerOptions.map(p=>{
                const cantAfford=p.cost>pickingRemaining;
                return(
                  <button key={p.id} onClick={()=>addToSlot(p)} disabled={cantAfford} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 12px",marginBottom:6,cursor:cantAfford?'not-allowed':'pointer',opacity:cantAfford?0.38:1,textAlign:"left"}}>
                    <span style={{flex:1,fontSize:13,fontWeight:600,color:C.text}}>{p.name}</span>
                    <span style={{fontSize:10,color:C.muted}}>{p.teamName}</span>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.gold}}>{p.cost}</span>
                  </button>
                );
              })
            }
          </div>
        )}
        <Btn onClick={confirmSquad} disabled={!squadComplete||saving} variant="gold" style={{width:"100%"}}>{saving?'Saving…':'Confirm Squad'}</Btn>
      </div>
    );
  }

  // Main team view
  const bench=squadPlayers.filter(p=>!localStarting.includes(p.id));
  const startingPlayers=localStarting.map(id=>squadPlayers.find(p=>p.id===id)).filter(Boolean);
  const startingByPos=pos=>startingPlayers.filter(p=>p.position===pos);

  const PlayerDot=({p,isStarting=true})=>{
    const isCap=p.id===localCaptain;
    const surname=(p.name||'').trim().split(/\s+/).pop();
    return(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:isLocked?'default':'pointer',minWidth:48}}>
        <div style={{position:"relative"}} onClick={()=>!isLocked&&toggleStarting(p.id)}>
          <div style={{width:42,height:42,borderRadius:"50%",background:isStarting?p.teamColor||C.accent:'transparent',border:`2.5px ${isStarting?'solid':'dashed'} ${p.teamColor||C.accent}`,opacity:isStarting?1:0.6,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:isStarting?`0 2px 8px ${p.teamColor||C.accent}55`:"none"}}>
            <span style={{fontSize:8,fontWeight:700,color:isStarting?"#fff":C.muted}}>{p.position}</span>
          </div>
          {isCap&&<div style={{position:"absolute",top:-4,right:-4,width:15,height:15,borderRadius:"50%",background:C.gold,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:900,color:"#000"}}>C</div>}
        </div>
        <span style={{fontSize:9,color:C.text,fontWeight:700,textAlign:"center",maxWidth:52,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{surname}</span>
        {!isLocked&&isStarting&&<button onClick={e=>{e.stopPropagation();setCaptain(p.id);}} style={{background:isCap?C.gold:C.surface,border:`1px solid ${isCap?C.gold:C.border}`,borderRadius:10,padding:"1px 5px",fontSize:7,fontWeight:700,color:isCap?'#000':C.muted,cursor:"pointer"}}>C</button>}
        <span style={{fontSize:8,color:C.muted}}>{p.cost}cr</span>
      </div>
    );
  };

  const boostMeta=[
    {key:'benchBoost',short:'BB',label:'Bench Boost',desc:'Bench scores points this MW'},
    {key:'tripleCaptain',short:'TC',label:'Triple Captain',desc:'Captain gets 3× points'},
    {key:'wildcard',short:'WC',label:'Wildcard',desc:'Unlimited free transfers this MW'},
  ];

  return(
    <div>
      {/* Sub-tabs */}
      <div style={{display:"flex",background:C.surface,borderRadius:10,padding:4,marginBottom:16}}>
        {[['team','Team'],['transfers','Transfers'],['points','Points'],['tips','Tips']].map(([key,label])=>(
          <button key={key} onClick={()=>setSubView(key)} style={{flex:1,background:subView===key?C.card:'transparent',border:"none",borderRadius:8,padding:"8px 0",fontSize:12,fontWeight:700,color:subView===key?C.gold:C.muted,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{label}</button>
        ))}
      </div>

      {subView==='team'&&(
        <div>
          {/* Status bar */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 16px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontSize:9,color:C.muted,letterSpacing:1}}>MW {currentMW} STATUS</div>
              <div style={{fontSize:13,fontWeight:700,color:isLocked?C.green:localStarting.length===6?C.gold:C.muted}}>{isLocked?'Locked ✓':localStarting.length===6?'Ready to Lock':`Starting: ${localStarting.length}/6`}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:9,color:C.muted}}>Budget left</div>
              <div style={{fontSize:13,fontWeight:700,color:C.text}}>{BUDGET-squadBudget}</div>
            </div>
            <div style={{fontSize:10,color:C.muted}}>Free transfers: <span style={{color:C.gold,fontWeight:700}}>{freeTransfers}</span></div>
          </div>

          {/* Boosts */}
          {!isLocked&&(
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 16px",marginBottom:12}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:2,color:C.muted,textTransform:"uppercase",marginBottom:8}}>Boosts</div>
              <div style={{display:"flex",gap:8}}>
                {boostMeta.map(b=>{
                  const available=boosts[b.key]!==false;
                  const isActive=activeBoost===b.key;
                  return(
                    <button key={b.key} onClick={()=>{if(!available)return;setActiveBoost(prev=>prev===b.key?null:b.key);}} title={b.desc} style={{flex:1,background:isActive?C.gold+'33':available?C.surface:C.bg,border:`1px solid ${isActive?C.gold:C.border}`,borderRadius:8,padding:"8px 4px",cursor:available?'pointer':'not-allowed',opacity:available?1:0.4}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:isActive?C.gold:available?C.text:C.muted}}>{b.short}</div>
                      <div style={{fontSize:8,color:isActive?C.gold:C.muted,marginTop:2}}>{available?b.label:'Used'}</div>
                    </button>
                  );
                })}
              </div>
              {activeBoost&&<div style={{fontSize:10,color:C.gold,marginTop:8,textAlign:"center"}}>{boostMeta.find(b=>b.key===activeBoost)?.desc}</div>}
            </div>
          )}

          {/* Pitch */}
          <div style={{background:"#14532d",border:"1px solid #166534",borderRadius:12,padding:"16px 8px",marginBottom:12}}>
            <div style={{textAlign:"center",fontSize:8,color:"#4ade80",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Starting 6</div>
            {['FWD','MDF','DEF','GK'].map(pos=>{
              const row=startingByPos(pos);
              if(!row.length)return null;
              return<div key={pos} style={{display:"flex",justifyContent:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>{row.map(p=><PlayerDot key={p.id} p={p} isStarting={true}/>)}</div>;
            })}
            {/* misc starting (position not in 4 categories) */}
            {startingPlayers.filter(p=>!['GK','DEF','MDF','FWD'].includes(p.position)).map(p=><PlayerDot key={p.id} p={p} isStarting={true}/>)}
            <div style={{height:1,background:"#166534",margin:"10px 0"}}/>
            <div style={{textAlign:"center",fontSize:8,color:"#4ade8066",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Bench</div>
            <div style={{display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap"}}>
              {bench.map(p=><PlayerDot key={p.id} p={p} isStarting={false}/>)}
              {bench.length===0&&!isLocked&&<div style={{fontSize:10,color:"#4ade8066"}}>Tap a starting player to move them to bench</div>}
            </div>
          </div>

          {/* Warnings + lock */}
          {!isLocked&&!hasStartingGK&&localStarting.length>0&&<div style={{background:C.gold+'22',border:`1px solid ${C.gold}`,borderRadius:8,padding:"8px 12px",fontSize:11,color:C.gold,marginBottom:8}}>Must include a GK in your starting 6</div>}
          {!isLocked&&!localCaptain&&localStarting.length===6&&<div style={{background:C.gold+'22',border:`1px solid ${C.gold}`,borderRadius:8,padding:"8px 12px",fontSize:11,color:C.gold,marginBottom:8}}>Tap C under a starting player to set your captain</div>}
          {deduction>0&&<div style={{background:'#f9731622',border:"1px solid #f97316",borderRadius:8,padding:"8px 12px",fontSize:11,color:'#f97316',marginBottom:8}}>{extraTransfers} extra transfer{extraTransfers!==1?'s':''} = −{deduction} pts this MW</div>}
          {!isLocked&&<Btn onClick={lockLineup} disabled={!canLock||saving} variant="gold" style={{width:"100%"}}>{saving?'Saving…':`Lock Lineup for MW ${currentMW}`}</Btn>}
          {isLocked&&<div style={{background:C.green+'22',border:`1px solid ${C.green}`,borderRadius:8,padding:"10px 14px",fontSize:12,color:C.green,fontWeight:600,textAlign:"center"}}>✓ Lineup locked for Match Week {currentMW}</div>}
          {!isLocked&&<button onClick={()=>setSubView('squad')} style={{background:"none",border:"none",color:C.muted,fontSize:11,cursor:"pointer",marginTop:8,display:"block",width:"100%",textAlign:"center"}}>Change squad</button>}
        </div>
      )}

      {subView==='transfers'&&(
        <div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:C.text}}>Free transfers: <span style={{color:C.gold}}>{freeTransfers}</span></div>
              {pendingTransfers.length>0&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>Made this MW: {pendingTransfers.length}</div>}
            </div>
            {deduction>0&&<div style={{fontSize:12,color:'#f97316',fontWeight:700}}>−{deduction} pts</div>}
          </div>
          {activeBoost==='wildcard'&&<div style={{background:C.gold+'22',border:`1px solid ${C.gold}`,borderRadius:8,padding:"8px 12px",fontSize:11,color:C.gold,fontWeight:700,marginBottom:12}}>WILDCARD ACTIVE — all transfers free</div>}

          {!transferOut?(
            <>
              <SLabel>Select player to transfer out</SLabel>
              {squadPlayers.map(p=>(
                <button key={p.id} onClick={()=>setTransferOut(p.id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",marginBottom:6,cursor:"pointer",textAlign:"left"}}>
                  <span style={{background:posColor(p.position)+'33',color:posColor(p.position),borderRadius:3,padding:"2px 5px",fontSize:9,fontWeight:700}}>{p.position}</span>
                  <span style={{flex:1,fontSize:13,fontWeight:600,color:C.text}}>{p.name}</span>
                  <span style={{fontSize:10,color:C.muted}}>{p.teamName}</span>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.gold}}>{p.cost}</span>
                </button>
              ))}
            </>
          ):(()=>{
            const outPlayer=squadPlayers.find(p=>p.id===transferOut);
            const effectiveSquad=new Set(squad);
            pendingTransfers.forEach(t=>{effectiveSquad.delete(t.outId);effectiveSquad.add(t.inId);});
            const budgetUsed=allPlayers.filter(p=>effectiveSquad.has(p.id)).reduce((s,p)=>s+p.cost,0);
            const budgetLeft=BUDGET-budgetUsed+(outPlayer?.cost||0);
            const available=allPlayers.filter(p=>!effectiveSquad.has(p.id)&&p.id!==transferOut&&p.position===outPlayer?.position&&p.cost<=budgetLeft).sort((a,b)=>b.cost-a.cost);
            return(
              <>
                <div style={{background:C.red+'22',border:`1px solid ${C.red}`,borderRadius:10,padding:"12px 14px",marginBottom:16}}>
                  <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Transferring out</div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{background:posColor(outPlayer?.position)+'33',color:posColor(outPlayer?.position),borderRadius:3,padding:"2px 5px",fontSize:9,fontWeight:700}}>{outPlayer?.position}</span>
                    <span style={{fontSize:14,fontWeight:700,color:C.red,flex:1}}>{outPlayer?.name}</span>
                    <button onClick={()=>setTransferOut(null)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:18,padding:0}}>✕</button>
                  </div>
                </div>
                <SLabel>Select replacement ({outPlayer?.position})</SLabel>
                {available.length===0&&<div style={{color:C.muted,fontSize:12,padding:"20px 0",textAlign:"center"}}>No eligible players within budget</div>}
                {available.map(p=>(
                  <button key={p.id} onClick={()=>{
                    setPendingTransfers(prev=>[...prev,{outId:transferOut,inId:p.id}]);
                    if(localStarting.includes(transferOut))setLocalStarting(prev=>prev.map(id=>id===transferOut?p.id:id));
                    if(localCaptain===transferOut)setLocalCaptain(null);
                    setTransferOut(null);
                  }} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:C.surface,border:`1px solid ${C.green}44`,borderRadius:8,padding:"10px 12px",marginBottom:6,cursor:"pointer",textAlign:"left"}}>
                    <span style={{background:posColor(p.position)+'33',color:posColor(p.position),borderRadius:3,padding:"2px 5px",fontSize:9,fontWeight:700}}>{p.position}</span>
                    <span style={{flex:1,fontSize:13,fontWeight:600,color:C.text}}>{p.name}</span>
                    <span style={{fontSize:10,color:C.muted}}>{p.teamName}</span>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.green}}>{p.cost}</span>
                  </button>
                ))}
              </>
            );
          })()}

          {pendingTransfers.length>0&&(
            <div style={{marginTop:16,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:12}}>
              <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Pending</div>
              {pendingTransfers.map((t,i)=>{
                const out=allPlayers.find(p=>p.id===t.outId),inn=allPlayers.find(p=>p.id===t.inId);
                return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,marginBottom:4}}>
                    <span style={{color:C.red,flex:1}}>{out?.name}</span>
                    <span style={{color:C.muted}}>→</span>
                    <span style={{color:C.green,flex:1}}>{inn?.name}</span>
                    <button onClick={()=>{
                      setPendingTransfers(prev=>prev.filter((_,j)=>j!==i));
                      if(localStarting.includes(t.inId))setLocalStarting(prev=>prev.map(id=>id===t.inId?t.outId:id));
                    }} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:12,padding:0}}>✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {subView==='tips'&&(()=>{
        const pts=settings.points||DEFAULT_SETTINGS.points;
        const playedFixtures=fixtures.filter(f=>f.played);
        const byMW={};
        playedFixtures.forEach(f=>{const mw=f.matchWeek||0;if(!byMW[mw])byMW[mw]=[];byMW[mw].push(f);});
        // compute top-5 per MW
        const mwTop5={};
        Object.entries(byMW).forEach(([mw,mwF])=>{
          const ratings=[];
          mwF.forEach(f=>(f.playerStats||[]).forEach(ps=>{
            const pl=allPlayers.find(p=>p.id===ps.playerId);if(!pl)return;
            const ih=f.homeId===pl.teamId,ia=f.awayId===pl.teamId;if(!ih&&!ia)return;
            const res=ih?(f.homeScore>f.awayScore?'win':f.homeScore<f.awayScore?'loss':'draw'):(f.awayScore>f.homeScore?'win':f.awayScore<f.homeScore?'loss':'draw');
            ratings.push({playerId:ps.playerId,rating:calcMatchRating(ps,pl.position,res)});
          }));
          mwTop5[mw]=new Set(ratings.sort((a,b)=>b.rating-a.rating).slice(0,5).map(r=>r.playerId));
        });
        // total points per player across all MWs
        const playerTotals=allPlayers.map(p=>{
          let total=0;
          Object.entries(byMW).forEach(([mw,mwF])=>{total+=scorePlayer(p.id,{...p,teamId:teams.find(t=>t.players.some(pl=>pl.id===p.id))?.id},mwF,pts,mwTop5[mw]||new Set());});
          const mwsPlayed=Object.values(byMW).filter(mwF=>mwF.some(f=>(f.playerStats||[]).some(ps=>ps.playerId===p.id))).length;
          return{...p,totalPts:total,mwsPlayed,ptsPerCr:p.cost>0?total/p.cost:0,ptsPerMW:mwsPlayed>0?total/mwsPlayed:0};
        });
        const withData=playerTotals.filter(p=>p.mwsPlayed>0);
        const steals=playerTotals.filter(p=>p.mwsPlayed>0).sort((a,b)=>b.ptsPerCr-a.ptsPerCr).slice(0,6);
        const avoid=withData.filter(p=>p.cost>=6).sort((a,b)=>a.ptsPerCr-b.ptsPerCr).slice(0,5);
        // form: top scorers from last 2 MWs
        const mwNums=Object.keys(byMW).map(Number).sort((a,b)=>b-a);
        const recentMWs=mwNums.slice(0,2);
        const recentTop=playerTotals.map(p=>{
          let recent=0;
          recentMWs.forEach(mw=>{if(byMW[mw])recent+=scorePlayer(p.id,{...p,teamId:teams.find(t=>t.players.some(pl=>pl.id===p.id))?.id},byMW[mw],pts,mwTop5[mw]||new Set());});
          return{...p,recentPts:recent};
        }).filter(p=>p.recentPts>0).sort((a,b)=>b.recentPts-a.recentPts).slice(0,5);
        const rawRating=p=>p.position==='MDF'?((p.mdfAtkScore||5)+(p.mdfDefScore||5))/2:(p.score||5);
        const TipCard=({p,badge,badgeColor,stat,statLabel,sub})=>(
          <div style={{display:"flex",alignItems:"center",gap:10,background:C.surface,borderRadius:8,padding:"10px 12px",marginBottom:6}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:p.teamColor||C.accent,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:8,fontWeight:700,color:isLight(p.teamColor||'')?'#000':'#fff'}}>{p.position}</span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
              <div style={{fontSize:10,color:C.muted}}>{p.teamName} · {p.cost}cr{sub?` · ${sub}`:''}</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:badgeColor}}>{stat}</div>
              <div style={{fontSize:9,color:C.muted}}>{statLabel}</div>
            </div>
            <div style={{background:badgeColor+'22',color:badgeColor,borderRadius:4,padding:"2px 6px",fontSize:9,fontWeight:700,flexShrink:0}}>{badge}</div>
          </div>
        );
        // Pre-season tips (no match data yet)
        if(withData.length===0){
          // Best value by rating/cost per position
          const valueByPos={};
          ['GK','DEF','MDF','FWD'].forEach(pos=>{
            valueByPos[pos]=allPlayers.filter(p=>p.position===pos).map(p=>({...p,valuePer:rawRating(p)/p.cost})).sort((a,b)=>b.valuePer-a.valuePer).slice(0,3);
          });
          // Pick across all positions simultaneously by value (rating/cost) so no position hogs budget
          const greedySquad=[];
          let rem=BUDGET;
          const filled={GK:0,DEF:0,MDF:0,FWD:0};
          const pickedSet=new Set();
          const allByValue=allPlayers.filter(p=>p.name).map(p=>({...p,val:rawRating(p)/p.cost})).sort((a,b)=>b.val-a.val);
          for(const p of allByValue){
            if(greedySquad.length>=9)break;
            if(filled[p.position]>=REQUIRED[p.position])continue;
            pickedSet.add(p.id);
            const tempFilled={...filled,[p.position]:filled[p.position]+1};
            let minRem=0;
            for(const[pos,req]of Object.entries(REQUIRED)){
              const need=req-tempFilled[pos];
              if(need<=0)continue;
              const cheapest=allPlayers.filter(q=>q.position===pos&&!pickedSet.has(q.id)).sort((a,b)=>a.cost-b.cost).slice(0,need);
              minRem+=cheapest.reduce((s,q)=>s+q.cost,0);
            }
            if(p.cost+minRem<=rem){greedySquad.push(p);rem-=p.cost;filled[p.position]++;}
            else{pickedSet.delete(p.id);}
          }
          const greedyCost=BUDGET-rem;
          return(
            <div>
              {greedySquad.length>0&&(
                <div style={{marginBottom:20}}>
                  <SLabel>⭐ Suggested Starting Squad</SLabel>
                  <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Best 9 players by rating within the {BUDGET}cr budget · Total cost: {greedyCost}cr · {rem}cr remaining</div>
                  {['GK','DEF','MDF','FWD'].map(pos=>(
                    <div key={pos}>
                      {greedySquad.filter(p=>p.position===pos).map(p=>(
                        <TipCard key={p.id} p={p} badge={pos} badgeColor={posColor(pos)} stat={rawRating(p).toFixed(1)} statLabel="rating" sub={`${rem+greedySquad.filter(q=>q.position===pos&&q.id!==p.id).reduce((s,q)=>s+q.cost,0)+p.cost}cr slot`}/>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <div style={{marginBottom:20}}>
                <SLabel>🔥 Best Value by Position</SLabel>
                <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Highest rating per credit — steals at their price</div>
                {['GK','DEF','MDF','FWD'].map(pos=>(
                  <div key={pos} style={{marginBottom:12}}>
                    <div style={{fontSize:9,fontWeight:700,color:posColor(pos),letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>{pos}</div>
                    {valueByPos[pos].map(p=><TipCard key={p.id} p={p} badge="VALUE" badgeColor={C.green} stat={`${p.valuePer.toFixed(2)}`} statLabel="rating/cr"/>)}
                  </div>
                ))}
              </div>
              <div style={{marginBottom:20}}>
                <SLabel>⚠️ Overpriced to Watch Out For</SLabel>
                <div style={{fontSize:11,color:C.muted,marginBottom:10}}>High cost players with ratings that don't justify the price</div>
                {allPlayers.filter(p=>p.cost>=7).map(p=>({...p,valuePer:rawRating(p)/p.cost})).sort((a,b)=>a.valuePer-b.valuePer).slice(0,5).map(p=>(
                  <TipCard key={p.id} p={p} badge="PRICEY" badgeColor={C.red} stat={rawRating(p).toFixed(1)} statLabel="rating"/>
                ))}
              </div>
            </div>
          );
        }
        return(
          <div>
            {steals.length>0&&(
              <div style={{marginBottom:20}}>
                <SLabel>🔥 Best Value Picks</SLabel>
                <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Highest fantasy points per credit — most bang for your buck</div>
                {steals.map(p=><TipCard key={p.id} p={p} badge="VALUE" badgeColor={C.green} stat={`${p.ptsPerCr.toFixed(1)}`} statLabel="pts/cr"/>)}
              </div>
            )}
            {recentTop.length>0&&(
              <div style={{marginBottom:20}}>
                <SLabel>⚡ In Form</SLabel>
                <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Top scorers over the last {recentMWs.length} matchweek{recentMWs.length!==1?'s':''}</div>
                {recentTop.map(p=><TipCard key={p.id} p={p} badge="FORM" badgeColor={C.gold} stat={`+${Math.round(p.recentPts)}`} statLabel="recent pts"/>)}
              </div>
            )}
            {avoid.length>0&&(
              <div style={{marginBottom:20}}>
                <SLabel>⚠️ Consider Avoiding</SLabel>
                <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Expensive players (6cr+) with low points return</div>
                {avoid.map(p=><TipCard key={p.id} p={p} badge="AVOID" badgeColor={C.red} stat={`${p.ptsPerCr.toFixed(1)}`} statLabel="pts/cr"/>)}
              </div>
            )}
          </div>
        );
      })()}

      {subView==='points'&&(
        <div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:16,textAlign:"center"}}>
            <div style={{fontSize:10,color:C.muted,letterSpacing:1,textTransform:"uppercase"}}>Season Total</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:52,color:C.gold,lineHeight:1}}>{Math.round(totalPoints)}</div>
            <div style={{fontSize:11,color:C.muted}}>fantasy points</div>
          </div>
          {breakdown.length===0&&<div style={{textAlign:"center",color:C.muted,fontSize:12,padding:32}}>No points yet — lock your lineup before matchweek begins</div>}
          {breakdown.map(mwRow=>(
            <div key={mwRow.mw} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 14px",marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>Match Week {mwRow.mw}</div>
                  {mwRow.captain&&<div style={{fontSize:10,color:C.gold}}>C: {mwRow.captain}{mwRow.boostUsed==='tripleCaptain'?' (3×)':' (2×)'}</div>}
                  {mwRow.boostUsed&&mwRow.boostUsed!=='tripleCaptain'&&<div style={{fontSize:10,color:C.accent}}>{mwRow.boostUsed==='benchBoost'?'Bench Boost':'Wildcard'} used</div>}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:C.gold}}>{Math.round(mwRow.pts)}</div>
                  {mwRow.deduction>0&&<div style={{fontSize:10,color:C.red}}>−{mwRow.deduction} transfers</div>}
                </div>
              </div>
              {mwRow.details.map((d,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,padding:"3px 0",borderTop:i===0?`1px solid ${C.border}33`:"none"}}>
                  <span style={{display:"flex",alignItems:"center",gap:4}}>
                    {d.isCaptain&&<span style={{background:C.gold,color:"#000",borderRadius:3,padding:"0 4px",fontSize:8,fontWeight:900,flexShrink:0}}>C</span>}
                    {d.topRated&&<span style={{color:C.gold,fontSize:9}}>★</span>}
                    {d.playerName}
                  </span>
                  <span style={{color:d.pts>0?C.green:d.pts<0?C.red:C.muted}}>{d.pts>0?'+':''}{Math.round(d.pts)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LeaderboardTab ────────────────────────────────────────────────────────────

function LeaderboardTab({leagueData,allUserRecords,teams,fixtures,settings=DEFAULT_SETTINGS,currentUsername}){
  if(!leagueData)return<div style={{padding:40,textAlign:"center",color:C.muted}}>Join or create a league to see the leaderboard.</div>;

  const members=leagueData.members||[];
  const memberData=members.map(u=>{
    const rec=allUserRecords.find(r=>r.username===u);
    if(!rec)return{username:u,balance:100,fantasyPoints:0,betsWon:0,betsTotal:0};
    const bets=rec.bets||[];
    const{totalPoints}=calcFantasyPoints(rec.fantasySquad||rec.fantasyPlayerIds||[],rec.fantasyHistory||{},teams,fixtures,settings);
    return{username:u,balance:rec.balance,fantasyPoints:totalPoints,betsWon:bets.filter(b=>b.status==='won').length,betsTotal:bets.filter(b=>b.status!=='open').length};
  }).sort((a,b)=>b.fantasyPoints-a.fantasyPoints||b.balance-a.balance);

  return(
    <div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:20}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:C.gold,letterSpacing:1}}>{leagueData.displayName}</div>
        <div style={{fontSize:11,color:C.muted,marginTop:2}}>{members.length} member{members.length!==1?'s':''} · Created by {leagueData.createdBy}</div>
      </div>
      <SLabel>Standings</SLabel>
      {memberData.map((m,i)=>(
        <div key={m.username} style={{background:C.card,border:`1px solid ${m.username===currentUsername?C.gold:C.border}`,borderLeft:`3px solid ${i===0?C.gold:i===1?C.muted:i===2?'#cd7f32':C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:i===0?C.gold:i===1?C.muted:i===2?'#cd7f32':C.muted,width:28,textAlign:"center"}}>{i+1}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:700,color:m.username===currentUsername?C.gold:C.text}}>{m.username}{m.username===currentUsername?' (you)':''}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:2}}>Bets: {m.betsWon}/{m.betsTotal}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:C.green}}>{m.fantasyPoints} pts</div>
            <div style={{fontSize:10,color:C.muted}}>${m.balance.toFixed(2)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ManageTab ─────────────────────────────────────────────────────────────────

const MANAGE_PASSWORD='BMLSeditor';

function ManageTab({teams,settings,onSaveSettings}){
  const[pw,setPw]=useState('');
  const[unlocked,setUnlocked]=useState(false);
  const[err,setErr]=useState(false);
  const[local,setLocal]=useState(()=>({
    fantasyBudget:settings.fantasyBudget??DEFAULT_SETTINGS.fantasyBudget,
    points:{...DEFAULT_SETTINGS.points,...(settings.points||{})},
    playerCosts:{...(settings.playerCosts||{})},
  }));
  const[saved,setSaved]=useState(false);

  const allPlayers=teams.flatMap(t=>t.players.filter(p=>p.name).map(p=>({...p,teamName:t.name,teamColor:t.color})));

  if(!unlocked){
    return(
      <div style={{maxWidth:360,margin:"60px auto 0",background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:28}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:1,color:C.white,marginBottom:6}}>Manage</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:20}}>Enter password to edit fantasy settings.</div>
        <input autoFocus type="password" value={pw} onChange={e=>{setPw(e.target.value);setErr(false);}} onKeyDown={e=>e.key==='Enter'&&(pw===MANAGE_PASSWORD?(setUnlocked(true),setErr(false)):setErr(true))} placeholder="Password" style={{width:"100%",background:C.surface,border:`1px solid ${err?C.red:C.border}`,borderRadius:8,padding:"10px 14px",fontSize:14,color:C.text,outline:"none",fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",marginBottom:err?6:16}}/>
        {err&&<div style={{fontSize:11,color:C.red,marginBottom:12}}>Incorrect password.</div>}
        <Btn onClick={()=>pw===MANAGE_PASSWORD?(setUnlocked(true),setErr(false)):setErr(true)} variant="primary">Unlock</Btn>
      </div>
    );
  }

  const setPoints=(key,val)=>setLocal(l=>({...l,points:{...l.points,[key]:val}}));
  const setPlayerCost=(pid,val)=>setLocal(l=>({...l,playerCosts:{...l.playerCosts,[pid]:val}}));
  const resetPlayerCost=pid=>setLocal(l=>{const c={...l.playerCosts};delete c[pid];return{...l,playerCosts:c};});

  const save=async()=>{
    await onSaveSettings(local);
    setSaved(true);
    setTimeout(()=>setSaved(false),2000);
  };

  const PtRow=({label,field})=>(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.border}22`}}>
      <span style={{fontSize:13,color:C.text}}>{label}</span>
      <input type="number" value={local.points[field]} onChange={e=>setPoints(field,+e.target.value)} style={{width:64,background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 8px",color:C.text,fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:"none",textAlign:"center"}}/>
    </div>
  );

  return(
    <div>
      {/* Budget */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:16}}>
        <SLabel>Fantasy Budget</SLabel>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <input type="number" min="10" max="200" value={local.fantasyBudget} onChange={e=>setLocal(l=>({...l,fantasyBudget:+e.target.value}))} style={{width:80,background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 12px",color:C.text,fontSize:16,fontWeight:700,fontFamily:"'DM Sans',sans-serif",outline:"none",textAlign:"center"}}/>
          <span style={{fontSize:12,color:C.muted}}>credits total per squad</span>
        </div>
      </div>

      {/* Points config */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:16}}>
        <SLabel>Fantasy Points Per Event</SLabel>
        <PtRow label="Goal" field="goal"/>
        <PtRow label="Assist" field="assist"/>
        <PtRow label="Appearance" field="appearance"/>
        <PtRow label="Clean Sheet (GK & DEF)" field="gkCleanSheet"/>
        <PtRow label="Penalty Save (GK)" field="penSave"/>
        <PtRow label="Top 5 Rated (matchweek)" field="mwTopBonus"/>
        <PtRow label="Rating 8+ bonus" field="ratingHigh"/>
        <PtRow label="Rating ≤4 penalty" field="ratingLow"/>
        <PtRow label="Yellow card" field="yellow"/>
        <PtRow label="Red card" field="red"/>
      </div>

      {/* Player costs */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:20}}>
        <SLabel>Player Costs (credits)</SLabel>
        <div style={{fontSize:11,color:C.muted,marginBottom:12}}>Leave blank to use auto-calculated cost based on player score.</div>
        {['GK','DEF','MDF','FWD'].map(pos=>{
          const rawScore=p=>p.position==='MDF'?((p.mdfAtkScore||5)+(p.mdfDefScore||5))/2:(p.score||5);
          const posPlayers=allPlayers.filter(p=>p.position===pos).sort((a,b)=>rawScore(b)-rawScore(a)||a.name.localeCompare(b.name));
          if(!posPlayers.length)return null;
          return(
            <div key={pos} style={{marginBottom:12}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:2,color:posColor(pos),textTransform:"uppercase",marginBottom:6,paddingBottom:4,borderBottom:`1px solid ${posColor(pos)}33`}}>{pos}</div>
              {posPlayers.map(p=>{
                const raw=p.position==='MDF'?((p.mdfAtkScore||5)+(p.mdfDefScore||5))/2:(p.score||5);const auto=ratingToCost(raw);
                const custom=local.playerCosts[p.id];
                return(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:`1px solid ${C.border}22`}}>
                    <span style={{flex:1,fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
                    <span style={{fontSize:10,color:C.muted,flexShrink:0}}>{p.teamName}</span>
                    <span style={{fontSize:10,color:C.muted,flexShrink:0}}>auto:{auto}</span>
                    <input type="number" min="1" max="20" placeholder={String(auto)} value={custom??''} onChange={e=>e.target.value===''?resetPlayerCost(p.id):setPlayerCost(p.id,+e.target.value)} style={{width:56,background:C.surface,border:`1px solid ${custom!=null?C.gold:C.border}`,borderRadius:6,padding:"4px 6px",color:C.text,fontSize:12,fontFamily:"'DM Sans',sans-serif",outline:"none",textAlign:"center"}}/>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <Btn onClick={save} variant="gold" style={{width:"100%"}}>{saved?'✓ Saved!':'Save Settings'}</Btn>
    </div>
  );
}

// ── BettingApp root ───────────────────────────────────────────────────────────

function BettingApp(){
  const[screen,setScreen]=useState('loading');
  const[bmls,setBmls]=useState(null);
  const[userData,setUserData]=useState(null);
  const[leagueData,setLeagueData]=useState(null);
  const[allUserRecords,setAllUserRecords]=useState([]);
  const[allFixtures,setAllFixtures]=useState([]);
  const[settings,setSettings]=useState(DEFAULT_SETTINGS);
  const[tab,setTab]=useState('bet');
  const[seasonReset,setSeasonReset]=useState(false);

  const load=async()=>{
    const data=await loadBMLSState();
    setBmls(data);
    const bettingUsers=data.fixtures.filter(f=>f.type==='betting_user');
    setAllUserRecords(bettingUsers);
    setAllFixtures(data.fixtures);
    const savedSettings=data.fixtures.find(f=>f.id==='betting_settings');
    if(savedSettings)setSettings({...DEFAULT_SETTINGS,...savedSettings,points:{...DEFAULT_SETTINGS.points,...savedSettings.points}});
    const saved=localStorage.getItem('bmls_betting_username');
    if(saved){
      const existing=bettingUsers.find(u=>u.username===saved);
      if(existing){
        // Check season reset
        const maxMW=data.fixtures.filter(f=>f.matchWeek!=null).reduce((m,f)=>Math.max(m,f.matchWeek),0);
        if(existing.lastResetHighestMW>0&&maxMW<existing.lastResetHighestMW-2){
          // New season detected — reset balance
          const reset={...existing,balance:100,bets:[],fantasySquad:[],fantasyHistory:{},freeTransfers:1,boostsAvailable:{benchBoost:true,tripleCaptain:true,wildcard:true},lastResetHighestMW:maxMW};
          await saveRecord(reset.id,reset);
          setUserData(reset);
          setSeasonReset(true);
        } else {
          // Settle open bets
          const settled=settleOpenBets(existing,data);
          if(settled!==existing){await saveRecord(settled.id,settled);}
          setUserData(settled);
        }
        if(existing.leagueName){
          const league=data.fixtures.find(f=>f.id===`betting_league_${existing.leagueName}`);
          if(league)setLeagueData(league);
        }
        setScreen('app');
        return;
      }
    }
    setScreen('username');
  };

  useEffect(()=>{load();},[]);

  function settleOpenBets(user,data){
    const bets=user.bets||[];
    let balance=user.balance;
    let changed=false;
    const maxMW=data.fixtures.filter(f=>f.matchWeek!=null).reduce((m,f)=>Math.max(m,f.matchWeek||0),0);
    const newBets=bets.map(b=>{
      if(b.status!=='open')return b;
      const fixture=data.fixtures.find(f=>f.id===b.fixtureId||f.id===String(b.fixtureId));
      if(!fixture||!fixture.played)return b;
      const won=checkBetResult(b,fixture);
      if(won===null)return b;
      changed=true;
      const payout=won?+(b.stake*b.odds).toFixed(2):0;
      if(won)balance=+(balance+payout).toFixed(2);
      return{...b,status:won?'won':'lost',payout};
    });
    if(!changed)return user;
    return{...user,bets:newBets,balance,lastResetHighestMW:Math.max(user.lastResetHighestMW||0,maxMW)};
  }

  const handleLogin=async(user,isNew)=>{
    localStorage.setItem('bmls_betting_username',user.username);
    if(isNew){
      await saveRecord(user.id,user);
      setUserData(user);
      setScreen('league');
    } else {
      const maxMW=allFixtures.filter(f=>f.matchWeek!=null).reduce((m,f)=>Math.max(m,f.matchWeek||0),0);
      const settled=settleOpenBets(user,bmls);
      if(settled!==user)await saveRecord(settled.id,settled);
      setUserData(settled);
      if(user.leagueName){
        const league=allFixtures.find(f=>f.id===`betting_league_${user.leagueName}`);
        if(league)setLeagueData(league);
      }
      if(user.leagueName)setScreen('app');
      else setScreen('league');
    }
  };

  const handleLeagueDone=async(leagueSlug,league)=>{
    const updated={...userData,leagueName:leagueSlug};
    await saveRecord(updated.id,updated);
    setUserData(updated);
    if(league)setLeagueData(league);
    setScreen('app');
  };

  const handlePlaceBet=async(bet)=>{
    const newBets=[...(userData.bets||[]),bet];
    const newBalance=+(userData.balance-bet.stake).toFixed(2);
    const updated={...userData,bets:newBets,balance:newBalance};
    setUserData(updated);
    await saveRecord(updated.id,updated);
  };

  const handleSaveSettings=async(newSettings)=>{
    const record={id:'betting_settings',type:'betting_settings',...newSettings};
    await saveRecord('betting_settings',record);
    setSettings({...DEFAULT_SETTINGS,...newSettings,points:{...DEFAULT_SETTINGS.points,...newSettings.points}});
  };

  const handleSaveFantasy=async({squad,history,freeTransfers,boostsAvailable})=>{
    const updated={...userData,fantasySquad:squad,fantasyHistory:history,freeTransfers,boostsAvailable};
    setUserData(updated);
    await saveRecord(updated.id,updated);
    const data=await loadBMLSState();
    setAllUserRecords(data.fixtures.filter(f=>f.type==='betting_user'));
  };

  if(screen==='loading')return<div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted}}>Loading…</div>;
  if(screen==='username')return<UsernameScreen allUsers={allUserRecords} onLogin={handleLogin}/>;
  if(screen==='league')return<LeagueScreen username={userData?.username} allFixtures={allFixtures} onDone={handleLeagueDone}/>;

  const teams=bmls?.teams||[];
  const fixtures=bmls?.fixtures?.filter(f=>f.homeId&&f.awayId&&!f.type)||[];
  const openBetCount=(userData?.bets||[]).filter(b=>b.status==='open').length;
  const TABS=[{key:'bet',label:'Bet'},{key:'mybets',label:`My Bets${openBetCount?` (${openBetCount})`:''}` },{key:'fantasy',label:'Fantasy'},{key:'leaderboard',label:'League'},{key:'manage',label:'Manage'}];

  return(
    <div style={{background:C.bg,minHeight:"100vh",fontFamily:"'DM Sans',sans-serif"}}>
      {/* Header */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"0 16px"}}>
        <div style={{maxWidth:720,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:52}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <a href="/" style={{color:C.muted,fontSize:11,textDecoration:"none"}}>← BMLS</a>
            <span style={{color:C.border}}>|</span>
            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:C.gold,letterSpacing:1}}>BET & FANTASY</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:9,color:C.muted,letterSpacing:1}}>BALANCE</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:C.gold}}>${userData.balance.toFixed(2)}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
              <div style={{fontSize:11,color:C.muted}}>{userData.username}</div>
              <button onClick={()=>{localStorage.removeItem('bmls_betting_username');setScreen('username');setUserData(null);setLeagueData(null);setTab('bet');}} style={{background:"none",border:"none",fontSize:10,color:C.muted,cursor:"pointer",padding:0,fontFamily:"'DM Sans',sans-serif",textDecoration:"underline"}}>Log out</button>
            </div>
          </div>
        </div>
      </div>

      {/* Season reset banner */}
      {seasonReset&&(
        <div style={{background:C.accent,padding:"10px 16px",textAlign:"center",fontSize:12,color:"#fff",fontWeight:600}}>
          New season detected — balance reset to $100 🎉
        </div>
      )}

      {/* Tabs */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`}}>
        <div style={{maxWidth:720,margin:"0 auto",display:"flex"}}>
          {TABS.map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)} style={{flex:1,background:"none",border:"none",borderBottom:`2px solid ${tab===t.key?C.gold:'transparent'}`,padding:"12px 8px",color:tab===t.key?C.gold:C.muted,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",letterSpacing:.5,whiteSpace:"nowrap"}}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{maxWidth:720,margin:"0 auto",padding:"16px 16px 40px"}}>
        {tab==='bet'&&<BettingTab teams={teams} fixtures={fixtures} userData={userData} onPlaceBet={handlePlaceBet}/>}
        {tab==='mybets'&&<MyBetsTab userData={userData}/>}
        {tab==='fantasy'&&<FantasyTab teams={teams} fixtures={fixtures} userData={userData} settings={settings} onSaveFantasy={handleSaveFantasy}/>}
        {tab==='leaderboard'&&<LeaderboardTab leagueData={leagueData} allUserRecords={allUserRecords} teams={teams} fixtures={fixtures} settings={settings} currentUsername={userData.username}/>}
        {tab==='manage'&&<ManageTab teams={teams} settings={settings} onSaveSettings={handleSaveSettings}/>}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<BettingApp/>);
