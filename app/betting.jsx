import React,{useState,useEffect,useMemo,useRef} from 'react'
import{createRoot}from 'react-dom/client'

const C={bg:"#0a0e1a",card:"#111827",surface:"#1E293B",border:"#1E293B",accent:"#3B82F6",gold:"#F59E0B",green:"#22c55e",red:"#ef4444",purple:"#A855F7",muted:"#64748B",sub:"#94A3B8",text:"#E2E8F0",white:"#F8FAFC"};
const posColor=p=>p==='GK'?C.purple:p==='DEF'?C.accent:p==='MDF'?'#f97316':C.red;

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

function fantasyPlayerCost(p){
  if(p.position==='MDF')return Math.round(((p.mdfAtkScore||5)+(p.mdfDefScore||5))/2);
  return p.score||5;
}

function calcFantasyPoints(fantasyPlayerIds,teams,fixtures){
  const allPlayers={};
  teams.forEach(t=>t.players.forEach(p=>{allPlayers[p.id]={...p,teamId:t.id,teamName:t.name,team:t};}));
  const byMW={};
  fixtures.filter(f=>f.played).forEach(f=>{
    const mw=f.matchWeek||0;
    if(!byMW[mw])byMW[mw]=[];
    byMW[mw].push(f);
  });
  let totalPoints=0;
  const breakdown=[];
  Object.entries(byMW).forEach(([mw,mwF])=>{
    let mwPts=0;const details=[];
    fantasyPlayerIds.forEach(pid=>{
      const player=allPlayers[pid];if(!player)return;
      mwF.forEach(f=>{
        const isHome=f.homeId===player.teamId,isAway=f.awayId===player.teamId;
        if(!isHome&&!isAway)return;
        const ps=(f.playerStats||[]).find(s=>s.playerId===pid);if(!ps)return;
        let pts=1;
        const result=isHome?(f.homeScore>f.awayScore?'win':f.homeScore<f.awayScore?'loss':'draw'):(f.awayScore>f.homeScore?'win':f.awayScore<f.homeScore?'loss':'draw');
        const rating=calcMatchRating(ps,player.position,result);
        pts+=(ps.goals||0)*6+(ps.assists||0)*3;
        if(player.position==='GK'&&((isHome&&f.awayScore===0)||(isAway&&f.homeScore===0)))pts+=4;
        if(ps.yellowCards)pts-=ps.yellowCards;
        if(ps.redCard)pts-=3;
        if(rating>=8)pts+=2;else if(rating<=4)pts-=1;
        mwPts+=pts;
        details.push({playerName:player.name,pts,goals:ps.goals||0,assists:ps.assists||0,rating});
      });
    });
    totalPoints+=mwPts;
    breakdown.push({mw:+mw,pts:mwPts,details});
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
    else{onLogin({id:`betting_user_${name.toLowerCase()}`,type:'betting_user',username:name.toLowerCase(),balance:100,bets:[],leagueName:null,fantasyPlayerIds:[],fantasyLockedMW:null,fantasyPointsHistory:[],lastResetHighestMW:0},true);}
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

  const upcoming=fixtures.filter(f=>!f.played&&f.homeId&&f.awayId);
  const byMW={};
  upcoming.forEach(f=>{const mw=f.matchWeek||0;if(!byMW[mw])byMW[mw]=[];byMW[mw].push(f);});
  const mws=Object.keys(byMW).map(Number).sort((a,b)=>a-b);

  if(!upcoming.length)return<div style={{padding:32,textAlign:"center",color:C.muted}}>No upcoming fixtures to bet on.</div>;

  const groups=['Match Result','Goals','BTTS','Margin'];

  return(
    <div>
      <div style={{background:C.surface,borderRadius:12,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{fontSize:12,color:C.muted}}>Balance</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.gold}}>${userData.balance.toFixed(2)}</div>
      </div>
      {mws.map(mw=>(
        <div key={mw} style={{marginBottom:24}}>
          {mw>0&&<SLabel>Match Week {mw}</SLabel>}
          {byMW[mw].map(f=>{
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
      ))}
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

function FantasyTab({teams,fixtures,userData,onSaveFantasy}){
  const BUDGET=45;
  const[picks,setPicks]=useState(userData.fantasyPlayerIds||[]);
  const[saving,setSaving]=useState(false);
  const currentMW=activeMatchWeek(fixtures);
  const isLocked=userData.fantasyLockedMW===currentMW;

  const allPlayers=useMemo(()=>{
    const arr=[];
    teams.forEach(t=>t.players.filter(p=>p.name).forEach(p=>arr.push({...p,teamName:t.name,teamColor:t.color,cost:fantasyPlayerCost(p)})));
    return arr;
  },[teams]);

  const pickedPlayers=picks.map(id=>allPlayers.find(p=>p.id===id)).filter(Boolean);
  const spent=pickedPlayers.reduce((s,p)=>s+p.cost,0);
  const remaining=BUDGET-spent;
  const hasGK=pickedPlayers.some(p=>p.position==='GK');
  const canLock=picks.length===6&&hasGK&&!isLocked;

  const toggle=p=>{
    if(isLocked)return;
    if(picks.includes(p.id)){setPicks(prev=>prev.filter(id=>id!==p.id));return;}
    if(picks.length>=6)return;
    if(p.cost>remaining)return;
    setPicks(prev=>[...prev,p.id]);
  };

  const lock=async()=>{
    setSaving(true);
    await onSaveFantasy(picks,currentMW);
    setSaving(false);
  };

  const{totalPoints,breakdown}=useMemo(()=>calcFantasyPoints(picks,teams,fixtures),[picks,teams,fixtures]);

  const posOrder=['GK','DEF','MDF','FWD'];
  const byPos={};
  posOrder.forEach(pos=>{byPos[pos]=allPlayers.filter(p=>p.position===pos).sort((a,b)=>b.cost-a.cost);});

  return(
    <div>
      {/* Squad summary */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div>
            <div style={{fontSize:10,color:C.muted,letterSpacing:1,textTransform:"uppercase"}}>Budget</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:remaining<0?C.red:C.text}}>{remaining<0?'OVER':''}  {Math.abs(remaining)} pts remaining</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:10,color:C.muted,letterSpacing:1,textTransform:"uppercase"}}>Fantasy Pts</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:C.gold}}>{totalPoints}</div>
          </div>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
          {picks.length===0&&<div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>Pick 6 players (must include 1 GK)</div>}
          {pickedPlayers.map(p=>(
            <div key={p.id} style={{background:posColor(p.position)+'22',border:`1px solid ${posColor(p.position)}`,borderRadius:6,padding:"4px 8px",display:"flex",alignItems:"center",gap:5}}>
              <span style={{fontSize:9,fontWeight:700,color:posColor(p.position)}}>{p.position}</span>
              <span style={{fontSize:11,color:C.text,fontWeight:600}}>{p.name}</span>
              {!isLocked&&<button onClick={()=>toggle(p)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:12,padding:0,lineHeight:1}}>×</button>}
            </div>
          ))}
        </div>
        {!isLocked&&<Btn onClick={lock} disabled={!canLock||saving} variant="gold">{saving?'Saving…':`Lock Squad for MW ${currentMW}`}</Btn>}
        {isLocked&&<div style={{background:C.green+'22',border:`1px solid ${C.green}`,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.green,fontWeight:600}}>Squad locked for Match Week {currentMW}</div>}
        {!hasGK&&picks.length>0&&<div style={{fontSize:11,color:C.gold,marginTop:6}}>Must include at least 1 GK</div>}
      </div>

      {/* Points breakdown */}
      {breakdown.length>0&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:16}}>
          <SLabel>Points Breakdown</SLabel>
          {breakdown.map(mwRow=>(
            <div key={mwRow.mw} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:700,color:C.text,marginBottom:4}}>
                <span>Match Week {mwRow.mw}</span>
                <span style={{color:C.gold}}>{mwRow.pts} pts</span>
              </div>
              {mwRow.details.map((d,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,padding:"2px 0"}}>
                  <span>{d.playerName}</span>
                  <span style={{color:d.pts>0?C.green:C.red}}>{d.pts>0?'+':''}{d.pts}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Player picker */}
      {!isLocked&&(
        <>
          <SLabel>Pick Your Squad · Budget {BUDGET} pts</SLabel>
          {posOrder.map(pos=>(
            <div key={pos} style={{marginBottom:16}}>
              <div style={{fontSize:10,fontWeight:700,color:posColor(pos),letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{pos}</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {byPos[pos].map(p=>{
                  const isPicked=picks.includes(p.id);
                  const cantAfford=!isPicked&&p.cost>remaining;
                  const full=!isPicked&&picks.length>=6;
                  return(
                    <button key={p.id} onClick={()=>toggle(p)} disabled={cantAfford||full} style={{background:isPicked?posColor(p.position)+'22':C.surface,border:`1px solid ${isPicked?posColor(p.position):C.border}`,borderRadius:8,padding:"10px 12px",cursor:cantAfford||full?'not-allowed':'pointer',opacity:cantAfford||full?0.45:1,display:"flex",alignItems:"center",gap:10,textAlign:"left"}}>
                      <div style={{background:posColor(p.position)+'33',borderRadius:4,padding:"2px 5px",fontSize:9,fontWeight:700,color:posColor(p.position),flexShrink:0}}>{p.position}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.text}}>{p.name}</div>
                        <div style={{fontSize:10,color:C.muted}}>{p.teamName}</div>
                      </div>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:isPicked?posColor(p.position):C.gold}}>{p.cost}</div>
                      {isPicked&&<span style={{color:posColor(p.position),fontSize:14}}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── LeaderboardTab ────────────────────────────────────────────────────────────

function LeaderboardTab({leagueData,allUserRecords,teams,fixtures,currentUsername}){
  if(!leagueData)return<div style={{padding:40,textAlign:"center",color:C.muted}}>Join or create a league to see the leaderboard.</div>;

  const members=leagueData.members||[];
  const memberData=members.map(u=>{
    const rec=allUserRecords.find(r=>r.username===u);
    if(!rec)return{username:u,balance:100,fantasyPoints:0,betsWon:0,betsTotal:0};
    const bets=rec.bets||[];
    const{totalPoints}=calcFantasyPoints(rec.fantasyPlayerIds||[],teams,fixtures);
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

// ── BettingApp root ───────────────────────────────────────────────────────────

function BettingApp(){
  const[screen,setScreen]=useState('loading');
  const[bmls,setBmls]=useState(null);
  const[userData,setUserData]=useState(null);
  const[leagueData,setLeagueData]=useState(null);
  const[allUserRecords,setAllUserRecords]=useState([]);
  const[allFixtures,setAllFixtures]=useState([]);
  const[tab,setTab]=useState('bet');
  const[seasonReset,setSeasonReset]=useState(false);

  const load=async()=>{
    const data=await loadBMLSState();
    setBmls(data);
    const bettingUsers=data.fixtures.filter(f=>f.type==='betting_user');
    setAllUserRecords(bettingUsers);
    setAllFixtures(data.fixtures);
    const saved=localStorage.getItem('bmls_betting_username');
    if(saved){
      const existing=bettingUsers.find(u=>u.username===saved);
      if(existing){
        // Check season reset
        const maxMW=data.fixtures.filter(f=>f.matchWeek!=null).reduce((m,f)=>Math.max(m,f.matchWeek),0);
        if(existing.lastResetHighestMW>0&&maxMW<existing.lastResetHighestMW-2){
          // New season detected — reset balance
          const reset={...existing,balance:100,bets:[],fantasyPlayerIds:[],fantasyLockedMW:null,fantasyPointsHistory:[],lastResetHighestMW:maxMW};
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

  const handleSaveFantasy=async(playerIds,mw)=>{
    const updated={...userData,fantasyPlayerIds:playerIds,fantasyLockedMW:mw};
    setUserData(updated);
    await saveRecord(updated.id,updated);
    // Refresh allUserRecords so leaderboard is up to date
    const data=await loadBMLSState();
    setAllUserRecords(data.fixtures.filter(f=>f.type==='betting_user'));
  };

  if(screen==='loading')return<div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted}}>Loading…</div>;
  if(screen==='username')return<UsernameScreen allUsers={allUserRecords} onLogin={handleLogin}/>;
  if(screen==='league')return<LeagueScreen username={userData?.username} allFixtures={allFixtures} onDone={handleLeagueDone}/>;

  const teams=bmls?.teams||[];
  const fixtures=bmls?.fixtures?.filter(f=>f.homeId&&f.awayId&&!f.type)||[];
  const openBetCount=(userData?.bets||[]).filter(b=>b.status==='open').length;
  const TABS=[{key:'bet',label:'Bet'},{key:'mybets',label:`My Bets${openBetCount?` (${openBetCount})`:''}` },{key:'fantasy',label:'Fantasy'},{key:'leaderboard',label:'League'}];

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
            <div style={{fontSize:11,color:C.muted}}>{userData.username}</div>
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
        {tab==='fantasy'&&<FantasyTab teams={teams} fixtures={fixtures} userData={userData} onSaveFantasy={handleSaveFantasy}/>}
        {tab==='leaderboard'&&<LeaderboardTab leagueData={leagueData} allUserRecords={allUserRecords} teams={teams} fixtures={fixtures} currentUsername={userData.username}/>}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<BettingApp/>);
