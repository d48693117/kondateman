import { useState, useEffect, useRef, useCallback, Component } from "react";
import { MENU_DB, ALL_MENU_NAMES, MENU_CATEGORIES } from "./menuDB.js";

/* ══════════════════════════════════════════
   APP CONFIG
══════════════════════════════════════════ */
const APP_NAME    = "こんだてマン";
const DB_KEY      = "kondateman-v1";
const DAYS        = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const DAY_JP      = {monday:"月",tuesday:"火",wednesday:"水",thursday:"木",friday:"金",saturday:"土",sunday:"日"};
const GROUP_COLORS = ["#2E7D32","#1565C0","#E65100","#6A1B9A","#00695C","#AD1457","#37474F"];
const GROUP_LIGHT  = ["#E8F5E9","#E3F2FD","#FBE9E7","#F3E5F5","#E0F2F1","#FCE4EC","#ECEFF1"];
const CAT_COLORS   = ["#00897B","#1565C0","#E65100","#6A1B9A"];
const DIFF_LABELS  = ["","かんたん","ふつう","本格"];
const DIFF_COLORS  = ["","#43A047","#FB8C00","#E53935"];

/* ══════════════════════════════════════════
   INIT STATE
══════════════════════════════════════════ */
const INIT_SETTINGS = {
  sort_cats: [
    { id:"R", name:"2階", color:CAT_COLORS[0], dir:"right" },
    { id:"L", name:"3階", color:CAT_COLORS[1], dir:"left" }
  ],
  sheets_url:"", sheets_token:"",
  servings:2, rotation_weeks:3,
  ng_foods:[], frozen_meals:[],
  meal_config:{ lunch:{sides:0,soup:false}, dinner:{sides:2,soup:false} },
  day_groups:{ monday:1, tuesday:2, wednesday:1, thursday:2, friday:1, saturday:3, sunday:4 },
  group_constraints:{},
  recipe_sites:[
    {id:"nadia",   label:"Nadia",      url:"https://oceans-nadia.com/search?q={dish}"},
    {id:"cookpad", label:"クックパッド", url:"https://cookpad.com/search/{dish}"},
    {id:"youtube", label:"YouTube",    url:"https://www.youtube.com/results?search_query={dish}+レシピ"},
    {id:"insta",   label:"Instagram",  url:"https://www.instagram.com/explore/tags/{dish}レシピ"}
  ]
};

const INIT_STATE = {
  plan:null, session:null, sortMem:{}, dailyGoods:[],
  dishes:{}, ingredientMem:{},
  pendingUpdate:false,
  settings:INIT_SETTINGS
};

/* ══════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════ */
function sanitizeState(st){
  if(!st) return st;
  const s={...st};
  if(!Array.isArray(s.dailyGoods)) s.dailyGoods=[];
  s.dailyGoods=s.dailyGoods.filter(g=>typeof g==="string");
  if(typeof s.dishes!=="object"||Array.isArray(s.dishes)) s.dishes={};
  if(typeof s.ingredientMem!=="object"||Array.isArray(s.ingredientMem)) s.ingredientMem={};
  if(s.settings){
    const ss={...s.settings};
    if(!Array.isArray(ss.ng_foods)) ss.ng_foods=[];
    ss.ng_foods=ss.ng_foods.filter(f=>typeof f==="string");
    if(!Array.isArray(ss.frozen_meals)) ss.frozen_meals=[];
    if(!Array.isArray(ss.sort_cats)||!ss.sort_cats.every(c=>c&&typeof c==="object"&&typeof c.id==="string"))
      ss.sort_cats=INIT_SETTINGS.sort_cats;
    if(!Array.isArray(ss.recipe_sites)||!ss.recipe_sites.every(c=>c&&typeof c==="object"))
      ss.recipe_sites=INIT_SETTINGS.recipe_sites;
    if(Array.isArray(ss.day_groups)){
      const dict={};
      ss.day_groups.forEach((days,i)=>{ if(Array.isArray(days)) days.forEach(d=>{dict[d]=i+1;}); });
      ss.day_groups=Object.keys(dict).length>0?dict:{...INIT_SETTINGS.day_groups};
    }
    if(typeof ss.day_groups!=="object"||Array.isArray(ss.day_groups))
      ss.day_groups={...INIT_SETTINGS.day_groups};
    s.settings=ss;
  }
  return s;
}

function loadState(){
  try{
    const raw=localStorage.getItem(DB_KEY);
    if(raw){
      const p=JSON.parse(raw);
      const loaded={...INIT_STATE,...p, settings:{...INIT_SETTINGS,...(p.settings||{})}};
      return sanitizeState(loaded);
    }
  }catch(e){}
  return {...INIT_STATE};
}
function saveState(st){ try{localStorage.setItem(DB_KEY,JSON.stringify(st));}catch(e){} }

async function syncToSheets(url,token,data){
  if(!url) return;
  const r=await fetch("/api/sheets",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({gasUrl:url,token:token||"",data})});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const d=await r.json();
  if(d.error) throw new Error(d.error);
}
async function loadFromSheets(url,token){
  if(!url) return null;
  const r=await fetch(`/api/sheets?gasUrl=${encodeURIComponent(url)}&token=${encodeURIComponent(token||"")}`);
  if(!r.ok) return null;
  const d=await r.json();
  if(d.error) throw new Error(d.error);
  return d.data||null;
}

function deriveGroups(day_groups){
  const dg=day_groups||INIT_SETTINGS.day_groups;
  const map={};
  DAYS.forEach(day=>{ const gid=(dg[day]||1); if(!map[gid]) map[gid]=[]; map[gid].push(day); });
  return Object.entries(map)
    .sort((a,b)=>DAYS.indexOf(a[1][0])-DAYS.indexOf(b[1][0]))
    .map(([gid,days],idx)=>({
      id:`g${idx}`, gid:Number(gid), days,
      color:GROUP_COLORS[(Number(gid)-1)%GROUP_COLORS.length],
      light:GROUP_LIGHT[(Number(gid)-1)%GROUP_LIGHT.length],
      label:days.map(d=>DAY_JP[d]).join("・")
    }));
}

function weekStartStr(){
  const d=new Date(); const day=d.getDay();
  const diff=day===0?-6:1-day; d.setDate(d.getDate()+diff);
  return d.toISOString().split("T")[0];
}
function avg(arr){ return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0; }

/* ══════════════════════════════════════════
   MENU GENERATION (DB-based, no API)
══════════════════════════════════════════ */
function getEffectiveIngredients(dishName, dishes){
  const override=dishes[dishName];
  if(override?.activeVariant){
    const v=override.variants?.find(v=>v.variantId===override.activeVariant);
    if(v) return {ingredients:v.ingredients, seasonings:v.seasonings};
  }
  // Find in menuDB (flat array)
  const found=MENU_DB.find(i=>i.name===dishName);
  if(found){
    const variant=found.variants?.find(v=>v.variantId==="default")||found.variants?.[0];
    if(variant) return {ingredients:variant.ingredients, seasonings:variant.seasonings};
  }
  return {ingredients:[], seasonings:[]};
}

function weightedRandom(items){
  // items: [{item, weight}]
  const total=items.reduce((s,i)=>s+i.weight,0);
  if(total===0) return items[Math.floor(Math.random()*items.length)]?.item;
  let r=Math.random()*total;
  for(const {item,weight} of items){
    r-=weight;
    if(r<=0) return item;
  }
  return items[items.length-1]?.item;
}

function buildMenuFromDB(st, wantedText=""){
  const groups=deriveGroups(st.settings.day_groups);
  const rotW=st.settings.rotation_weeks||3;
  const ngFoods=st.settings.ng_foods||[];
  const dishes=st.dishes||{};
  const mealCfg=st.settings.meal_config||INIT_SETTINGS.meal_config;
  const frozen=st.settings.frozen_meals||[];
  const SOUP_PATTERN=/汁$|スープ$|お吸い物|汁物/;
  const wantedWords=wantedText.trim().split(/[\s,、]+/).filter(Boolean);

  const cutoff=Date.now()-(rotW*7*86400000);

  // All DB items flattened
  const allItems=MENU_DB;

  function isRecentlyServed(name){
    const d=dishes[name];
    if(!d?.lastServed) return false;
    return new Date(d.lastServed)>cutoff;
  }

  function hasNgFood(name){
    const {ingredients}=getEffectiveIngredients(name,dishes);
    return ngFoods.some(ng=>
      name.includes(ng)||
      ingredients.some(i=>i.name.includes(ng))
    );
  }

  function getWeight(name){
    const d=dishes[name];
    if(!d?.scores?.length) return 1;
    const a=avg(d.scores);
    if(a>=4.5) return 4;
    if(a>=4) return 3;
    if(a>=3) return 1.5;
    return 1;
  }

  function pickFromCats(cats, mealType, excludeNames=[]){
    const candidates=allItems.filter(item=>{
      if(excludeNames.includes(item.name)) return false;
      if(isRecentlyServed(item.name)) return false;
      if(hasNgFood(item.name)) return false;
      if(!item.cats.some(c=>cats.includes(c))) return false;
      if(item.meal!=="both" && item.meal!==mealType) return false;
      return true;
    });
    // boost items matching wanted words
    const weighted=candidates.map(item=>{
      let w=getWeight(item.name);
      if(wantedWords.length>0 && wantedWords.some(word=>{
        const {ingredients}=getEffectiveIngredients(item.name,dishes);
        return item.name.includes(word)||ingredients.some(i=>i.name.includes(word));
      })) w*=3;
      return {item,weight:w};
    });
    if(!weighted.length) return null;
    return weightedRandom(weighted);
  }

  // Main dinner categories (excluding soup/sides)
  const DINNER_CATS=["鶏肉料理","豚肉料理","牛肉料理","魚料理","卵・豆腐料理","その他"];
  const LUNCH_CATS=["麺料理","ご飯物","丼もの"];
  const SIDE_CATS=["おかず"];
  const SOUP_CATS=["スープ・汁物"];

  const usedDinnerNames=[];
  const usedLunchNames=[];
  const usedSideNames=[];
  const usedSoupNames=[];

  const groupResults=groups.map((g,gi)=>{
    const isFrozenDinner=frozen.some(k=>{ const[d,m]=k.split("_"); return g.days.includes(d)&&m==="dinner"; });
    const isFrozenLunch=frozen.some(k=>{ const[d,m]=k.split("_"); return g.days.includes(d)&&m==="lunch"; });

    // Lunch
    let lunch;
    if(isFrozenLunch){
      lunch={name:"冷凍食品", cat:"その他", diff:1};
    } else {
      const lunchItem=pickFromCats(LUNCH_CATS,"lunch",[...usedLunchNames]);
      if(lunchItem){
        usedLunchNames.push(lunchItem.name);
        lunch={name:lunchItem.name, cat:lunchItem.cats[0], diff:lunchItem.diff};
      } else {
        lunch={name:"お好みで", cat:"その他", diff:1};
      }
    }

    // Dinner main
    let dinnerMain;
    if(isFrozenDinner){
      dinnerMain={name:"冷凍食品", cat:"その他", diff:1, sides:[], soup:null};
    } else {
      const dinnerItem=pickFromCats(DINNER_CATS,"dinner",[...usedDinnerNames]);
      if(dinnerItem){
        usedDinnerNames.push(dinnerItem.name);
        // Sides
        const sidesCount=mealCfg.dinner?.sides||2;
        const sides=[];
        for(let i=0;i<sidesCount;i++){
          const sideItem=pickFromCats(SIDE_CATS,"both",[...usedSideNames,...sides]);
          if(sideItem){
            usedSideNames.push(sideItem.name);
            sides.push(sideItem.name);
          }
        }
        // Soup
        let soup=null;
        if(mealCfg.dinner?.soup){
          const soupItem=pickFromCats(SOUP_CATS,"both",[...usedSoupNames]);
          if(soupItem){ usedSoupNames.push(soupItem.name); soup=soupItem.name; }
        }
        dinnerMain={name:dinnerItem.name, cat:dinnerItem.cats[0], diff:dinnerItem.diff, sides, soup};
      } else {
        dinnerMain={name:"お好みで", cat:"その他", diff:1, sides:[], soup:null};
      }
    }

    return { days:g.days, lunch, dinner:dinnerMain };
  });

  return { weekStart:weekStartStr(), groups:groupResults };
}

function buildShoppingItems(plan, sortMem, settings, dishes, ingredientMem){
  const servings=settings?.servings||2;
  const items=[];
  let idx=0;

  plan.groups.forEach((g,gi)=>{
    const dayCount=g.days.length;
    const total=servings*dayCount;

    // Helper to add items for a dish
    const addDish=(dishName, dishType)=>{
      if(!dishName||dishName==="冷凍食品"||dishName==="お好みで") return;
      const {ingredients,seasonings}=getEffectiveIngredients(dishName,dishes);
      [...ingredients.map(i=>({...i,type:"ingredient"})),
       ...seasonings.map(i=>({...i,type:"seasoning"}))
      ].forEach(item=>{
        // Check ingredientMem for qty override
        const perServing=ingredientMem?.[item.name];
        const unit=ingredientMem?.[item.name+"_unit"]||item.unit;
        let qty;
        if(perServing){
          const calc=Math.round(perServing*total*10)/10;
          qty=`${calc}${unit}`;
        } else {
          qty=item.qty===0?"":item.qty?(item.type==="ingredient"?`${item.qty*total}${item.unit}`:item.unit==="適量"||item.unit==="少々"?item.unit:`${item.qty}${item.unit}`):"";
        }
        items.push({
          id:`item_${Date.now()}_${idx++}`,
          groupIdx:gi, dishType, dishName,
          name:item.name, qty, type:item.type,
          floor:(sortMem||{})[item.name]||null,
          excluded:item.type==="seasoning"
        });
      });
    };

    addDish(g.lunch?.name, "lunch_main");
    addDish(g.dinner?.name, "dinner_main");
    (g.dinner?.sides||[]).forEach((side,si)=>addDish(side,`dinner_side${si+1}`));
    if(g.dinner?.soup) addDish(g.dinner.soup, "dinner_soup");
  });

  // Merge same ingredient names
  const merged={};
  items.forEach(item=>{
    const key=item.name;
    if(!merged[key]){
      merged[key]={...item};
    } else {
      if(item.qty && merged[key].qty && item.qty!==merged[key].qty)
        merged[key].qty=merged[key].qty;
      if(!merged[key].floor && item.floor) merged[key].floor=item.floor;
    }
  });

  return Object.values(merged);
}

function buildLINEMessage(plan, session, sortCats, dishes){
  let msg=`🍱 ${APP_NAME}\n`;
  if(plan?.groups){
    msg+="\n📅 今週の献立\n";
    plan.groups.forEach((g,gi)=>{
      const label=g.days.map(d=>DAY_JP[d]).join("・");
      msg+=`\n【${label}】\n`;
      if(g.lunch?.name){
        msg+=`☀️ 昼: ${g.lunch.name}\n`;
        const url=dishes?.[g.lunch.name]?.recipeUrl;
        if(url) msg+=`  🔗 ${url}\n`;
      }
      if(g.dinner?.name){
        msg+=`🌙 夜: ${g.dinner.name}\n`;
        const url=dishes?.[g.dinner.name]?.recipeUrl;
        if(url) msg+=`  🔗 ${url}\n`;
        if(session?.items){
          const mainIng=session.items.filter(i=>i.groupIdx===gi&&i.dishType==="dinner_main"&&!i.excluded&&i.type==="ingredient");
          if(mainIng.length) msg+=`  食材: ${mainIng.map(i=>`${i.name}${i.qty?` ${i.qty}`:""}`).join("、")}\n`;
        }
        (g.dinner?.sides||[]).forEach((side,si)=>{
          msg+=`🥗 ${side}\n`;
          const sideUrl=dishes?.[side]?.recipeUrl;
          if(sideUrl) msg+=`  🔗 ${sideUrl}\n`;
        });
        if(g.dinner?.soup) msg+=`🍲 ${g.dinner.soup}\n`;
      }
    });
  }
  if(session){
    msg+="\n🛒 買い物リスト\n";
    const included=[...(session.items||[]),...(session.dailyGoods||[])].filter(i=>!i.excluded&&i.selected!==false);
    (sortCats||[]).forEach(cat=>{
      const catItems=included.filter(i=>i.floor===cat.id);
      if(catItems.length){ msg+=`\n【${cat.name}】\n`; catItems.forEach(i=>{msg+=`・${i.name}${i.qty?` ${i.qty}`:""}\n`;}); }
    });
    const unassigned=included.filter(i=>!i.floor);
    if(unassigned.length){ msg+="\n【未仕分け】\n"; unassigned.forEach(i=>{msg+=`・${i.name}${i.qty?` ${i.qty}`:""}\n`;}); }
  }
  return msg;
}

/* ══════════════════════════════════════════
   CSS
══════════════════════════════════════════ */
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
body{margin:0;padding:0;background:#F7F8FA;}
button{cursor:pointer;-webkit-appearance:none;font-family:inherit;}
input,textarea,select{-webkit-appearance:none;outline:none;font-family:inherit;}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes bounce{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
@keyframes zoomIn{from{transform:scale(1);opacity:0.5}to{transform:scale(1.2);opacity:0.85}}
@keyframes fadeup{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
.fade-in{animation:fadeIn .25s ease}
`;

/* ══════════════════════════════════════════
   ERROR BOUNDARY
══════════════════════════════════════════ */
class ErrorBoundary extends Component {
  constructor(props){ super(props); this.state={error:null}; }
  static getDerivedStateFromError(e){ return {error:e}; }
  render(){
    if(this.state.error){
      return(<div style={{padding:24,textAlign:"center"}}>
        <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
        <div style={{fontWeight:700,fontSize:15,marginBottom:8}}>表示エラー</div>
        <div style={{fontSize:12,color:"#C62828",background:"#FFEBEE",borderRadius:8,padding:"10px 12px",textAlign:"left",wordBreak:"break-all"}}>{this.state.error.message}</div>
        <button onClick={()=>this.setState({error:null})} style={{marginTop:14,padding:"10px 20px",background:"#2E7D32",color:"white",border:"none",borderRadius:8,fontSize:14,fontWeight:700}}>再試行</button>
      </div>);
    }
    return this.props.children;
  }
}

/* ══════════════════════════════════════════
   SMALL COMPONENTS
══════════════════════════════════════════ */
function Hdr({bg,title,sub}){
  return(<div style={{background:bg||"#1B5E20",color:"white",padding:"14px 16px 12px"}}>
    <div style={{fontWeight:700,fontSize:16}}>{title}</div>
    {sub&&<div style={{fontSize:12,opacity:0.8,marginTop:2}}>{sub}</div>}
  </div>);
}
function BtnFull({label,color="#2E7D32",onClick,disabled,small}){
  return(<button onClick={onClick} disabled={disabled} style={{display:"block",width:"100%",padding:small?"10px 16px":"14px 16px",background:disabled?"#E0E0E0":color,color:"white",border:"none",borderRadius:10,fontSize:small?14:15,fontWeight:700,cursor:disabled?"not-allowed":"pointer"}}>{label}</button>);
}
function Lbl({children,color}){
  return(<div style={{fontSize:11,fontWeight:700,color:color||"#9E9E9E",letterSpacing:"0.06em",marginBottom:5}}>{children}</div>);
}
function Empty({icon,msg}){
  return(<div style={{padding:40,textAlign:"center"}}>
    <div style={{fontSize:48,marginBottom:12}}>{icon}</div>
    <div style={{color:"#9E9E9E",fontSize:14,lineHeight:1.8,whiteSpace:"pre-line"}}>{msg}</div>
  </div>);
}
function Overlay({msg}){
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,flexDirection:"column",gap:14,overflow:"hidden"}}>
    <img src="/icon-512.png" alt="" style={{position:"absolute",width:"85%",maxWidth:360,opacity:0,animation:"zoomIn 3s ease-in-out infinite alternate",pointerEvents:"none",borderRadius:"22%"}}/>
    <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:14}}>
      <div style={{width:36,height:36,border:"3px solid rgba(255,255,255,.3)",borderTop:"3px solid white",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <div style={{color:"white",fontSize:14,fontWeight:500,textShadow:"0 1px 4px rgba(0,0,0,.8)"}}>{msg}</div>
    </div>
  </div>);
}
function Toast({msg}){
  return(<div style={{position:"fixed",bottom:82,left:"50%",transform:"translateX(-50%)",background:"rgba(33,33,33,.92)",color:"white",padding:"11px 22px",borderRadius:25,zIndex:2000,fontSize:14,fontWeight:500,whiteSpace:"nowrap",animation:"fadeup .25s ease"}}>{msg}</div>);
}
function SyncBadge({status}){
  const map={pending:{icon:"⏳",text:"保存待ち",bg:"#FFF9C4",c:"#F57F17"},syncing:{icon:"🔄",text:"同期中",bg:"#E3F2FD",c:"#1565C0"},err:{icon:"⚠️",text:"同期失敗",bg:"#FFEBEE",c:"#C62828"}};
  const info=map[status]; if(!info) return null;
  return(<div style={{position:"fixed",top:8,right:8,zIndex:200,background:info.bg,borderRadius:12,padding:"4px 10px",fontSize:11,display:"flex",alignItems:"center",gap:4,boxShadow:"0 2px 8px rgba(0,0,0,.14)",color:info.c,fontWeight:600}}><span>{info.icon}</span><span>{info.text}</span></div>);
}
function BottomNav({tab,setTab}){
  const tabs=[{icon:"📅",label:"献立"},{icon:"⭐",label:"評価"},{icon:"🛒",label:"買い物"},{icon:"⚙️",label:"設定"}];
  return(<div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"white",borderTop:"1px solid #E0E0E0",display:"flex",boxShadow:"0 -2px 8px rgba(0,0,0,.06)",zIndex:100}}>
    {tabs.map((t,i)=>(<button key={i} onClick={()=>setTab(i)} style={{flex:1,padding:"10px 0 8px",border:"none",background:"none",fontSize:10,color:tab===i?"#2E7D32":"#9E9E9E",fontWeight:tab===i?700:400,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
      <span style={{fontSize:22}}>{t.icon}</span>{t.label}
    </button>))}
  </div>);
}
function Card({title,children}){
  return(<div style={{background:"white",borderRadius:12,padding:14,marginBottom:12,boxShadow:"0 1px 4px rgba(0,0,0,.07)"}}>
    <div style={{fontWeight:700,fontSize:14,marginBottom:10}}>{title}</div>
    {children}
  </div>);
}
function SettingsField({label,value,onChange,placeholder}){
  return(<div style={{marginBottom:12}}>
    <Lbl>{label}</Lbl>
    <input value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",padding:"11px 12px",borderRadius:8,border:"2px solid #E0E0E0",fontSize:14}}/>
  </div>);
}
function BottomSheet({title,onClose,children}){
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:500}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:"18px 18px 0 0",width:"100%",maxWidth:480,padding:"20px 16px 32px",maxHeight:"80vh",overflowY:"auto"}}>
      <div style={{width:36,height:4,background:"#E0E0E0",borderRadius:2,margin:"0 auto 14px"}}/>
      {title&&<div style={{fontWeight:700,fontSize:15,marginBottom:12}}>{title}</div>}
      {children}
    </div>
  </div>);
}
function Btn({label,color,onClick,disabled}){
  return(<button onClick={onClick} disabled={disabled} style={{flex:1,padding:"10px 8px",background:disabled?"#E0E0E0":color,color:"white",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:disabled?"not-allowed":"pointer"}}>{label}</button>);
}

/* ══════════════════════════════════════════
   RECIPE PICKER
══════════════════════════════════════════ */
function RecipePicker({dishName,sites,onClose}){
  const open=site=>{ window.open(site.url.replace("{dish}",encodeURIComponent(dishName)),"_blank","noopener,noreferrer"); onClose(); };
  return(<BottomSheet title={`🔍「${dishName}」のレシピを探す`} onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {(sites||[]).map(site=>(<button key={site.id} onClick={()=>open(site)} style={{padding:"13px 16px",background:"#F7F8FA",border:"1.5px solid #E0E0E0",borderRadius:10,textAlign:"left",fontSize:14,fontWeight:600,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:18}}>{site.id==="nadia"?"👩‍🍳":site.id==="cookpad"?"🍳":site.id==="youtube"?"▶️":"📸"}</span>{site.label}でレシピを探す
      </button>))}
    </div>
    <button onClick={onClose} style={{marginTop:12,width:"100%",padding:10,border:"none",background:"none",color:"#9E9E9E",fontSize:14}}>キャンセル</button>
  </BottomSheet>);
}

/* ══════════════════════════════════════════
   MENU SCREEN
══════════════════════════════════════════ */
function MenuScreen({st,save,notify,onTabChange}){
  const plan=st.plan;
  const groups=deriveGroups(st.settings.day_groups);
  const [wanted,setWanted]=useState("");
  const [swapSrc,setSwapSrc]=useState(null);
  const [busy,setBusy]=useState(false);

  const handleGenerate=()=>{
    setBusy(true);
    try{
      const newPlan=buildMenuFromDB(st,wanted);
      save({plan:newPlan,pendingUpdate:false,session:null});
      notify("✅ 献立を生成しました");
    }catch(e){ alert("エラー: "+e.message); }
    finally{ setBusy(false); }
  };

  const handleUpdateShopping=()=>{
    if(!plan) return alert("先に献立を生成してください");
    setBusy(true);
    try{
      const items=buildShoppingItems(plan,st.sortMem,st.settings,st.dishes,st.ingredientMem);
      save({session:{weekStart:plan.weekStart,items,dailyGoods:st.session?.dailyGoods||[]},pendingUpdate:false});
      notify("✅ 買い物リストを更新しました！");
    }catch(e){ alert("エラー: "+e.message); }
    finally{ setBusy(false); }
  };

  const handleChangeDish=(gi,slotKey,oldName,filterCat=null,filterWord="")=>{
    const g=plan.groups[gi];
    const isLunch=slotKey==="lunch_main";
    const isSide=slotKey.startsWith("dinner_side");
    let defaultCats=isLunch?["麺料理","ご飯物","丼もの"]:isSide?["おかず"]:["鶏肉料理","豚肉料理","牛肉料理","魚料理","卵・豆腐料理","その他"];
    const cats=filterCat?[filterCat]:defaultCats;
    const mealType=isLunch?"lunch":"dinner";
    const used=plan.groups.flatMap(g=>[g.lunch?.name,g.dinner?.name,...(g.dinner?.sides||[])].filter(Boolean));
    const words=filterWord.trim().split(/[\s,、]+/).filter(Boolean);

    const allItems=MENU_DB;
    let candidates=allItems.filter(item=>{
      if(item.name===oldName||used.includes(item.name)) return false;
      if(!item.cats.some(c=>cats.includes(c))) return false;
      if(item.meal!=="both"&&item.meal!==mealType) return false;
      return true;
    });
    // フリーワードフィルター（おかず変更時）
    if(words.length>0){
      const wordFiltered=candidates.filter(item=>{
        const ings=getEffectiveIngredients(item.name,st.dishes).ingredients;
        return words.some(w=>item.name.includes(w)||ings.some(i=>i.name.includes(w)));
      });
      if(wordFiltered.length>0) candidates=wordFiltered;
    }
    if(!candidates.length) return alert("条件に合う候補がありませんでした");
    const picked=candidates[Math.floor(Math.random()*candidates.length)];

    const newGroups=plan.groups.map((gr,i)=>{
      if(i!==gi) return gr;
      if(slotKey==="lunch_main") return {...gr,lunch:{...gr.lunch,name:picked.name,cat:picked.cats[0],diff:picked.diff}};
      if(slotKey==="dinner_main") return {...gr,dinner:{...gr.dinner,name:picked.name,cat:picked.cats[0],diff:picked.diff}};
      if(slotKey.startsWith("dinner_side")){
        const idx=Number(slotKey.replace("dinner_side",""))-1;
        const sides=[...(gr.dinner?.sides||[])];
        sides[idx]=picked.name;
        return {...gr,dinner:{...gr.dinner,sides}};
      }
      if(slotKey==="dinner_soup") return {...gr,dinner:{...gr.dinner,soup:picked.name}};
      return gr;
    });
    save({plan:{...plan,groups:newGroups},pendingUpdate:true});
  };

  const handleSwap=(srcGi,dstGi)=>{
    const newGroups=[...plan.groups];
    const tmp={lunch:newGroups[srcGi].lunch,dinner:newGroups[srcGi].dinner};
    newGroups[srcGi]={...newGroups[srcGi],lunch:newGroups[dstGi].lunch,dinner:newGroups[dstGi].dinner};
    newGroups[dstGi]={...newGroups[dstGi],lunch:tmp.lunch,dinner:tmp.dinner};
    save({plan:{...plan,groups:newGroups},pendingUpdate:true});
    setSwapSrc(null);
  };

  const handleDishSwap=(srcGi,srcSlot,dstGi,dstSlot)=>{
    if(!plan) return;
    const getVal=(gi,slot)=>{
      const g=plan.groups[gi];
      if(slot==="lunch_main") return g.lunch?.name||"";
      if(slot==="dinner_main") return g.dinner?.name||"";
      if(slot.startsWith("dinner_side")){ const idx=Number(slot.replace("dinner_side",""))-1; return (g.dinner?.sides||[])[idx]||""; }
      if(slot==="dinner_soup") return g.dinner?.soup||"";
      return "";
    };
    const setVal=(groups,gi,slot,val)=>{
      const g={...groups[gi]};
      if(slot==="lunch_main") g.lunch={...g.lunch,name:val};
      else if(slot==="dinner_main") g.dinner={...g.dinner,name:val};
      else if(slot.startsWith("dinner_side")){
        const idx=Number(slot.replace("dinner_side",""))-1;
        const sides=[...(g.dinner?.sides||[])]; sides[idx]=val; g.dinner={...g.dinner,sides};
      }
      else if(slot==="dinner_soup") g.dinner={...g.dinner,soup:val};
      return groups.map((gr,i)=>i===gi?g:gr);
    };
    const srcVal=getVal(srcGi,srcSlot); const dstVal=getVal(dstGi,dstSlot);
    let newGroups=[...plan.groups];
    newGroups=setVal(newGroups,srcGi,srcSlot,dstVal);
    newGroups=setVal(newGroups,dstGi,dstSlot,srcVal);
    save({plan:{...plan,groups:newGroups},pendingUpdate:true});
  };

  const handleTabChange=(tabIdx)=>{
    if(st.pendingUpdate){
      if(window.confirm("買い物リストを更新しますか？")){
        const items=buildShoppingItems(plan,st.sortMem,st.settings,st.dishes,st.ingredientMem);
        save({session:{weekStart:plan.weekStart,items,dailyGoods:st.session?.dailyGoods||[]},pendingUpdate:false});
      } else {
        save({pendingUpdate:false});
      }
    }
    onTabChange(tabIdx);
  };

  const recipeSites=st.settings.recipe_sites||INIT_SETTINGS.recipe_sites;

  return(<div>
    {busy&&<Overlay msg="献立を生成中..."/>}
    {swapSrc!==null&&<BottomSheet title="どのグループと入れ替えますか？" onClose={()=>setSwapSrc(null)}>
      {plan?.groups.map((g,gi)=>gi===swapSrc?null:(
        <button key={gi} onClick={()=>handleSwap(swapSrc,gi)} style={{display:"block",width:"100%",padding:"14px 16px",marginBottom:8,background:"#F7F8FA",border:"1.5px solid #E0E0E0",borderRadius:10,fontSize:15,fontWeight:600,textAlign:"left"}}>
          【{groups[gi]?.label}】{g.dinner?.name||"（空）"}
        </button>
      ))}
      <button onClick={()=>setSwapSrc(null)} style={{width:"100%",padding:10,border:"none",background:"none",color:"#9E9E9E",fontSize:14}}>キャンセル</button>
    </BottomSheet>}

    <Hdr bg="#1B5E20" title={APP_NAME} sub={plan?`${plan.weekStart} 週`:null}/>
    <div style={{padding:"12px 13px 8px"}}>
      <input value={wanted} onChange={e=>setWanted(e.target.value)}
        placeholder="使いたい食材（例：豚バラ、きのこ）"
        style={{width:"100%",padding:"10px 12px",marginBottom:8,border:"2px solid #E0E0E0",borderRadius:8,fontSize:14,background:wanted?"#F1F8E9":"white"}}/>
      <BtnFull label="これでも食らえ" color="#2E7D32" onClick={handleGenerate}/>
      {plan&&<div style={{marginTop:8}}>
        <BtnFull label={`🛒 買い物リストを更新${st.pendingUpdate?" ●":""}`} color="#0D47A1" onClick={handleUpdateShopping} small/>
      </div>}
    </div>

    {!plan?<Empty icon="🍱" msg={"上のボタンを押すと\nDBから献立を提案します！"}/>:(
      <div style={{padding:"4px 13px 12px"}}>
        {plan.groups?.map((group,gi)=>{
          const gInfo=groups[gi]||groups[0];
          return(<GroupCard key={gi} group={group} gi={gi} gInfo={gInfo}
            dishes={st.dishes} recipeSites={recipeSites}
            onChangeDish={handleChangeDish}
            onSwap={()=>setSwapSrc(gi)}
            onDishSwap={handleDishSwap}
            onSaveDish={(name,info)=>save({dishes:{...st.dishes,[name]:info},pendingUpdate:!!plan})}
            onSaveDishes={(updated)=>save({dishes:updated})}
          />);
        })}
      </div>
    )}
  </div>);
}

/* ── GroupCard ── */
function GroupCard({group,gi,gInfo,dishes,recipeSites,onChangeDish,onSwap,onDishSwap,onSaveDish,onSaveDishes}){
  const [dragOver,setDragOver]=useState(null);
  const [dishAction,setDishAction]=useState(null);
  const [urlInput,setUrlInput]=useState("");
  const [variantSheet,setVariantSheet]=useState(null);
  const [changeFilter,setChangeFilter]=useState({cat:null,word:""});
  const [showChangeFilter,setShowChangeFilter]=useState(false);
  const [dbEditTarget,setDbEditTarget]=useState(null); // {name, slotKey} DBEdit用独立state

  const getSlotName=key=>{
    if(key==="lunch_main") return group.lunch?.name||"";
    if(key==="dinner_main") return group.dinner?.name||"";
    if(key.startsWith("dinner_side")){ const idx=Number(key.replace("dinner_side",""))-1; return (group.dinner?.sides||[])[idx]||""; }
    if(key==="dinner_soup") return group.dinner?.soup||"";
    return "";
  };

  const handleDragStart=(e,slotKey)=>{ e.dataTransfer.setData("text/plain",JSON.stringify({gi,slotKey})); e.dataTransfer.effectAllowed="move"; };
  const handleDragOver=(e,slotKey)=>{ e.preventDefault(); setDragOver(slotKey); };
  const handleDrop=(e,slotKey)=>{
    e.preventDefault(); setDragOver(null);
    try{ const src=JSON.parse(e.dataTransfer.getData("text/plain")); if(src.gi===gi&&src.slotKey===slotKey) return; onDishSwap(src.gi,src.slotKey,gi,slotKey); }catch(err){}
  };

  const SlotRow=({slotKey,label,isBold})=>{
    const name=getSlotName(slotKey);
    const isOver=dragOver===slotKey;
    const dishInfo=name?dishes?.[name]:null;
    const avgScore=dishInfo?.scores?.length?avg(dishInfo.scores).toFixed(1):null;
    const diff=dishInfo?.difficulty||0;
    const activeVariant=dishInfo?.activeVariant||"default";
    const dbItem=name?MENU_DB.find(i=>i.name===name):null;
    const variantLabel=dbItem?.variants?.find(v=>v.variantId===activeVariant)?.label||"デフォルト";
    const hasMultiVariants=dbItem?.variants?.length>1;

    return(<div draggable onDragStart={e=>handleDragStart(e,slotKey)} onDragOver={e=>handleDragOver(e,slotKey)} onDrop={e=>handleDrop(e,slotKey)} onDragLeave={()=>setDragOver(null)}
      style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,padding:"5px 8px",borderRadius:8,cursor:"grab",background:isOver?"#E3F2FD":"transparent",border:isOver?"1.5px dashed #1565C0":"1.5px solid transparent"}}>
      <span style={{fontSize:11,color:"#BDBDBD",userSelect:"none"}}>⠿</span>
      <div style={{flex:1}}>
        <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
          <span style={{fontWeight:isBold?700:400,fontSize:isBold?16:13,color:isBold?"#212121":"#616161"}}>{name||"（空）"}</span>
          {avgScore&&<span style={{fontSize:10,color:"#FB8C00"}}>⭐{avgScore}</span>}
          {diff>0&&<span style={{fontSize:10,color:DIFF_COLORS[diff],background:DIFF_COLORS[diff]+"22",padding:"1px 5px",borderRadius:6}}>{DIFF_LABELS[diff]}</span>}
          {hasMultiVariants&&<span style={{fontSize:10,color:"#9E9E9E",background:"#F5F5F5",padding:"1px 5px",borderRadius:6}}>{variantLabel}</span>}
        </div>
        {label&&<div style={{fontSize:10,color:"#BDBDBD"}}>{label}</div>}
      </div>
      {name&&<button onClick={()=>{ setUrlInput(dishes?.[name]?.recipeUrl||""); setDishAction({slotKey,name}); }} style={{padding:"3px 9px",background:"#E8F5E9",color:"#2E7D32",border:"1px solid #A5D6A7",borderRadius:6,fontSize:12,flexShrink:0}}>🔍</button>}
    </div>);
  };

  return(<>
    {dishAction&&<BottomSheet title={`「${dishAction.name}」`} onClose={()=>setDishAction(null)}>
      {dishes?.[dishAction.name]?.recipeUrl&&(
        <div style={{background:"#E8F5E9",borderRadius:8,padding:"8px 12px",marginBottom:8,fontSize:12,color:"#2E7D32",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>🔗 レシピURL登録済み</span>
          <a href={dishes[dishAction.name].recipeUrl} target="_blank" rel="noopener noreferrer" style={{color:"#1565C0",fontSize:11}}>開く</a>
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:8}}>
        {(recipeSites||[]).map(site=>(<button key={site.id} onClick={()=>{ window.open(site.url.replace("{dish}",encodeURIComponent(dishAction.name)),"_blank","noopener,noreferrer"); setDishAction(null); }} style={{padding:"13px 16px",background:"#F7F8FA",border:"1.5px solid #E0E0E0",borderRadius:10,textAlign:"left",fontSize:14,fontWeight:600,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:18}}>{site.id==="nadia"?"👩‍🍳":site.id==="cookpad"?"🍳":site.id==="youtube"?"▶️":"📸"}</span>{site.label}でレシピを探す
        </button>))}
        <div style={{background:"#F7F8FA",border:"1.5px solid #E0E0E0",borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>🔗 レシピURLを登録</div>
          <div style={{display:"flex",gap:6}}>
            <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} placeholder="https://..." style={{flex:1,padding:"8px 10px",border:"1.5px solid #E0E0E0",borderRadius:7,fontSize:13}}/>
            <button onClick={()=>{ if(!urlInput.trim()) return; const prev=dishes?.[dishAction.name]||{scores:[],difficulty:0,lastServed:null}; onSaveDish(dishAction.name,{...prev,recipeUrl:urlInput.trim()}); setDishAction(null); }} style={{padding:"8px 12px",background:"#1565C0",color:"white",border:"none",borderRadius:7,fontSize:13,fontWeight:700}}>保存</button>
          </div>
        </div>
        {(() => { const dbItem=MENU_DB.find(i=>i.name===dishAction.name); return dbItem?.variants?.length>1?(
          <button onClick={()=>{ setVariantSheet({name:dishAction.name,dbItem}); setDishAction(null); }} style={{padding:"13px 16px",background:"#F3E5F5",border:"1.5px solid #CE93D8",borderRadius:10,textAlign:"left",fontSize:14,fontWeight:600,display:"flex",alignItems:"center",gap:10}}>
            🔀 バリエーションを切り替える
          </button>
        ):null; })()}
        {/* カテゴリ絞り込みで変更 */}
        {!showChangeFilter?(
          <button onClick={()=>setShowChangeFilter(true)} style={{padding:"13px 16px",background:"#E8F5E9",border:"1.5px solid #A5D6A7",borderRadius:10,textAlign:"left",fontSize:14,fontWeight:600,display:"flex",alignItems:"center",gap:10}}>
            🔄 この料理を変更（DBからランダム）
          </button>
        ):(
          <div style={{background:"#F7F8FA",border:"1.5px solid #E0E0E0",borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>🔄 変更オプション</div>
            {/* カテゴリ選択（メイン変更時のみ） */}
            {(dishAction.slotKey==="dinner_main"||dishAction.slotKey==="lunch_main")&&<>
              <div style={{fontSize:11,color:"#9E9E9E",marginBottom:5}}>カテゴリで絞り込む（任意）</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
                <button onClick={()=>setChangeFilter(f=>({...f,cat:null}))} style={{padding:"4px 10px",borderRadius:12,border:`1.5px solid ${!changeFilter.cat?"#2E7D32":"#E0E0E0"}`,background:!changeFilter.cat?"#E8F5E9":"white",color:!changeFilter.cat?"#2E7D32":"#757575",fontSize:12}}>すべて</button>
                {(dishAction.slotKey==="dinner_main"?["鶏肉料理","豚肉料理","牛肉料理","魚料理","卵・豆腐料理","その他"]:["麺料理","ご飯物","丼もの"]).map(cat=>(
                  <button key={cat} onClick={()=>setChangeFilter(f=>({...f,cat:f.cat===cat?null:cat}))} style={{padding:"4px 10px",borderRadius:12,border:`1.5px solid ${changeFilter.cat===cat?"#1565C0":"#E0E0E0"}`,background:changeFilter.cat===cat?"#E3F2FD":"white",color:changeFilter.cat===cat?"#1565C0":"#757575",fontSize:12}}>{cat}</button>
                ))}
              </div>
            </>}
            {/* フリーワード（副菜変更時のみ） */}
            {dishAction.slotKey.startsWith("dinner_side")&&<>
              <div style={{fontSize:11,color:"#9E9E9E",marginBottom:5}}>使いたい食材（任意）</div>
              <input value={changeFilter.word} onChange={e=>setChangeFilter(f=>({...f,word:e.target.value}))} placeholder="例：ほうれん草、きのこ" style={{width:"100%",padding:"8px 10px",border:"1.5px solid #E0E0E0",borderRadius:7,fontSize:13,marginBottom:8}}/>
            </>}
            <button onClick={()=>{ onChangeDish(gi,dishAction.slotKey,dishAction.name,changeFilter.cat,changeFilter.word); setDishAction(null); setShowChangeFilter(false); setChangeFilter({cat:null,word:""}); }} style={{width:"100%",padding:"11px",background:"#2E7D32",color:"white",border:"none",borderRadius:8,fontSize:14,fontWeight:700}}>この条件で変更する</button>
            <button onClick={()=>setShowChangeFilter(false)} style={{width:"100%",padding:8,border:"none",background:"none",color:"#9E9E9E",fontSize:13,marginTop:4}}>戻る</button>
          </div>
        )}
        {/* DB編集 */}
        <button onClick={()=>{ setDbEditTarget({name:dishAction.name}); setDishAction(null); }} style={{padding:"13px 16px",background:"#FFF8E1",border:"1.5px solid #FFE082",borderRadius:10,textAlign:"left",fontSize:14,fontWeight:600,display:"flex",alignItems:"center",gap:10}}>
          📝 レシピDB編集（食材・カテゴリ・バリエーション）
        </button>
      </div>
      <button onClick={()=>{ setDishAction(null); setShowChangeFilter(false); setChangeFilter({cat:null,word:""}); }} style={{width:"100%",padding:10,border:"none",background:"none",color:"#9E9E9E",fontSize:14}}>キャンセル</button>
    </BottomSheet>}
    {/* DB編集シート（献立タブから開いたとき・初期表示は該当料理が選択済み） */}
    {dbEditTarget&&<BottomSheet title={`📝「${dbEditTarget.name}」を編集`} onClose={()=>setDbEditTarget(null)}>
      <DBMenuEditorInline dishName={dbEditTarget.name} dishes={dishes} onSave={(name,info)=>{ onSaveDish(name,info); setDbEditTarget(null); }} onSaveDishes={onSaveDishes}/>
    </BottomSheet>}

    {variantSheet&&<BottomSheet title={`「${variantSheet.name}」のバリエーション`} onClose={()=>setVariantSheet(null)}>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {variantSheet.dbItem.variants.map(v=>{
          const current=(dishes?.[variantSheet.name]?.activeVariant||"default")===v.variantId;
          return(<button key={v.variantId} onClick={()=>{ const prev=dishes?.[variantSheet.name]||{scores:[],difficulty:0,lastServed:null}; onSaveDish(variantSheet.name,{...prev,activeVariant:v.variantId}); setVariantSheet(null); }} style={{padding:"13px 16px",background:current?"#E8F5E9":"#F7F8FA",border:`1.5px solid ${current?"#2E7D32":"#E0E0E0"}`,borderRadius:10,textAlign:"left"}}>
            <div style={{fontWeight:700,fontSize:14,color:current?"#2E7D32":"#212121"}}>{current?"✓ ":""}{v.label}</div>
            <div style={{fontSize:11,color:"#9E9E9E",marginTop:3}}>{(v.ingredients||[]).map(i=>i.name).join("、").slice(0,40)}</div>
            {v.recipeUrl&&<div style={{fontSize:11,color:"#1565C0",marginTop:2}}>🔗 {v.recipeUrl.slice(0,40)}</div>}
          </button>);
        })}
      </div>
      <button onClick={()=>setVariantSheet(null)} style={{marginTop:8,width:"100%",padding:10,border:"none",background:"none",color:"#9E9E9E",fontSize:14}}>キャンセル</button>
    </BottomSheet>}

    <div className="fade-in" style={{background:"white",borderRadius:12,marginBottom:10,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.07)"}}>
      <div style={{background:gInfo.color,color:"white",padding:"8px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontWeight:700,fontSize:13}}>{gInfo.label}</span>
        <button onClick={onSwap} style={{padding:"4px 10px",background:"rgba(255,255,255,.2)",color:"white",border:"1px solid rgba(255,255,255,.4)",borderRadius:6,fontSize:12,fontWeight:600}}>↕ 入替</button>
      </div>
      <div style={{padding:"10px 14px"}}>
        {group.lunch?.name&&<>
          <div style={{fontSize:10,color:"#9E9E9E",fontWeight:600,marginBottom:2}}>☀️ 昼食</div>
          <SlotRow slotKey="lunch_main" label={null} isBold={false}/>
        </>}
        <div style={{fontSize:10,color:"#9E9E9E",fontWeight:600,marginBottom:2,marginTop:group.lunch?.name?6:0}}>🌙 夕食</div>
        <SlotRow slotKey="dinner_main" label={null} isBold={true}/>
        {(group.dinner?.sides||[]).map((_,si)=><SlotRow key={si} slotKey={`dinner_side${si+1}`} label={`副菜${si+1}`} isBold={false}/>)}
        {group.dinner?.soup&&<SlotRow slotKey="dinner_soup" label="汁物" isBold={false}/>}
        <div style={{fontSize:10,color:"#BDBDBD",marginTop:2}}>⠿ ドラッグで並び替え　🔍 タップで操作</div>
      </div>
    </div>
  </>);
}

/* ══════════════════════════════════════════
   RATING SCREEN
══════════════════════════════════════════ */
function RatingScreen({st,save,notify}){
  const plan=st.plan;
  if(!plan?.groups?.length) return(<div><Hdr bg="#F57F17" title="⭐ 評価"/><Empty icon="⭐" msg={"献立タブで献立を生成してから\n評価してください"}/></div>);

  const allDishes=plan.groups.flatMap(g=>[
    g.lunch?.name, g.dinner?.name,...(g.dinner?.sides||[]), g.dinner?.soup
  ].filter(Boolean));

  const rateDish=(name,score)=>{
    const prev=st.dishes?.[name]||{scores:[],difficulty:0,lastServed:null};
    const scores=[...prev.scores,score].slice(-10);
    save({dishes:{...st.dishes,[name]:{...prev,scores}}});
    notify(`${name}：★${score}`);
  };
  const setDifficulty=(name,diff)=>{
    const prev=st.dishes?.[name]||{scores:[],difficulty:0,lastServed:null};
    save({dishes:{...st.dishes,[name]:{...prev,difficulty:diff}}});
  };

  return(<div>
    <Hdr bg="#F57F17" title="⭐ 評価" sub={`${plan.weekStart} 週の料理`}/>
    <div style={{padding:"12px 13px"}}>
      {plan.groups.map((g,gi)=>{
        const gInfo=deriveGroups(st.settings.day_groups)[gi]||{color:"#2E7D32",label:"G"+(gi+1)};
        const dishes=[
          g.lunch?.name&&{name:g.lunch.name,label:"昼食"},
          g.dinner?.name&&{name:g.dinner.name,label:"夕食"},
          ...(g.dinner?.sides||[]).map((s,i)=>({name:s,label:`副菜${i+1}`})),
          g.dinner?.soup&&{name:g.dinner.soup,label:"汁物"}
        ].filter(Boolean);
        return(<div key={gi} style={{background:"white",borderRadius:12,marginBottom:10,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.07)"}}>
          <div style={{background:gInfo.color,color:"white",padding:"7px 14px",fontSize:13,fontWeight:700}}>{gInfo.label}</div>
          <div style={{padding:"10px 14px"}}>
            {dishes.map(({name,label})=>{
              const info=st.dishes?.[name]||{};
              const avgS=info.scores?.length?avg(info.scores).toFixed(1):null;
              const diff=info.difficulty||0;
              return(<div key={name} style={{marginBottom:12,paddingBottom:12,borderBottom:"1px solid #F5F5F5"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div>
                    <span style={{fontSize:11,color:"#9E9E9E"}}>{label}　</span>
                    <span style={{fontSize:14,fontWeight:600}}>{name}</span>
                    {avgS&&<span style={{fontSize:12,color:"#FB8C00",marginLeft:6}}>⭐平均{avgS}</span>}
                  </div>
                </div>
                <div style={{display:"flex",gap:6,marginBottom:8}}>
                  {[1,2,3,4,5].map(s=>(<button key={s} onClick={()=>rateDish(name,s)} style={{flex:1,padding:"8px 4px",border:`2px solid ${(info.scores?.slice(-1)[0]||0)>=s?"#FB8C00":"#E0E0E0"}`,borderRadius:8,background:(info.scores?.slice(-1)[0]||0)>=s?"#FFF8E1":"white",fontSize:18,color:(info.scores?.slice(-1)[0]||0)>=s?"#FB8C00":"#BDBDBD"}}>★</button>))}
                </div>
                <div style={{display:"flex",gap:6}}>
                  {[1,2,3].map(d=>(<button key={d} onClick={()=>setDifficulty(name,d)} style={{flex:1,padding:"6px 4px",border:`1.5px solid ${diff===d?DIFF_COLORS[d]:"#E0E0E0"}`,borderRadius:7,background:diff===d?DIFF_COLORS[d]+"22":"white",color:diff===d?DIFF_COLORS[d]:"#9E9E9E",fontSize:12,fontWeight:600}}>{DIFF_LABELS[d]}</button>))}
                </div>
              </div>);
            })}
          </div>
        </div>);
      })}
    </div>
  </div>);
}

/* ══════════════════════════════════════════
   SHOP SCREEN
══════════════════════════════════════════ */
function ShopScreen({st,save,notify,setFloor,onConfirm}){
  const [step,setStep]=useState(1);
  const sess=st.session;
  if(!sess) return(<div><Hdr bg="#0D47A1" title="🛒 買い物リスト" sub="まず献立を生成してください"/><Empty icon="🛒" msg={"献立タブで献立を生成したあと\n「買い物リストを更新」を押してください"}/></div>);
  const uncatCount=[...(sess.items||[]).filter(i=>!i.floor&&!i.excluded),...(sess.dailyGoods||[]).filter(i=>!i.floor&&i.selected!==false)].length;

  return(<div>
    <Hdr bg="#0D47A1" title="🛒 買い物リスト" sub={`${sess.weekStart||""}の週`}/>
    <div style={{display:"flex",background:"white",borderBottom:"2px solid #E3F2FD"}}>
      {["①食材確認","②日用品","③仕分け","④確認送信"].map((s,i)=>(<button key={i} onClick={()=>setStep(i+1)} style={{flex:1,padding:"11px 2px",border:"none",background:"none",fontSize:10,fontWeight:step===i+1?700:400,color:step===i+1?"#1565C0":"#9E9E9E",borderBottom:`2px solid ${step===i+1?"#1565C0":"transparent"}`,marginBottom:-2}}>{s}</button>))}
    </div>
    {step===1&&<Step1 sess={sess} save={save} ingredientMem={st.ingredientMem} servings={st.settings.servings||2} plan={st.plan}/>}
    {step===2&&<Step2 sess={sess} dailyGoods={st.dailyGoods} sortMem={st.sortMem} save={save}/>}
    {step===3&&(uncatCount>0
      ?<Step3Swipe sess={sess} sortCats={st.settings.sort_cats} setFloor={setFloor} onDone={()=>setStep(4)}/>
      :<div style={{padding:28,textAlign:"center"}}>
        <div style={{fontSize:52,animation:"bounce .4s ease",marginBottom:12}}>✅</div>
        <div style={{color:"#9E9E9E",fontSize:14,marginBottom:16}}>すべて仕分け済みです</div>
        <div style={{padding:"0 16px"}}><BtnFull label="④ 確認・送信へ →" color="#0D47A1" onClick={()=>setStep(4)}/></div>
      </div>
    )}
    {step===4&&<Step4 sess={sess} plan={st.plan} sortCats={st.settings.sort_cats} save={save} notify={notify} groups={deriveGroups(st.settings.day_groups)} dishes={st.dishes} onConfirm={onConfirm}/>}
  </div>);
}

/* Step1 */
function Step1({sess,save,ingredientMem,servings,plan}){
  const [newItem,setNewItem]=useState("");
  const [editItem,setEditItem]=useState(null);
  const [editQty,setEditQty]=useState("");
  const toggle=id=>save({session:{...sess,items:(sess.items||[]).map(i=>i.id===id?{...i,excluded:!i.excluded}:i)}});
  const addItem=()=>{
    const name=newItem.trim(); if(!name) return;
    save({session:{...sess,items:[...(sess.items||[]),{id:`custom_${Date.now()}`,name,qty:"",type:"ingredient",groupIdx:0,dishType:"dinner_main",dishName:"",floor:null,excluded:false}]}});
    setNewItem("");
  };
  const openEdit=it=>{ setEditItem(it); setEditQty(it.qty||""); };
  const saveEdit=(savePerServing)=>{
    if(!editItem) return;
    const newItems=(sess.items||[]).map(i=>i.id===editItem.id?{...i,qty:editQty}:i);
    if(savePerServing){
      const group=plan?.groups?.[editItem.groupIdx];
      const dayCount=group?.days?.length||1;
      const total=(servings||2)*dayCount;
      const numMatch=editQty.match(/[\d.]+/);
      const unitMatch=editQty.match(/[^\d.\s]+/);
      if(numMatch&&total>0){
        const perServing=parseFloat(numMatch[0])/total;
        const unit=unitMatch?unitMatch[0]:"g";
        const newMem={...(ingredientMem||{}),[editItem.name]:perServing,[editItem.name+"_unit"]:unit};
        save({session:{...sess,items:newItems},ingredientMem:newMem});
      } else save({session:{...sess,items:newItems}});
    } else save({session:{...sess,items:newItems}});
    setEditItem(null);
  };

  return(<div style={{padding:"12px 13px"}}>
    {editItem&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:500}} onClick={()=>setEditItem(null)}>
      <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:"18px 18px 0 0",width:"100%",maxWidth:480,padding:"20px 16px 32px"}}>
        <div style={{width:36,height:4,background:"#E0E0E0",borderRadius:2,margin:"0 auto 14px"}}/>
        <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>「{editItem.name}」の量を編集</div>
        <input value={editQty} onChange={e=>setEditQty(e.target.value)} autoFocus style={{width:"100%",padding:"11px 12px",border:"2px solid #E0E0E0",borderRadius:8,fontSize:16,marginBottom:12}}/>
        <button onClick={()=>saveEdit(true)} style={{display:"block",width:"100%",padding:"13px",background:"#2E7D32",color:"white",border:"none",borderRadius:10,fontSize:14,fontWeight:700,marginBottom:8}}>保存して次回以降も自動計算（推奨）</button>
        <button onClick={()=>saveEdit(false)} style={{display:"block",width:"100%",padding:"13px",background:"#F5F5F5",color:"#616161",border:"1px solid #E0E0E0",borderRadius:10,fontSize:14,fontWeight:600,marginBottom:8}}>今回だけ変更</button>
        <button onClick={()=>setEditItem(null)} style={{width:"100%",padding:10,border:"none",background:"none",color:"#9E9E9E",fontSize:14}}>キャンセル</button>
      </div>
    </div>}
    <p style={{fontSize:13,color:"#9E9E9E",marginBottom:12,lineHeight:1.7}}>食材はON・調味料はOFF（家にあるため）がデフォルトです。タップで切替、長押しで量を編集できます。</p>
    {[["ingredient","🥩 食材"],["seasoning","🫙 調味料"]].map(([type,label])=>{
      const items=(sess.items||[]).filter(i=>i.type===type); if(!items.length) return null;
      return(<div key={type} style={{marginBottom:14}}>
        <Lbl>{label}</Lbl>
        <div style={{display:"flex",flexWrap:"wrap",gap:7,marginTop:6}}>
          {items.map(it=>(<button key={it.id} onClick={()=>toggle(it.id)}
            onPointerDown={e=>{ const t=setTimeout(()=>openEdit(it),600); e.currentTarget._lpt=t; }}
            onPointerUp={e=>clearTimeout(e.currentTarget._lpt)}
            onPointerLeave={e=>clearTimeout(e.currentTarget._lpt)}
            style={{padding:"7px 13px",borderRadius:20,border:`2px solid ${it.excluded?"#E0E0E0":"#1565C0"}`,background:it.excluded?"#F5F5F5":"#E3F2FD",color:it.excluded?"#BDBDBD":"#1565C0",fontSize:13,fontWeight:500,textDecoration:it.excluded?"line-through":"none"}}>
            {it.name}{it.qty?` (${it.qty})`:""}</button>))}
        </div>
      </div>);
    })}
    <div style={{marginTop:16}}>
      <Lbl>＋ 食材を追加</Lbl>
      <div style={{display:"flex",gap:8,marginTop:6}}>
        <input value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addItem()} placeholder="食材名を入力..." style={{flex:1,padding:"10px 12px",borderRadius:8,border:"2px solid #E0E0E0",fontSize:14}}/>
        <button onClick={addItem} style={{padding:"10px 16px",background:"#1565C0",color:"white",border:"none",borderRadius:8,fontSize:14,fontWeight:700}}>追加</button>
      </div>
    </div>
  </div>);
}

/* Step2 */
function Step2({sess,dailyGoods,sortMem,save}){
  const toggle=name=>{
    const existing=sess.dailyGoods||[];
    const found=existing.find(i=>i.name===name);
    if(found){ save({session:{...sess,dailyGoods:existing.map(i=>i.name===name?{...i,selected:!i.selected}:i)}}); }
    else{ save({session:{...sess,dailyGoods:[...existing,{id:`dg_${Date.now()}`,name,selected:true,floor:(sortMem||{})[name]||null}]}}); }
  };
  const isSelected=name=>(sess.dailyGoods||[]).find(i=>i.name===name)?.selected??false;
  if(!dailyGoods.length) return(<div style={{padding:24}}><Empty icon="🧴" msg={"設定タブで日用品を\n登録してください"}/></div>);
  return(<div style={{padding:"12px 13px"}}>
    <p style={{fontSize:13,color:"#9E9E9E",marginBottom:12,lineHeight:1.7}}>今週買うものをタップして選択してください。</p>
    <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
      {dailyGoods.map((name,i)=>{ const sel=isSelected(name); return(
        <button key={i} onClick={()=>toggle(name)} style={{padding:"7px 13px",borderRadius:20,border:`2px solid ${sel?"#E65100":"#E0E0E0"}`,background:sel?"#FBE9E7":"#F5F5F5",color:sel?"#E65100":"#757575",fontSize:13,fontWeight:500}}>{sel?"✓ ":""}{name}</button>
      );})}
    </div>
  </div>);
}

/* Step3 */
function Step3Swipe({sess,sortCats,setFloor,onDone}){
  const [initList]=useState(()=>[
    ...(sess.items||[]).filter(i=>!i.floor&&!i.excluded),
    ...(sess.dailyGoods||[]).filter(i=>!i.floor&&i.selected!==false)
  ]);
  const [idx,setIdx]=useState(0);
  const [history,setHistory]=useState([]);
  const [animDir,setAnimDir]=useState(null);
  const touchStartRef=useRef(null);
  const current=initList[idx];
  const isDaily=current&&(sess.dailyGoods||[]).some(i=>i.id===current.id);

  const handleSelect=cat=>{
    setAnimDir(cat.dir||"right");
    setTimeout(()=>{ setFloor(current.id,cat.id,isDaily); setHistory(h=>[...h,{itemId:current.id,isDaily}]); setIdx(i=>i+1); setAnimDir(null); },180);
  };
  const handleUndo=()=>{
    if(!history.length||idx===0) return;
    const last=history[history.length-1];
    setFloor(last.itemId,null,last.isDaily);
    setHistory(h=>h.slice(0,-1)); setIdx(i=>i-1);
  };
  const handleReset=()=>{
    if(!confirm("仕分けを最初からやり直しますか？")) return;
    history.forEach(h=>setFloor(h.itemId,null,h.isDaily));
    setHistory([]); setIdx(0);
  };
  const onTouchStart=e=>{ touchStartRef.current={x:e.touches[0].clientX,y:e.touches[0].clientY}; };
  const onTouchEnd=e=>{
    if(!touchStartRef.current||!current) return;
    const dx=e.changedTouches[0].clientX-touchStartRef.current.x;
    const dy=e.changedTouches[0].clientY-touchStartRef.current.y;
    const absDx=Math.abs(dx); const absDy=Math.abs(dy);
    if(absDx<40&&absDy<40) return;
    let dir; if(absDx>absDy){ dir=dx>0?"right":"left"; } else{ dir=dy<0?"up":"down"; }
    const cat=(sortCats||[]).find(c=>c.dir===dir);
    if(cat) handleSelect(cat);
    touchStartRef.current=null;
  };

  if(!current) return(<div style={{padding:28,textAlign:"center"}}>
    <div style={{fontSize:52,marginBottom:12}}>✅</div>
    <div style={{color:"#9E9E9E",fontSize:14,marginBottom:16}}>仕分け完了！</div>
    <div style={{padding:"0 16px"}}><BtnFull label="④ 確認・送信へ →" color="#0D47A1" onClick={onDone}/></div>
  </div>);

  const progress=Math.round((idx/initList.length)*100);
  const tx=animDir==="right"?"translateX(130%) rotate(18deg)":animDir==="left"?"translateX(-130%) rotate(-18deg)":animDir==="up"?"translateY(-130%)":animDir==="down"?"translateY(130%)":"none";
  const cats=sortCats||[];
  const rightCat=cats.find(c=>c.dir==="right"); const leftCat=cats.find(c=>c.dir==="left");
  const upCat=cats.find(c=>c.dir==="up"); const downCat=cats.find(c=>c.dir==="down");

  return(<div style={{padding:"16px 13px"}} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
    <div style={{marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:12,color:"#9E9E9E"}}><span>仕分け中</span><span>{idx} / {initList.length}</span></div>
      <div style={{height:5,background:"#E0E0E0",borderRadius:3}}><div style={{height:"100%",background:"#1565C0",borderRadius:3,width:`${progress}%`,transition:"width .25s ease"}}/></div>
    </div>
    {upCat&&<div style={{marginBottom:8}}><button onClick={()=>handleSelect(upCat)} style={{width:"100%",padding:"12px",border:"none",borderRadius:10,background:upCat.color,color:"white",fontSize:15,fontWeight:700}}>↑ {upCat.name}</button></div>}
    <div style={{background:"white",borderRadius:18,padding:"36px 24px",textAlign:"center",boxShadow:"0 6px 24px rgba(0,0,0,.1)",marginBottom:12,minHeight:140,transform:tx,opacity:animDir?0:1,transition:"transform .18s ease, opacity .18s ease"}}>
      <div style={{fontSize:13,color:"#9E9E9E",marginBottom:10}}>{isDaily?"🧴 日用品":"🥩 食材"}</div>
      <div style={{fontSize:24,fontWeight:700,marginBottom:8}}>{current.name}</div>
      {current.qty&&<div style={{fontSize:14,color:"#757575"}}>{current.qty}</div>}
      <div style={{fontSize:11,color:"#BDBDBD",marginTop:8}}>スワイプまたはボタンで仕分け</div>
    </div>
    <div style={{display:"flex",gap:10,marginBottom:8}}>
      {leftCat&&<button onClick={()=>handleSelect(leftCat)} style={{flex:1,padding:"18px 8px",border:"none",borderRadius:14,background:leftCat.color,color:"white",fontSize:17,fontWeight:700,boxShadow:"0 4px 10px rgba(0,0,0,.18)"}}>← {leftCat.name}</button>}
      {rightCat&&<button onClick={()=>handleSelect(rightCat)} style={{flex:1,padding:"18px 8px",border:"none",borderRadius:14,background:rightCat.color,color:"white",fontSize:17,fontWeight:700,boxShadow:"0 4px 10px rgba(0,0,0,.18)"}}>→ {rightCat.name}</button>}
    </div>
    {downCat&&<div style={{marginBottom:8}}><button onClick={()=>handleSelect(downCat)} style={{width:"100%",padding:"12px",border:"none",borderRadius:10,background:downCat.color,color:"white",fontSize:15,fontWeight:700}}>↓ {downCat.name}</button></div>}
    <div style={{display:"flex",gap:8}}>
      <button onClick={handleUndo} disabled={!history.length} style={{flex:1,padding:"11px 8px",border:`2px solid ${history.length?"#9E9E9E":"#E0E0E0"}`,borderRadius:10,background:"white",color:history.length?"#424242":"#BDBDBD",fontSize:13,fontWeight:600,cursor:history.length?"pointer":"not-allowed"}}>← 1つ戻る</button>
      <button onClick={handleReset} style={{flex:1,padding:"11px 8px",border:"2px solid #EF5350",borderRadius:10,background:"white",color:"#EF5350",fontSize:13,fontWeight:600}}>🔄 全リセット</button>
    </div>
  </div>);
}

/* Step4 */
function Step4({sess,plan,sortCats,save,notify,groups,dishes,onConfirm}){
  const included=[...(sess.items||[]).filter(i=>!i.excluded),...(sess.dailyGoods||[]).filter(i=>i.selected!==false)];

  const handleCopy=async()=>{
    const msg=buildLINEMessage(plan,sess,sortCats||[],dishes);
    try{
      await navigator.clipboard.writeText(msg);
      onConfirm();
      notify("✅ コピーしました！LINEに貼り付けてください。");
    }catch(e){ alert("コピーに失敗しました"); }
  };

  return(<div style={{padding:"12px 13px 20px"}}>
    {plan?.groups&&(<div style={{marginBottom:16}}>
      <Lbl color="#2E7D32">📅 今週の献立</Lbl>
      <div style={{background:"white",borderRadius:12,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
        {plan.groups.map((g,gi)=>{
          const gInfo=groups[gi]||groups[0];
          const lunchMain=g.lunch?.name||"";
          const dinnerMain=g.dinner?.name||"";
          const mainIng=(sess.items||[]).filter(i=>i.groupIdx===gi&&i.dishType==="dinner_main"&&!i.excluded&&i.type==="ingredient");
          return(<div key={gi} style={{padding:"11px 14px",borderBottom:gi<plan.groups.length-1?"1px solid #F5F5F5":"none"}}>
            {lunchMain&&<div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:2}}>
              <span style={{fontSize:11,fontWeight:700,color:gInfo.color,minWidth:56,flexShrink:0}}>{gInfo.label}</span>
              <span style={{fontSize:12,color:"#757575"}}>☀️ {lunchMain}</span>
            </div>}
            <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:3}}>
              <span style={{fontSize:11,fontWeight:700,color:gInfo.color,minWidth:56,flexShrink:0}}>{lunchMain?"":gInfo.label}</span>
              <span style={{fontSize:15,fontWeight:600}}>🌙 {dinnerMain||"（削除済み）"}</span>
            </div>
            {mainIng.length>0&&<div style={{fontSize:11,color:"#9E9E9E",marginLeft:64,marginBottom:3}}>食材：{mainIng.map(i=>`${i.name}${i.qty?` ${i.qty}`:""}`).join("、")}</div>}
            {(g.dinner?.sides||[]).map((side,si)=>{
              const sideIng=(sess.items||[]).filter(i=>i.groupIdx===gi&&i.dishType===`dinner_side${si+1}`&&!i.excluded&&i.type==="ingredient");
              return(<div key={si} style={{marginLeft:64}}>
                <span style={{fontSize:12,color:"#757575"}}>🥗 {side}</span>
                {sideIng.length>0&&<div style={{fontSize:11,color:"#BDBDBD"}}>食材：{sideIng.map(i=>`${i.name}${i.qty?` ${i.qty}`:""}`).join("、")}</div>}
              </div>);
            })}
            {g.dinner?.soup&&<div style={{marginLeft:64,fontSize:12,color:"#757575"}}>🍲 {g.dinner.soup}</div>}
          </div>);
        })}
      </div>
    </div>)}
    <Lbl color="#0D47A1">🛒 買い物リスト</Lbl>
    {(sortCats||[]).map(cat=>{
      const catItems=included.filter(i=>i.floor===cat.id); if(!catItems.length) return null;
      return(<div key={cat.id} style={{background:"white",borderRadius:12,marginBottom:8,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
        <div style={{background:cat.color,color:"white",padding:"7px 14px",fontSize:13,fontWeight:700}}>{cat.name}（{catItems.length}品）</div>
        {catItems.map((it,i)=>(<div key={it.id} style={{padding:"9px 14px",fontSize:14,borderBottom:i<catItems.length-1?"1px solid #F5F5F5":"none"}}>{it.name}{it.qty?` — ${it.qty}`:""}</div>))}
      </div>);
    })}
    {included.filter(i=>!i.floor).length>0&&<div style={{background:"white",borderRadius:12,marginBottom:8,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
      <div style={{background:"#9E9E9E",color:"white",padding:"7px 14px",fontSize:13,fontWeight:700}}>未仕分け</div>
      {included.filter(i=>!i.floor).map((it,i)=>(<div key={it.id} style={{padding:"9px 14px",fontSize:14,borderBottom:"1px solid #F5F5F5"}}>{it.name}{it.qty?` — ${it.qty}`:""}</div>))}
    </div>}
    <div style={{marginTop:18}}>
      <BtnFull label="📋 LINEに貼付用コピー（献立確定）" color="#2E7D32" onClick={handleCopy}/>
      <div style={{fontSize:11,color:"#9E9E9E",textAlign:"center",marginTop:6}}>コピーと同時に今週の献立がローテーションに記録されます</div>
    </div>
  </div>);
}

/* ══════════════════════════════════════════
   SETTINGS SCREEN
══════════════════════════════════════════ */
function DayGroupEditor({dayGroups,onChange}){
  const getGid=day=>dayGroups[day]||1;
  const cycleDayGroup=day=>{
    const curGid=getGid(day);
    const existingGids=[...new Set(DAYS.map(d=>dayGroups[d]||1))].sort((a,b)=>a-b);
    const maxGid=existingGids[existingGids.length-1];
    const canAdd=existingGids.length<GROUP_COLORS.length;
    const maxAllowed=Math.min(maxGid+1,GROUP_COLORS.length);
    const nextGid=curGid>=maxAllowed?1:canAdd?curGid+1:((curGid%maxGid)+1);
    onChange({...dayGroups,[day]:nextGid});
  };
  const groupMap={};
  DAYS.forEach(day=>{ const gid=getGid(day); if(!groupMap[gid]) groupMap[gid]=[]; groupMap[gid].push(day); });
  const summaryGroups=Object.entries(groupMap).sort((a,b)=>a[0]-b[0]);
  return(<div>
    <div style={{display:"flex",gap:6,marginBottom:10}}>
      {DAYS.map(day=>{ const gid=getGid(day); const ci=(gid-1)%GROUP_COLORS.length; const color=GROUP_COLORS[ci]; const light=GROUP_LIGHT[ci];
        return(<button key={day} onClick={()=>cycleDayGroup(day)} style={{flex:1,padding:"10px 2px",border:"2px solid "+color,borderRadius:8,background:light,color,fontWeight:700,fontSize:14,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
          <span>{DAY_JP[day]}</span><span style={{fontSize:9,opacity:0.8}}>G{gid}</span>
        </button>);
      })}
    </div>
    <div style={{fontSize:12,color:"#9E9E9E"}}>
      {summaryGroups.map(([gid,days])=>(<div key={gid} style={{display:"flex",alignItems:"center",gap:4,marginBottom:3}}>
        <div style={{width:10,height:10,borderRadius:2,background:GROUP_COLORS[(Number(gid)-1)%GROUP_COLORS.length],flexShrink:0}}/>
        <span>G{gid}：{days.map(d=>DAY_JP[d]).join("・")}（{days.length}日間・同一献立）</span>
      </div>))}
    </div>
  </div>);
}

function SortCatsEditor({sortCats,onChange}){
  const cats=sortCats||[];
  const dirs=["right","left","up","down"];
  const updateCat=(i,patch)=>onChange(cats.map((c,ci)=>ci===i?{...c,...patch}:c));
  const deleteCat=i=>{ if(cats.length<=1){alert("最低1つは必要です");return;} onChange(cats.filter((_,ci)=>ci!==i)); };
  const addCat=()=>{
    if(cats.length>=4){alert("最大4つまでです");return;}
    const usedDirs=cats.map(c=>c.dir);
    const dir=dirs.find(d=>!usedDirs.includes(d))||"right";
    onChange([...cats,{id:`cat_${Date.now()}`,name:"新カテゴリ",color:CAT_COLORS[cats.length%CAT_COLORS.length],dir}]);
  };
  const DIR_LABELS={right:"→",left:"←",up:"↑",down:"↓"};
  return(<div>
    {cats.map((cat,i)=>(<div key={cat.id} style={{background:"#F7F8FA",borderRadius:10,padding:"10px 12px",marginBottom:8}}>
      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
        <div style={{width:14,height:14,borderRadius:3,background:cat.color,flexShrink:0}}/>
        <input value={cat.name} onChange={e=>updateCat(i,{name:e.target.value})} style={{flex:1,padding:"7px 10px",border:"2px solid #E0E0E0",borderRadius:7,fontSize:14}}/>
        <button onClick={()=>deleteCat(i)} style={{padding:"6px 10px",background:"#FFEBEE",color:"#C62828",border:"1px solid #FFCDD2",borderRadius:7,fontSize:12,fontWeight:600}}>削除</button>
      </div>
      <div style={{display:"flex",gap:6}}>
        {dirs.map(dir=>(<button key={dir} onClick={()=>updateCat(i,{dir})} style={{flex:1,padding:"6px 4px",border:`1.5px solid ${cat.dir===dir?cat.color:"#E0E0E0"}`,borderRadius:7,background:cat.dir===dir?cat.color+"22":"white",color:cat.dir===dir?cat.color:"#9E9E9E",fontSize:13,fontWeight:600}}>{DIR_LABELS[dir]}</button>))}
      </div>
    </div>))}
    {cats.length<4&&<button onClick={addCat} style={{width:"100%",padding:"10px",background:"#F7F8FA",border:"2px dashed #E0E0E0",borderRadius:10,color:"#9E9E9E",fontSize:14,fontWeight:600}}>＋ カテゴリを追加</button>}
  </div>);
}

function NgFoodsEditor({ngFoods,onChange}){
  const [input,setInput]=useState("");
  const add=()=>{ const v=input.trim(); if(!v||ngFoods.includes(v))return; onChange([...ngFoods,v]); setInput(""); };
  return(<div>
    <div style={{display:"flex",gap:8,marginBottom:10}}>
      <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="食材名（例：えび）" style={{flex:1,padding:"9px 11px",border:"2px solid #E0E0E0",borderRadius:8,fontSize:14}}/>
      <button onClick={add} style={{padding:"9px 14px",background:"#C62828",color:"white",border:"none",borderRadius:8,fontSize:14,fontWeight:700}}>追加</button>
    </div>
    {ngFoods.length===0&&<div style={{fontSize:12,color:"#BDBDBD"}}>登録なし</div>}
    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
      {ngFoods.map((name,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:4,padding:"6px 10px",background:"#FFEBEE",borderRadius:16,border:"1px solid #FFCDD2"}}>
        <span style={{fontSize:13}}>🚫 {name}</span>
        <button onClick={()=>onChange(ngFoods.filter((_,fi)=>fi!==i))} style={{background:"none",border:"none",color:"#C62828",fontSize:16,cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
      </div>))}
    </div>
  </div>);
}

function FrozenMealsEditor({frozenMeals,onChange}){
  const toggle=key=>{ if(frozenMeals.includes(key)) onChange(frozenMeals.filter(k=>k!==key)); else onChange([...frozenMeals,key]); };
  return(<div>
    <p style={{fontSize:12,color:"#9E9E9E",marginBottom:10,lineHeight:1.6}}>❄️をタップすると冷凍食品固定になります。</p>
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr>
          <th style={{padding:"6px 4px",color:"#9E9E9E",fontWeight:600,width:40}}></th>
          {DAYS.map(d=>(<th key={d} style={{padding:"6px 4px",color:"#616161",fontWeight:600,textAlign:"center"}}>{DAY_JP[d]}</th>))}
        </tr></thead>
        <tbody>{["lunch","dinner"].map(meal=>(<tr key={meal}>
          <td style={{padding:"6px 4px",color:"#9E9E9E",fontSize:11,fontWeight:600}}>{meal==="lunch"?"昼":"夜"}</td>
          {DAYS.map(d=>{ const key=`${d}_${meal}`; const on=frozenMeals.includes(key);
            return(<td key={d} style={{padding:"4px",textAlign:"center"}}>
              <button onClick={()=>toggle(key)} style={{width:32,height:32,borderRadius:6,border:`1.5px solid ${on?"#1565C0":"#E0E0E0"}`,background:on?"#E3F2FD":"white",fontSize:16}}>{on?"❄️":"・"}</button>
            </td>);
          })}
        </tr>))}</tbody>
      </table>
    </div>
  </div>);
}

function MealConfigEditor({mealConfig,onChange}){
  const cfg=mealConfig||INIT_SETTINGS.meal_config;
  const upd=(meal,patch)=>onChange({...cfg,[meal]:{...cfg[meal],...patch}});
  return(<div>
    {["lunch","dinner"].map(meal=>(<div key={meal} style={{marginBottom:12}}>
      <Lbl>{meal==="lunch"?"昼食":"夕食"}</Lbl>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:13,color:"#757575"}}>おかず</span>
        {[0,1,2,3,4].map(n=>(<button key={n} onClick={()=>upd(meal,{sides:n})} style={{width:36,height:36,borderRadius:18,border:`2px solid ${cfg[meal].sides===n?"#2E7D32":"#E0E0E0"}`,background:cfg[meal].sides===n?"#E8F5E9":"white",color:cfg[meal].sides===n?"#2E7D32":"#757575",fontWeight:700,fontSize:14}}>{n}</button>))}
        <span style={{fontSize:13,color:"#757575"}}>品</span>
        <button onClick={()=>upd(meal,{soup:!cfg[meal].soup})} style={{padding:"7px 12px",border:`2px solid ${cfg[meal].soup?"#0D47A1":"#E0E0E0"}`,borderRadius:8,background:cfg[meal].soup?"#E3F2FD":"white",color:cfg[meal].soup?"#0D47A1":"#757575",fontSize:13,fontWeight:600}}>汁物{cfg[meal].soup?"✓ あり":"なし"}</button>
      </div>
    </div>))}
  </div>);
}

/* ── IngredientRowEditor（外部定義） ── */
function IngredientRowEditor({items,onUpdate}){
  const [nn,setNn]=useState(""); const [nq,setNq]=useState(""); const [nu,setNu]=useState("g");
  const add=()=>{ if(!nn.trim())return; onUpdate([...(items||[]),{name:nn.trim(),qty:parseFloat(nq)||0,unit:nu}]); setNn("");setNq("");setNu("g"); };
  return(<div>
    {(items||[]).map((ing,ii)=>(<div key={ii} style={{display:"flex",gap:4,marginBottom:4,alignItems:"center"}}>
      <input value={ing.name||""} onChange={e=>onUpdate(items.map((x,xi)=>xi===ii?{...x,name:e.target.value}:x))} style={{flex:2,padding:"6px 8px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:12}}/>
      <input value={ing.qty||""} onChange={e=>onUpdate(items.map((x,xi)=>xi===ii?{...x,qty:parseFloat(e.target.value)||0}:x))} style={{width:44,padding:"6px 4px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:12,textAlign:"center"}} placeholder="量"/>
      <input value={ing.unit||""} onChange={e=>onUpdate(items.map((x,xi)=>xi===ii?{...x,unit:e.target.value}:x))} style={{width:48,padding:"6px 4px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:12}}/>
      <button onClick={()=>onUpdate(items.filter((_,xi)=>xi!==ii))} style={{padding:"4px 6px",background:"#FFEBEE",color:"#C62828",border:"none",borderRadius:5,fontSize:11}}>×</button>
    </div>))}
    <div style={{display:"flex",gap:4,marginTop:4}}>
      <input value={nn} onChange={e=>setNn(e.target.value)} placeholder="名前" style={{flex:2,padding:"6px 8px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:12}}/>
      <input value={nq} onChange={e=>setNq(e.target.value)} placeholder="量" style={{width:44,padding:"6px 4px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:12,textAlign:"center"}}/>
      <input value={nu} onChange={e=>setNu(e.target.value)} style={{width:48,padding:"6px 4px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:12}}/>
      <button onClick={add} style={{padding:"4px 8px",background:"#1565C0",color:"white",border:"none",borderRadius:5,fontSize:12,fontWeight:700}}>追加</button>
    </div>
  </div>);
}

/* ── EntryForm（外部定義） ── */
function EntryForm({data,onChange}){
  return(
    <div>
      <Lbl>カテゴリ（最大2つ）</Lbl>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
        {MENU_CATEGORIES.map(cat=>{ const sel=data.cats.includes(cat); return(
          <button key={cat} onClick={()=>{ if(sel) onChange({...data,cats:data.cats.filter(c=>c!==cat)}); else if(data.cats.length<2) onChange({...data,cats:[...data.cats,cat]}); }} style={{padding:"5px 10px",borderRadius:14,border:`1.5px solid ${sel?"#2E7D32":"#E0E0E0"}`,background:sel?"#E8F5E9":"white",color:sel?"#2E7D32":"#757575",fontSize:12,fontWeight:500}}>{cat}</button>
        );})}
      </div>
      <Lbl>提供タイミング</Lbl>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        {[["both","昼・夜"],["lunch","昼のみ"],["dinner","夜のみ"]].map(([v,l])=>(
          <button key={v} onClick={()=>onChange({...data,meal:v})} style={{flex:1,padding:"8px",border:`1.5px solid ${data.meal===v?"#2E7D32":"#E0E0E0"}`,borderRadius:8,background:data.meal===v?"#E8F5E9":"white",color:data.meal===v?"#2E7D32":"#757575",fontSize:13,fontWeight:data.meal===v?700:400}}>{l}</button>
        ))}
      </div>
      <Lbl>難易度</Lbl>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {[1,2,3].map(d=>(<button key={d} onClick={()=>onChange({...data,diff:d})} style={{flex:1,padding:"8px",border:`1.5px solid ${data.diff===d?DIFF_COLORS[d]:"#E0E0E0"}`,borderRadius:8,background:data.diff===d?DIFF_COLORS[d]+"22":"white",color:data.diff===d?DIFF_COLORS[d]:"#9E9E9E",fontSize:13,fontWeight:600}}>{DIFF_LABELS[d]}</button>))}
      </div>
      {data.variants.map((v,vi)=>(
        <div key={v.variantId} style={{background:"#F7F8FA",borderRadius:10,padding:"12px",marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <input value={v.label} onChange={e=>{ const vs=[...data.variants]; vs[vi]={...vs[vi],label:e.target.value}; onChange({...data,variants:vs}); }} style={{flex:1,padding:"6px 10px",border:"1.5px solid #E0E0E0",borderRadius:7,fontSize:14,fontWeight:600}}/>
            {data.variants.length>1&&<button onClick={()=>onChange({...data,variants:data.variants.filter((_,i)=>i!==vi)})} style={{marginLeft:8,padding:"4px 8px",background:"#FFEBEE",color:"#C62828",border:"none",borderRadius:6,fontSize:12}}>削除</button>}
          </div>
          <Lbl>食材</Lbl>
          <IngredientRowEditor items={v.ingredients||[]} onUpdate={ings=>{ const vs=[...data.variants]; vs[vi]={...vs[vi],ingredients:ings}; onChange({...data,variants:vs}); }}/>
          <Lbl style={{marginTop:8}}>調味料</Lbl>
          <IngredientRowEditor items={v.seasonings||[]} onUpdate={seas=>{ const vs=[...data.variants]; vs[vi]={...vs[vi],seasonings:seas}; onChange({...data,variants:vs}); }}/>
        </div>
      ))}
      <button onClick={()=>onChange({...data,variants:[...data.variants,{variantId:`v${data.variants.length+1}`,label:`バリエーション${data.variants.length+1}`,ingredients:[],seasonings:[]}]})} style={{width:"100%",padding:"9px",background:"#F7F8FA",border:"2px dashed #E0E0E0",borderRadius:8,color:"#9E9E9E",fontSize:13,marginTop:4}}>＋ バリエーションを追加</button>
    </div>
  );
}

/* ── DBMenuEditorInline: 単一料理の編集（献立タブから開く用） ── */
function DBMenuEditorInline({dishName,dishes,onSave,onSaveDishes}){
  const dbItem=MENU_DB.find(i=>i.name===dishName);
  const override=dishes?.[dishName];
  const initVariants=override?.variants||dbItem?.variants||[{variantId:"default",label:"デフォルト",ingredients:[],seasonings:[]}];
  const [editData,setEditData]=useState({
    cats:override?.cats||dbItem?.cats||["その他"],
    meal:override?.meal||dbItem?.meal||"dinner",
    diff:override?.difficulty||dbItem?.diff||2,
    variants:JSON.parse(JSON.stringify(initVariants))
  });

  const save=()=>{
    const prev=dishes?.[dishName]||{};
    onSave(dishName,{...prev,cats:editData.cats,meal:editData.meal,difficulty:editData.diff,variants:editData.variants});
  };


  return(<div style={{maxHeight:"65vh",overflowY:"auto"}}>
    <Lbl>カテゴリ（最大2つ）</Lbl>
    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
      {MENU_CATEGORIES.map(cat=>{ const sel=editData.cats.includes(cat); return(
        <button key={cat} onClick={()=>{ if(sel) setEditData(d=>({...d,cats:d.cats.filter(c=>c!==cat)})); else if(editData.cats.length<2) setEditData(d=>({...d,cats:[...d.cats,cat]})); }} style={{padding:"4px 9px",borderRadius:12,border:`1.5px solid ${sel?"#2E7D32":"#E0E0E0"}`,background:sel?"#E8F5E9":"white",color:sel?"#2E7D32":"#757575",fontSize:12}}>
          {cat}
        </button>
      );})}
    </div>
    <Lbl>提供タイミング</Lbl>
    <div style={{display:"flex",gap:6,marginBottom:10}}>
      {[["both","昼・夜"],["lunch","昼のみ"],["dinner","夜のみ"]].map(([v,l])=>(
        <button key={v} onClick={()=>setEditData(d=>({...d,meal:v}))} style={{flex:1,padding:"7px",border:`1.5px solid ${editData.meal===v?"#2E7D32":"#E0E0E0"}`,borderRadius:7,background:editData.meal===v?"#E8F5E9":"white",color:editData.meal===v?"#2E7D32":"#757575",fontSize:12,fontWeight:editData.meal===v?700:400}}>{l}</button>
      ))}
    </div>
    <Lbl>難易度</Lbl>
    <div style={{display:"flex",gap:6,marginBottom:12}}>
      {[1,2,3].map(d=>(<button key={d} onClick={()=>setEditData(ed=>({...ed,diff:d}))} style={{flex:1,padding:"7px",border:`1.5px solid ${editData.diff===d?DIFF_COLORS[d]:"#E0E0E0"}`,borderRadius:7,background:editData.diff===d?DIFF_COLORS[d]+"22":"white",color:editData.diff===d?DIFF_COLORS[d]:"#9E9E9E",fontSize:12,fontWeight:600}}>{DIFF_LABELS[d]}</button>))}
    </div>
    {editData.variants.map((v,vi)=>(
      <div key={v.variantId} style={{background:"#F7F8FA",borderRadius:10,padding:"12px",marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <input value={v.label} onChange={e=>{ const vs=[...editData.variants]; vs[vi]={...vs[vi],label:e.target.value}; setEditData(d=>({...d,variants:vs})); }} style={{flex:1,padding:"6px 10px",border:"1.5px solid #E0E0E0",borderRadius:7,fontSize:13,fontWeight:600}}/>
          {editData.variants.length>1&&<button onClick={()=>setEditData(d=>({...d,variants:d.variants.filter((_,i)=>i!==vi)}))} style={{marginLeft:8,padding:"4px 8px",background:"#FFEBEE",color:"#C62828",border:"none",borderRadius:6,fontSize:11}}>削除</button>}
        </div>
        {/* バリエーションごとのレシピURL */}
        <div style={{marginBottom:8}}>
          <div style={{fontSize:11,color:"#9E9E9E",marginBottom:3}}>レシピURL（このバリエーション用）</div>
          <div style={{display:"flex",gap:6}}>
            <input value={v.recipeUrl||""} onChange={e=>{ const vs=[...editData.variants]; vs[vi]={...vs[vi],recipeUrl:e.target.value}; setEditData(d=>({...d,variants:vs})); }} placeholder="https://..." style={{flex:1,padding:"6px 8px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:12}}/>
            {v.recipeUrl&&<a href={v.recipeUrl} target="_blank" rel="noopener noreferrer" style={{padding:"6px 8px",background:"#E3F2FD",color:"#1565C0",borderRadius:6,fontSize:11,display:"flex",alignItems:"center",textDecoration:"none"}}>開く</a>}
          </div>
        </div>
        <Lbl>食材</Lbl>
        <IngredientRowEditor items={v.ingredients||[]} onUpdate={ings=>{ const vs=[...editData.variants]; vs[vi]={...vs[vi],ingredients:ings}; setEditData(d=>({...d,variants:vs})); }}/>
        <div style={{marginTop:8}}><Lbl>調味料</Lbl></div>
        <IngredientRowEditor items={v.seasonings||[]} onUpdate={seas=>{ const vs=[...editData.variants]; vs[vi]={...vs[vi],seasonings:seas}; setEditData(d=>({...d,variants:vs})); }}/>
      </div>
    ))}
    <button onClick={()=>setEditData(d=>({...d,variants:[...d.variants,{variantId:`v${d.variants.length+1}`,label:`バリエーション${d.variants.length+1}`,ingredients:[],seasonings:[],recipeUrl:""}]}))} style={{width:"100%",padding:"9px",background:"#F7F8FA",border:"2px dashed #E0E0E0",borderRadius:8,color:"#9E9E9E",fontSize:13,marginBottom:12}}>＋ バリエーションを追加</button>
    <button onClick={save} style={{display:"block",width:"100%",padding:"13px",background:"#2E7D32",color:"white",border:"none",borderRadius:10,fontSize:14,fontWeight:700}}>保存</button>
  </div>);
}

/* ── DBMenu Editor ── */
function DBMenuEditor({dishes,save,notify}){
  const [query,setQuery]=useState("");
  const [editTarget,setEditTarget]=useState(null);
  const [editData,setEditData]=useState(null);
  const [showAdd,setShowAdd]=useState(false);
  const [newEntry,setNewEntry]=useState({name:"",cats:["鶏肉料理"],meal:"dinner",diff:2,variants:[{variantId:"default",label:"デフォルト",ingredients:[],seasonings:[]}]});

  const allDbItems=MENU_DB;
  const results=query.length>0?allDbItems.filter(i=>i.name.includes(query)).slice(0,10):[];

  const openEdit=item=>{
    const override=dishes?.[item.name];
    const variants=override?.variants||item.variants||[{variantId:"default",label:"デフォルト",ingredients:[],seasonings:[]}];
    setEditData({
      name:item.name, cats:override?.cats||item.cats, meal:override?.meal||item.meal,
      diff:override?.difficulty||item.diff,
      variants:JSON.parse(JSON.stringify(variants))
    });
    setEditTarget(item.name);
    setQuery("");
  };

  const saveEdit=()=>{
    const prev=dishes?.[editTarget]||{};
    save({dishes:{...dishes,[editTarget]:{...prev,cats:editData.cats,meal:editData.meal,difficulty:editData.diff,variants:editData.variants}}});
    setEditTarget(null); setEditData(null);
    notify("✅ 保存しました");
  };

  const saveNew=()=>{
    if(!newEntry.name.trim()){alert("料理名を入力してください");return;}
    if(ALL_MENU_NAMES.includes(newEntry.name)||dishes?.[newEntry.name]?.isCustom){
      alert(`「${newEntry.name}」は既に登録されています`);return;
    }
    save({dishes:{...dishes,[newEntry.name]:{scores:[],difficulty:newEntry.diff,lastServed:null,cats:newEntry.cats,meal:newEntry.meal,variants:newEntry.variants,isCustom:true}}});
    setShowAdd(false); setNewEntry({name:"",cats:["鶏肉料理"],meal:"dinner",diff:2,variants:[{variantId:"default",label:"デフォルト",ingredients:[],seasonings:[]}]});
    notify("✅ 追加しました");
  };



  return(<div>
    {editTarget&&<BottomSheet title={`「${editTarget}」を編集`} onClose={()=>setEditTarget(null)}>
      <div style={{overflowY:"auto",maxHeight:"60vh"}}>
        <EntryForm data={editData} onChange={setEditData}/>
      </div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <Btn label="保存" color="#2E7D32" onClick={saveEdit}/>
        <Btn label="キャンセル" color="#9E9E9E" onClick={()=>setEditTarget(null)}/>
      </div>
    </BottomSheet>}

    {showAdd&&<BottomSheet title="新しいメニューを追加" onClose={()=>setShowAdd(false)}>
      <div style={{marginBottom:10}}>
        <Lbl>料理名</Lbl>
        <input value={newEntry.name} onChange={e=>setNewEntry(p=>({...p,name:e.target.value}))} placeholder="例：チキンカツ" style={{width:"100%",padding:"10px 12px",border:"2px solid #E0E0E0",borderRadius:8,fontSize:14}}/>
      </div>
      <div style={{overflowY:"auto",maxHeight:"55vh"}}>
        <EntryForm data={newEntry} onChange={setNewEntry}/>
      </div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <Btn label="追加" color="#2E7D32" onClick={saveNew}/>
        <Btn label="キャンセル" color="#9E9E9E" onClick={()=>setShowAdd(false)}/>
      </div>
    </BottomSheet>}

    <div style={{display:"flex",gap:8,marginBottom:10}}>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="料理名で検索（例：さば）" style={{flex:1,padding:"10px 12px",border:"2px solid #E0E0E0",borderRadius:8,fontSize:14}}/>
      <button onClick={()=>setShowAdd(true)} style={{padding:"10px 14px",background:"#2E7D32",color:"white",border:"none",borderRadius:8,fontSize:14,fontWeight:700}}>＋追加</button>
    </div>
    {results.length>0&&<div style={{background:"white",borderRadius:10,overflow:"hidden",border:"1px solid #E0E0E0",marginBottom:10}}>
      {results.map((item,i)=>(<button key={i} onClick={()=>openEdit(item)} style={{display:"block",width:"100%",padding:"11px 14px",background:"none",border:"none",borderBottom:i<results.length-1?"1px solid #F5F5F5":"none",textAlign:"left",fontSize:14}}>
        {item.name} <span style={{fontSize:11,color:"#9E9E9E"}}>{item.cats.join("・")}</span>
      </button>))}
    </div>}
    {/* Custom entries */}
    {Object.entries(dishes||{}).filter(([,v])=>v.isCustom).length>0&&<>
      <Lbl>追加した料理</Lbl>
      <div style={{background:"white",borderRadius:10,overflow:"hidden",border:"1px solid #E0E0E0"}}>
        {Object.entries(dishes||{}).filter(([,v])=>v.isCustom).map(([name],i,arr)=>(<button key={i} onClick={()=>openEdit({name,cats:dishes[name].cats||["その他"],meal:dishes[name].meal||"dinner",diff:dishes[name].difficulty||2,variants:dishes[name].variants||[]})} style={{display:"block",width:"100%",padding:"11px 14px",background:"none",border:"none",borderBottom:i<arr.length-1?"1px solid #F5F5F5":"none",textAlign:"left",fontSize:14}}>
          {name} <span style={{fontSize:11,color:"#9E9E9E"}}>カスタム</span>
        </button>))}
      </div>
    </>}
  </div>);
}

function SettingsScreen({st,save,setBusy,setBMsg,notify}){
  const s=st.settings;
  const [newGood,setNewGood]=useState("");
  const [sheetsMsg,setSheetsMsg]=useState("");
  const upd=patch=>save({settings:{...s,...patch}});

  const testSheets=async()=>{
    if(!s.sheets_url)return alert("URLを入力してください");
    setBusy(true);setBMsg("接続テスト中...");
    try{ await syncToSheets(s.sheets_url,s.sheets_token,st); setSheetsMsg("✅ 接続成功！"); }
    catch(e){ setSheetsMsg("❌ 失敗: "+e.message); }
    finally{setBusy(false);setBMsg("");}
  };
  const loadNow=async()=>{
    if(!s.sheets_url)return alert("URLを入力してください");
    setBusy(true);setBMsg("データを読み込み中...");
    try{
      const remote=await loadFromSheets(s.sheets_url,s.sheets_token);
      if(remote){
        const clean=sanitizeState({...INIT_STATE,...remote,settings:{...INIT_SETTINGS,...(remote.settings||{})}});
        save(clean); notify("✅ データを読み込みました！");
      } else alert("データがありませんでした");
    }catch(e){alert("エラー: "+e.message);}
    finally{setBusy(false);setBMsg("");}
  };
  const addGood=()=>{
    const name=newGood.trim();
    if(!name||(st.dailyGoods||[]).includes(name))return;
    save({dailyGoods:[...(st.dailyGoods||[]),name]});
    setNewGood("");
  };

  return(<div>
    <Hdr bg="#37474F" title="⚙️ 設定"/>
    <div style={{padding:"16px 13px"}}>

      <Card title="📊 Googleスプレッドシート連携">
        <p style={{fontSize:12,color:"#9E9E9E",marginBottom:10,lineHeight:1.6}}>複数端末でデータを共有できます。</p>
        <SettingsField label="GAS Web App URL" value={s.sheets_url} onChange={v=>upd({sheets_url:v})} placeholder="https://script.google.com/..."/>
        <SettingsField label="認証トークン（任意）" value={s.sheets_token} onChange={v=>upd({sheets_token:v})} placeholder="自分で決めたパスワード文字列"/>
        <div style={{display:"flex",gap:8}}>
          <Btn label="接続テスト" color="#37474F" onClick={testSheets}/>
          <Btn label="今すぐ読み込み" color="#1B5E20" onClick={loadNow}/>
        </div>
        {sheetsMsg&&<div style={{marginTop:8,fontSize:12,color:sheetsMsg.includes("✅")?"#2E7D32":"#C62828"}}>{sheetsMsg}</div>}
      </Card>

      <Card title="📅 曜日グループ設定">
        <p style={{fontSize:12,color:"#9E9E9E",marginBottom:10,lineHeight:1.6}}>同じ色の曜日は同じ献立になります。</p>
        <DayGroupEditor dayGroups={s.day_groups||INIT_SETTINGS.day_groups} onChange={v=>upd({day_groups:v})}/>
      </Card>

      <Card title="❄️ 冷凍食品設定">
        <FrozenMealsEditor frozenMeals={s.frozen_meals||[]} onChange={v=>upd({frozen_meals:v})}/>
      </Card>

      <Card title="🚫 NG食材">
        <NgFoodsEditor ngFoods={s.ng_foods||[]} onChange={v=>upd({ng_foods:v})}/>
      </Card>

      <Card title="👨‍👩‍👧 1食の人数">
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {[1,2,3,4,5].map(n=>(<button key={n} onClick={()=>upd({servings:n})} style={{width:44,height:44,borderRadius:22,border:`2px solid ${s.servings===n?"#2E7D32":"#E0E0E0"}`,background:s.servings===n?"#E8F5E9":"white",color:s.servings===n?"#2E7D32":"#757575",fontWeight:700,fontSize:16}}>{n}</button>))}
          <span style={{fontSize:13,color:"#757575"}}>人</span>
        </div>
      </Card>

      <Card title="🔄 ローテーション管理">
        <p style={{fontSize:12,color:"#9E9E9E",marginBottom:10,lineHeight:1.6}}>直近N週に出した料理は提案から除外します。</p>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {[1,2,3,4,5,6].map(n=>(<button key={n} onClick={()=>upd({rotation_weeks:n})} style={{width:44,height:44,borderRadius:22,border:`2px solid ${s.rotation_weeks===n?"#1565C0":"#E0E0E0"}`,background:s.rotation_weeks===n?"#E3F2FD":"white",color:s.rotation_weeks===n?"#1565C0":"#757575",fontWeight:700,fontSize:16}}>{n}</button>))}
          <span style={{fontSize:13,color:"#757575"}}>週間</span>
        </div>
      </Card>

      <Card title="🍽 食事構成設定">
        <MealConfigEditor mealConfig={s.meal_config} onChange={v=>upd({meal_config:v})}/>
      </Card>

      <Card title="↔️ 仕分けカテゴリ（最大4つ）">
        <SortCatsEditor sortCats={s.sort_cats} onChange={v=>upd({sort_cats:v})}/>
      </Card>

      <Card title="🔍 レシピ検索サイト">
        {(s.recipe_sites||INIT_SETTINGS.recipe_sites).map((site,i)=>(<div key={site.id} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
          <span style={{fontSize:18,width:28,flexShrink:0}}>{site.id==="nadia"?"👩‍🍳":site.id==="cookpad"?"🍳":site.id==="youtube"?"▶️":"📸"}</span>
          <input value={site.label} onChange={e=>{ const sites=(s.recipe_sites||INIT_SETTINGS.recipe_sites).map((ss,si)=>si===i?{...ss,label:e.target.value}:ss); upd({recipe_sites:sites}); }} style={{flex:1,padding:"7px 10px",border:"2px solid #E0E0E0",borderRadius:7,fontSize:14}}/>
        </div>))}
      </Card>

      <Card title="📖 レシピDB管理">
        <DBMenuEditor dishes={st.dishes} save={save} notify={notify}/>
      </Card>

      <Card title="🧴 日用品リスト">
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <input value={newGood} onChange={e=>setNewGood(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addGood()} placeholder="日用品名を入力..."
            style={{flex:1,padding:"9px 11px",border:"2px solid #E0E0E0",borderRadius:8,fontSize:14}}/>
          <button onClick={addGood} style={{padding:"9px 14px",background:"#E65100",color:"white",border:"none",borderRadius:8,fontSize:14,fontWeight:700}}>追加</button>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {(st.dailyGoods||[]).map((name,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:4,padding:"6px 10px",background:"#FBE9E7",borderRadius:16,border:"1px solid #FFCCBC"}}>
            <span style={{fontSize:13}}>{name}</span>
            <button onClick={()=>save({dailyGoods:(st.dailyGoods||[]).filter(g=>g!==name)})} style={{background:"none",border:"none",color:"#BF360C",fontSize:16,cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
          </div>))}
        </div>
      </Card>

      <Card title="🗑️ データ管理">
        <button onClick={()=>{ if(!confirm("献立と買い物リストをリセットしますか？\n設定・評価は保持されます。"))return; save({plan:null,session:null,pendingUpdate:false}); }}
          style={{width:"100%",padding:11,background:"#FFEBEE",color:"#C62828",border:"2px solid #EF9A9A",borderRadius:8,fontSize:13,fontWeight:600}}>
          献立・買い物リストをリセット
        </button>
      </Card>
    </div>
  </div>);
}

/* ══════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════ */
export default function App(){
  const [st,setSt]=useState(()=>loadState());
  const [tab,setTab]=useState(0);
  const [busy,setBusy]=useState(false);
  const [bMsg,setBMsg]=useState("");
  const [toast,setToast]=useState(null);
  const [syncStatus,setSyncStatus]=useState("idle");
  const syncTimer=useRef(null);
  const isFirst=useRef(true);

  useEffect(()=>{
    saveState(st);
    if(isFirst.current){isFirst.current=false;return;}
    if(!st.settings.sheets_url) return;
    clearTimeout(syncTimer.current);
    setSyncStatus("pending");
    syncTimer.current=setTimeout(async()=>{
      setSyncStatus("syncing");
      try{ await syncToSheets(st.settings.sheets_url,st.settings.sheets_token,st); setSyncStatus("ok"); setTimeout(()=>setSyncStatus("idle"),2000); }
      catch(e){ setSyncStatus("err"); }
    },2000);
  },[st]);

  useEffect(()=>{
    const {sheets_url,sheets_token}=st.settings;
    if(!sheets_url) return;
    (async()=>{ try{
      const remote=await loadFromSheets(sheets_url,sheets_token);
      if(remote){
        const clean=sanitizeState({...INIT_STATE,...remote,settings:{...INIT_SETTINGS,...(remote.settings||{})}});
        setSt(prev=>({...prev,...clean}));
      }
    }catch(e){} })();
  },[]);

  const save=useCallback(patch=>{
    setSt(prev=>{
      const next={...prev};
      Object.keys(patch).forEach(k=>{ next[k]=k==="settings"?{...prev.settings,...patch.settings}:patch[k]; });
      return next;
    });
  },[]);

  const setFloor=useCallback((itemId,floor,isDaily=false)=>{
    setSt(prev=>{
      if(!prev.session) return prev;
      const newSortMem={...prev.sortMem};
      const newSession={...prev.session};
      if(isDaily){
        const item=(prev.session.dailyGoods||[]).find(i=>i.id===itemId);
        if(item&&floor) newSortMem[item.name]=floor;
        newSession.dailyGoods=(prev.session.dailyGoods||[]).map(i=>i.id===itemId?{...i,floor}:i);
      }else{
        const item=(prev.session.items||[]).find(i=>i.id===itemId);
        if(item&&floor) newSortMem[item.name]=floor;
        newSession.items=(prev.session.items||[]).map(i=>i.id===itemId?{...i,floor}:i);
      }
      return {...prev,session:newSession,sortMem:newSortMem};
    });
  },[]);

  const notify=useCallback((msg)=>{
    setToast(msg);
    setTimeout(()=>setToast(null),3000);
  },[]);

  // Step4コピー時にlastServedを更新（献立確定）
  const handleConfirm=useCallback(()=>{
    setSt(prev=>{
      if(!prev.plan) return prev;
      const newDishes={...prev.dishes};
      prev.plan.groups.forEach(g=>{
        const names=[g.lunch?.name,g.dinner?.name,...(g.dinner?.sides||[]),g.dinner?.soup].filter(Boolean);
        names.forEach(name=>{
          if(name==="冷凍食品"||name==="お好みで") return;
          newDishes[name]={...(newDishes[name]||{scores:[],difficulty:0}),lastServed:prev.plan.weekStart};
        });
      });
      return {...prev,dishes:newDishes};
    });
  },[]);

  const handleTabChange=useCallback((newTab)=>{
    setTab(newTab);
  },[]);

  return(<div style={{maxWidth:480,margin:"0 auto",minHeight:"100dvh",background:"#F7F8FA",fontFamily:"'Noto Sans JP',sans-serif",paddingBottom:72,position:"relative"}}>
    <style>{CSS}</style>
    {busy&&<Overlay msg={bMsg}/>}
    {toast&&<Toast msg={toast}/>}
    <SyncBadge status={syncStatus}/>
    {tab===0&&<MenuScreen st={st} save={save} notify={notify} onTabChange={handleTabChange}/>}
    {tab===1&&<RatingScreen st={st} save={save} notify={notify}/>}
    {tab===2&&<ShopScreen st={st} save={save} notify={notify} setFloor={setFloor} onConfirm={handleConfirm}/>}
    {tab===3&&<ErrorBoundary><SettingsScreen st={st} save={save} setBusy={setBusy} setBMsg={setBMsg} notify={notify}/></ErrorBoundary>}
    <BottomNav tab={tab} setTab={handleTabChange}/>
  </div>);
}
