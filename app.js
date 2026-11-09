'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const FRONTEND_VERSION=$('meta[name="frontend-version"]')?.content;
const COLORS={B1:'#0072B2',B2:'#D55E00',B3:'#CC79A7',V0:'#009E73'};
const LABELS={running:'正在跑',complete:'已完成',paused:'已暂停',not_run:'未跑',no_data:'无数据',ended:'已结束',blocked:'待处理',waiting:'等待中',awaiting_audit:'待验收'};
const MODELS=['Sol6','Astra','DeepSeek','DeepSeek-high','Sol 6.1','DeepSeek Flash'];
const METHODS=['B1','B2','B3','V0'];
const DASH={Sol6:'',Astra:'7 4',DeepSeek:'2 4','DeepSeek-high':'9 3 2 3','Sol 6.1':'','DeepSeek Flash':'2 4'};
let manifest,data,cache=new Map(),visible=new Set(),datasetId=new URL(location).searchParams.get('dataset')||'GQA',mode='best',activeSamples=null,loadSeq=0,needsReload=false;
let focusedRun=null,initialRun=new URL(location).searchParams.get('run');
let eventLimit=12;
function requestedBVEdition(){return 'all';}
let bvEdition=requestedBVEdition();
function methodLabel(run){const label=run?.method_version||run?.method||'';return /^B[0-3]$/.test(label)?label+'-r1':label==='V0'?'V0-r2':label;}
function isComparison(scope=category){return ['aligned','all','all-with-b01'].includes(scope);}
function comparisonHasB(scope){return scope==='all'||scope==='all-with-b01';}
function showBVRun(run,scope){return scope==='all-with-b01'||!['B0','B1'].includes(run.method);}
function runCategory(run){if(['B0','B1'].includes(run?.method))return 'all-with-b01';return run?.method==='KL'||run?.category==='kl'?'kl':run?.method==='V0'||/^V0-r/.test(run?.method_version||'')?'aligned':'bv';}
function runById(id){return [...(manifest?.running_runs||[]),...(manifest?.bv_revisions?.runs||[]),...(manifest?.campaign_runs||[])].find(r=>r.id===id);}
function openRun(dataset,id,push=true){const r=runById(id);return isComparison(runCategory(r))?loadAligned(dataset,id,runCategory(r),push):loadDataset(dataset,true,id,push);}
function seriesDash(run){return run?.edition?(run.method==='V0'?'10 3 2 3':'4 3'):(DASH[run?.model]||'');}
function roundBudget(){return Math.max(30,...(data?selected():[]).flatMap(r=>(r.search||[]).map(p=>p.round)));}
function editionKey(dataset){return dataset.id+':'+(dataset.edition||'legacy');}

let category=["kl","aligned","all","all-with-b01"].includes(new URL(location).searchParams.get("category"))?new URL(location).searchParams.get("category"):"bv";
function requestedAxis() {
 const axis=new URL(location).searchParams.get('axis');
 return ['time','tokens'].includes(axis)?axis:'round';
}
let axisMode=requestedAxis();
const axisVisibility=new Map();
let costRange=null;
function axisText() { return axisMode==='time'?'累计时间（分钟）':'累计 token（百万）'; }
function costX(axes) {
 if (!axes) return null;
 const value=axisMode==='time'?axes.elapsed_s:axes.tokens;return Number.isFinite(value)?value/(axisMode==='time'?60:1e6):null;
}
function partial(axes) { return axisMode==='tokens' && axes?.tokens_complete===false; }
function costDetail(point) {
 const a=point.axes;
 if (!a) return '';
 const values=[(Number.isFinite(a.elapsed_s)?fmt(a.elapsed_s/60,2):'—')+' 分钟',(Number.isFinite(a.tokens)?a.tokens.toLocaleString('en-US'):'—')+' token'];
 if (partial(a)) values.push('△ token 不完整'+(a.missing_responses?' · 缺 '+a.missing_responses+' 条回执':'')+(a.disputed?' · Apply 6 计数不一致':''));
 return values.join(' · ');
}
function axisControls() {
 for(const button of $$('[data-axis]')) {
  const on=button.dataset.axis===axisMode;
  button.classList.toggle('selected',on);
  button.setAttribute('aria-pressed',String(on));
 }
 $('#partial-key').hidden=axisMode!=='tokens'||(category==='bv'&&!data?.runs.some(r=>r.search.some(p=>p.axes?.tokens_complete===false))); 
}
function defaultRuns(dataset,axis) {
 const key=editionKey(dataset)+':'+(axis==='round'?'round':'cost');
 return new Set(axisVisibility.get(key) || dataset.runs.filter(r=>axis==='round'?r.model==='Astra'&&usable(r):r.method!=='B0'&&r.search.some(p=>p.axes)).map(r=>r.id));
}
function changeAxis(next) {
 if (!['round','time','tokens'].includes(next)) return;
 if (data) axisVisibility.set(editionKey(data)+':'+(axisMode==='round'?'round':'cost'),new Set(visible));
 axisMode=next;costRange=null;
 if(data) visible=defaultRuns(data,next);
 const url=new URL(location);
 if(next==='round')url.searchParams.delete('axis');else url.searchParams.set('axis',next);
 history.replaceState(null,'',url);
 axisControls();
 if(category==='kl')renderKL();
 else if(isComparison())renderAligned('#aligned-content',alignedDataset,alignedRun);
 else if(data){syncRange();renderAll();}
}
const state={xmin:1,xmax:30,ymin:null,ymax:null,ymode:'focus',uncertainty:false};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,n=6)=>v==null?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:n,minimumFractionDigits:Math.min(3,n)});
function date(v,short=false){if(!v)return '—';return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit',...(short?{}:{hour:'2-digit',minute:'2-digit',hour12:false})}).format(new Date(v));}
function badge(s){return `<span class="badge ${esc(s)}">${esc(LABELS[s]||s)}</span>`;}
function selected(){return data.runs.filter(r=>visible.has(r.id)&&r.method!=='B0');}
function usable(r){return r.method!=='B0'&&(axisMode==='round'?(r.search.length>0||r.formal):r.search.some(p=>p.axes));}
function value(p){return p.timing?.mean_ms??null;}
function candidates(r){return r.search.filter(p=>p.timing&&p.role==='candidate');}
function series(r){
 let best=null;
 return r.search.map(p=>{if(p.timing)best=best==null?value(p):Math.min(best,value(p));return {...p,y:mode==='best'?best:value(p)};});
}
function showNotice(s){$('#notice').hidden=!s;$('#notice').textContent=s;}
function getJSON(url){const base=document.body.dataset.apiBase;const target=base?new URL(url,new URL(base,location.href)).href:url;if(pendingJSON.has(target))return pendingJSON.get(target);const request=fetch(target,{cache:'no-cache'}).then(response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json();}).finally(()=>pendingJSON.delete(target));pendingJSON.set(target,request);return request;}

// The UI follows intent immediately; network completion may only fill that intent.
let resultRequest=null;
const pendingJSON=new Map();
function beginResultRequest(scope,id,focusRun=null,push=false){
 const token={scope,id};resultRequest=token;
 const url=new URL(location);url.searchParams.set('category',scope);url.searchParams.set('dataset',id);url.searchParams.delete('apply');url.searchParams.delete('edition');
 if(focusRun)url.searchParams.set('run',focusRun);else url.searchParams.delete('run');
 if(focusRun)url.hash='';history[push?'pushState':'replaceState'](null,'',url);
 renderNav();
 for(const p of $$('#bv-panel,#kl-panel,#aligned-panel')){p.classList.remove('result-loading','result-load-error');p.removeAttribute('aria-busy');p.querySelector(':scope>.result-load-state')?.remove();}
 const panel=$(scope==='bv'?'#bv-panel':scope==='kl'?'#kl-panel':'#aligned-panel');
 panel.classList.add('result-loading');panel.setAttribute('aria-busy','true');
 const status=document.createElement('div');status.className='result-load-state';status.setAttribute('role','status');status.innerHTML='<span class="result-spinner" aria-hidden="true"></span><span>加载中…</span>';panel.append(status);
 if(focusRun)window.scrollTo({top:0,left:0,behavior:'instant'});
 return token;
}
function finishResultRequest(token,error=null){
 if(resultRequest!==token)return;resultRequest=null;
 const panel=$(token.scope==='bv'?'#bv-panel':token.scope==='kl'?'#kl-panel':'#aligned-panel');
 panel.classList.remove('result-loading');panel.removeAttribute('aria-busy');
 panel.querySelector(':scope>.result-load-state')?.remove();
 if(error){panel.classList.add('result-load-error');const el=document.createElement('div');el.className='result-load-state';el.setAttribute('role','alert');el.innerHTML='<span>数据暂未加载</span><button type="button">重试</button>';el.querySelector('button').onclick=()=>chooseCategory(token.scope);panel.append(el);}
}
function datasetJSON(meta,version=manifest.updated_at){
 const saved=cache.get(meta.id);if(saved?.updated_at===version)return Promise.resolve(saved);
 return getJSON(`./api/v1/${meta.url}?v=${encodeURIComponent(version)}`).then(d=>{if(d.updated_at!==version)throw Error('发布版本尚在同步');if(manifest.updated_at===version)cache.set(meta.id,d);return d;});
}
function publishedKL(version=manifest.updated_at){return klData?.updated_at===version?Promise.resolve(klData):getJSON(`./api/v1/${manifest.kl.url}?v=${encodeURIComponent(version)}`);}
const MODEL_COLORS={'Sol6':'#ed6400','Astra':'#0071e3','DeepSeek':'#7956c9','DeepSeek-high':'#d9398c','Sol 6.1':'#009b68','DeepSeek Flash':'#b87a00'};
const REVISION_COLORS={'B1-r2':'#0086b3','B2-r2':'#e63d37','B3-r2':'#784be7','V0-r3':'#0071e3'};
const REVISION_MODEL_COLORS={'Sol6':'#df3547','Astra':'#784be7','DeepSeek':'#bd38d1','DeepSeek-high':'#d54e30','Sol 6.1':'#009ca8','DeepSeek Flash':'#8d9500'};
function comparisonColor(run,scope=category){
 const revised=['bv','aligned'].includes(scope)&&Object.hasOwn(REVISION_COLORS,methodLabel(run));
 if(comparisonGroupMode(scope)==='task')return (revised?REVISION_MODEL_COLORS[run.model]:MODEL_COLORS[run.model])||'#526c89';
 return (revised?REVISION_COLORS[methodLabel(run)]:COLORS[run.baseMethod||run.method])||(['KL','Aligned KL'].includes(run.baseMethod||run.method)?'#e69a00':'#526c89');
}
function resetBVView(){
 roundWindows.delete('bv:'+datasetId);clearLatencyWindows('bv');costRange=null;Object.assign(state,{xmin:1,xmax:roundBudget(),ymode:'focus',ymin:null,ymax:null});syncRange();showNotice('');renderCharts();
}
function chartResetButton(chart,key,action){
 const parent=chart.closest('.chart-card')?.querySelector('.chart-title')||chart.parentElement.querySelector('.plot-options');if(!parent)return;
 let button=parent.querySelector('[data-chart-reset="'+key+'"]');
 if(!button){button=document.createElement('button');button.type='button';button.dataset.chartReset=key;button.className='chart-reset';button.textContent='↻';button.title='重置视图';button.setAttribute('aria-label','重置视图');parent.append(button);}
 button.onclick=()=>{action();button.animate?.([{transform:'rotate(0)'},{transform:'rotate(360deg)'}],{duration:320,easing:'ease-out'});};
}
function datasetHasResults(id){
 if(category==='kl'&&klData){const rows=klData.runs.filter(r=>r.dataset===id&&(!klRun||r.model===klRun.model));return rows.some(r=>r.applies.some(a=>a.delivered?.accepted||(a.candidates||[]).length));}
 const d=cache.get(id);if(!d)return null;
 const hasBV=d.runs.some(r=>r.method!=='B0'&&showBVRun(r,category)&&(category!=='aligned'||r.method==='V0')&&r.search.length);
 return hasBV||(isComparison()&&klData?.runs.some(r=>r.dataset===id&&(r.aligned?.points||[]).some(p=>p.counted)))||false;
}



const roundWindows=new Map(),latencyWindows=new Map();let rangeDragging=false,rangeRenderFrame=null;
function latencyKey(chart,scope,dataset=datasetId){return scope+':'+dataset+':'+(chart.id||'plot');}
function clearLatencyWindows(scope,dataset=datasetId){const prefix=scope+':'+dataset+':';for(const key of latencyWindows.keys())if(key.startsWith(prefix))latencyWindows.delete(key);}
function latencyWindow(chart,scope,automatic){return latencyWindows.get(latencyKey(chart,scope))||automatic;}
function comparisonWindow(scope,maximum){
 const max=Math.max(1,Math.ceil(maximum)),custom=roundWindows.get(scope+':'+datasetId);
 const hi=custom?Math.max(1,Math.min(max,custom[1])):max;
 return [custom?Math.max(0,Math.min(hi-1,custom[0])):0,hi];
}
function renderRoundRange(chart,scope,maximum,redraw){
 let box=chart._rangeBox;
 if(!box?.isConnected){box=document.createElement('div');box.className='comparison-range';chart._rangeBox=box;const title=chart.closest('.chart-card')?.querySelector('.chart-title');if(title)title.append(box);else chart.before(box);}
 box.hidden=axisMode!=='round';if(box.hidden)return;
 const key=scope+':'+datasetId,max=Math.max(1,Math.ceil(maximum)),range=comparisonWindow(scope,max);
 if(!box.querySelector('input'))box.innerHTML='<output data-range-value="0" aria-label="起始轮次"></output><div class="range-track"><span class="range-selected"></span><input type="range" data-range-bound="0" aria-label="起始轮次" min="0" step="1"><input type="range" data-range-bound="1" aria-label="截止轮次" min="0" step="1"></div><output data-range-value="1" aria-label="截止轮次"></output>';
 box.title='拖动调整轮次范围；双击恢复自动范围';
 box.dataset.rangeKey=key;
 const inputs=[...box.querySelectorAll('input')];
 inputs.forEach((input,i)=>{
  input.max=String(max);input.value=String(range[i]);input.setAttribute('aria-valuetext','r'+range[i]);
  box.querySelector(`[data-range-value="${i}"]`).textContent=range[i];
  input.onpointerdown=()=>{rangeDragging=true;};
  input.oninput=()=>{
   clearLatencyWindows(scope);
   const next=comparisonWindow(scope,max),value=Number(input.value);
   next[i]=i?Math.max(next[0]+1,value):Math.min(next[1]-1,value);if(next[0]===0&&next[1]===max)roundWindows.delete(key);else roundWindows.set(key,next);
   input.value=String(next[i]);box.querySelector(`[data-range-value="${i}"]`).textContent=next[i];
   box.style.setProperty('--range-start',next[0]/max*100+'%');box.style.setProperty('--range-end',next[1]/max*100+'%');
   if(rangeRenderFrame!==null)cancelAnimationFrame(rangeRenderFrame);
   rangeRenderFrame=requestAnimationFrame(()=>{rangeRenderFrame=null;redraw();});
  };
 });
 box.style.setProperty('--range-start',range[0]/max*100+'%');box.style.setProperty('--range-end',range[1]/max*100+'%');
 box.ondblclick=()=>{roundWindows.delete(key);clearLatencyWindows(scope);redraw();};
}
window.addEventListener('pointerup',()=>{rangeDragging=false;});
window.addEventListener('pointercancel',()=>{rangeDragging=false;});

// Plot selection and the dual slider share round bounds; latency belongs to this chart.
function configureRoundBrush(chart,config){
 let brush=chart._roundBrush;
 if(!brush){
  brush=chart._roundBrush={config:null,drag:null,suppressClickUntil:0};
  const cancel=()=>{
   const drag=brush.drag;brush.drag=null;chart.classList.remove('range-brushing');drag?.overlay?.remove();
   if(drag&&chart.hasPointerCapture?.(drag.id))chart.releasePointerCapture(drag.id);
  };
  brush.cancel=cancel;
  const point=e=>{
   const rect=chart.getBoundingClientRect(),c=brush.config;
   return {x:(e.clientX-rect.left)*c.width/rect.width,y:(e.clientY-rect.top)*c.height/rect.height};
  };
  const selection=e=>{
   const c=brush.config,d=brush.drag,p=point(e),clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
   // Eight screen pixels tolerate hand jitter while allowing either axis on its own.
   const useX=Math.abs(e.clientX-d.startClientX)>=8,useY=Math.abs(e.clientY-d.startClientY)>=8;
   const left=useX?clamp(Math.min(d.x,p.x),c.left,c.right):c.left,right=useX?clamp(Math.max(d.x,p.x),c.left,c.right):c.right;
   const top=useY?clamp(Math.min(d.y,p.y),c.top,c.bottom):c.top,bottom=useY?clamp(Math.max(d.y,p.y),c.top,c.bottom):c.bottom;
   const round=x=>c.min+(x-c.left)/(c.right-c.left)*(c.max-c.min);
   const lo=clamp(Math.floor(round(left)),c.min,c.max-1),hi=clamp(Math.ceil(round(right)),lo+1,c.max);
   const latency=y=>c.ymax-(y-c.top)/(c.bottom-c.top)*(c.ymax-c.ymin);
   return {useX,useY,left,right,top,bottom,rounds:[lo,hi],latencies:[latency(bottom),latency(top)]};
  };
  chart.addEventListener('pointerdown',e=>{
   const c=brush.config;if(!c||e.button!==0||e.isPrimary===false||e.target.closest('button,input,a'))return;
   const p=point(e);if(p.x<c.left||p.x>c.right||p.y<c.top||p.y>c.bottom)return;
   cancel();brush.drag={id:e.pointerId,x:p.x,y:p.y,startClientX:e.clientX,startClientY:e.clientY,active:false};
   chart.setPointerCapture(e.pointerId);e.preventDefault();
  },true);
  chart.addEventListener('pointermove',e=>{
   const d=brush.drag;if(!d||d.id!==e.pointerId)return;
   const c=brush.config,s=selection(e);if(!d.active&&!s.useX&&!s.useY)return;
   if(!d.active){
    d.active=true;chart.classList.add('range-brushing');chart.querySelector('.crosshair')?.setAttribute('visibility','hidden');
    d.overlay=document.createElement('div');d.overlay.className='chart-range-brush';d.overlay.setAttribute('aria-hidden','true');
    d.overlay.innerHTML='<span class="chart-range-brush-value"></span>';chart.append(d.overlay);
   }
   Object.assign(d.overlay.style,{left:s.left/c.width*100+'%',width:(s.right-s.left)/c.width*100+'%',top:s.top/c.height*100+'%',height:(s.bottom-s.top)/c.height*100+'%'});
   const label=d.overlay.firstChild;
   label.textContent=[s.useX?'r'+s.rounds.join(' – r'):'',s.useY?s.latencies.map(tickFmt).join(' – ')+' ms':''].filter(Boolean).join(' · ');
   // Keep the concise hint inside the plot even for a narrow selection at its edge.
   const rect=chart.getBoundingClientRect(),px=rect.width/c.width,center=(s.left+s.right)/2;
   const half=label.getBoundingClientRect().width/(2*px),anchor=Math.max(c.left+half+4,Math.min(c.right-half-4,center));
   label.style.left=(anchor-s.left)*px+'px';label.style.top=(Math.min(s.top+7,c.bottom-34)-s.top)*rect.height/c.height+'px';
   e.preventDefault();e.stopImmediatePropagation();
  },true);
  window.addEventListener('pointerup',e=>{
   const d=brush.drag;if(!d||d.id!==e.pointerId)return;
   const c=brush.config,s=d.active?selection(e):null;cancel();
   if(!s||(!s.useX&&!s.useY))return;
   brush.suppressClickUntil=performance.now()+400;
   const key=c.scope+':'+c.dataset;
   if(s.useX){
    if(s.rounds[0]===0&&s.rounds[1]===Math.ceil(c.maximum))roundWindows.delete(key);else roundWindows.set(key,s.rounds);
    // Pure horizontal selection keeps the original automatic vertical fitting behavior.
    if(!s.useY)clearLatencyWindows(c.scope,c.dataset);
   }
   if(s.useY&&s.latencies[1]>s.latencies[0])latencyWindows.set(latencyKey(chart,c.scope,c.dataset),s.latencies);
   rangeDragging=false;e.preventDefault();e.stopImmediatePropagation();c.redraw();
  },true);
  chart.addEventListener('click',e=>{if(performance.now()<brush.suppressClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
  chart.addEventListener('pointercancel',cancel);chart.addEventListener('lostpointercapture',cancel);
  window.addEventListener('blur',cancel);
  chart.addEventListener('keydown',e=>{if(e.key==='Escape'&&brush.drag){cancel();e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&brush.drag)cancel();});
 }
 brush.cancel();brush.config=config?{...config,dataset:datasetId}:null;
 chart.classList.toggle('round-brush-enabled',!!config);
}

// Reconcile chart nodes instead of replacing the axes with each curve toggle.
const chartTransitions=new WeakMap(),chartExits=new WeakMap();
const chartNumbers=/-?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi;
function chartTween(from,to){
 if(from==null||from===to)return null;
 const a=from.match(chartNumbers),z=to.match(chartNumbers);
 if(!a||!z||a.length!==z.length||from.replace(chartNumbers,'#')!==to.replace(chartNumbers,'#'))return null;
 const start=a.map(Number),end=z.map(Number);return t=>{let i=0;return to.replace(chartNumbers,()=>String(start[i]+(end[i]-start[i++])*t));};
}
function chartNodeKey(el,index){
 if(el.nodeType!==1)return '#'+index;
 for(const name of ['data-chart-key','data-comparison-series','data-run','data-aligned-curve','data-reference','data-real-round','data-failed-round','data-cost-point','clip-path','id'])if(el.hasAttribute(name))return el.tagName+':'+name+':'+el.getAttribute(name);
 if(el.tagName.toLowerCase()==='text')return 'text:'+el.getAttribute('text-anchor')+':'+el.getAttribute('class')+':'+el.textContent;
 return el.tagName+':'+index;
}
function chartCurvePaths(el){return el.matches?.('path[data-run],path[data-aligned-curve]')?[el]:[...el.querySelectorAll?.('path[data-run],path[data-aligned-curve]')||[]];}
const chartPulseEffects=new WeakMap();
function chartPulse(el,leaving=false,delay=0){
 if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return null;
 const paths=chartCurvePaths(el);if(!paths.length)return null;
 const animations=[],cleanups=[];
 for(const p of paths){
  chartPulseEffects.get(p)?.();
  const length=p.getTotalLength?.();if(!length)continue;
  const effects=[],lights=[];
  const cleanup=()=>{effects.forEach(a=>a.cancel());lights.forEach(light=>light.remove());delete p.dataset.chartEntering;if(chartPulseEffects.get(p)===cleanup)chartPulseEffects.delete(p);};
  chartPulseEffects.set(p,cleanup);cleanups.push(cleanup);
  p.dataset.chartEntering='true';
  const anim=p.animate([{strokeDasharray:`${length} ${length}`,strokeDashoffset:leaving?0:length,opacity:1},{strokeDasharray:`${length} ${length}`,strokeDashoffset:leaving?-length:0,opacity:leaving?0:1}],{duration:leaving?260:340,easing:'cubic-bezier(.16,.75,.22,1)',delay,fill:leaving?'both':'backwards'});
  anim.onfinish=()=>delete p.dataset.chartEntering;animations.push(anim);effects.push(anim);
  for(const [tail,width,opacity] of [[110,6,.18],[50,4,.4],[8,2.5,.95]]){
   const light=p.cloneNode(false);for(const attr of [...light.attributes])if(attr.name==='class'||attr.name==='style'||attr.name.startsWith('data-'))light.removeAttribute(attr.name);
   light.dataset.chartPulse='';light._curveSource=p;light.setAttribute('pathLength','1000');light.setAttribute('stroke-dasharray',`${tail} 2200`);light.setAttribute('stroke-width',width);light.setAttribute('stroke-linecap','round');light.setAttribute('fill','none');light.setAttribute('aria-hidden','true');light.style.pointerEvents='none';
   light.style.stroke=`color-mix(in srgb, ${p.getAttribute('stroke')} 65%, white)`;p.parentNode.append(light);lights.push(light);
   const pulse=light.animate([{strokeDashoffset:tail,opacity},{strokeDashoffset:tail-1050,opacity:0}],{duration:leaving?260:340,delay,easing:'cubic-bezier(.16,.75,.22,1)',fill:'both'});pulse.onfinish=()=>light.remove();animations.push(pulse);effects.push(pulse);
  }
 }
 if(el.tagName.toLowerCase()==='g')animations.push(el.animate([{opacity:leaving?1:.25},{opacity:leaving?0:1}],{duration:260,easing:'ease-out',fill:leaving?'forwards':'none'}));
 animations.cleanup=()=>{cleanups.forEach(cleanup=>cleanup());animations.forEach(a=>a.cancel());};
 return animations;
}
function renderChartMarkup(el,markup){
 const template=document.createElement('template');template.innerHTML=markup;
 const fresh=template.content.querySelector('svg'),old=el.querySelector(':scope>svg');
 const context=[category,datasetId,axisMode].join(':');
 if(!fresh||!old||el.dataset.chartContext!==context){
  el.innerHTML=markup;el.dataset.chartContext=context;
  const svg=el.querySelector('svg');if(svg&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
   [...svg.children].filter(n=>['line','text'].includes(n.tagName.toLowerCase())).forEach(n=>n.animate([{opacity:0},{opacity:1}],{duration:160,easing:'ease-out'}));
   chartPulse(svg,false,90);
  }return;
 }
 const previous=chartTransitions.get(old);if(previous)cancelAnimationFrame(previous);
 const changes=[],entered=[];
 function sync(parent,next){
  const previousNodes=[...parent.childNodes].filter(n=>!n.hasAttribute?.('data-beta-glint')&&!n.hasAttribute?.('data-chart-pulse'));
  const byKey=new Map(previousNodes.map((n,i)=>[chartNodeKey(n,i),n]));const used=new Set();let cursor=parent.firstChild;
  [...next.childNodes].forEach((n,i)=>{
   const key=chartNodeKey(n,i);let current=byKey.get(key);if(used.has(current))current=null;
   if(!current||current.nodeType!==n.nodeType||current.nodeName!==n.nodeName){current=n.cloneNode(true);parent.insertBefore(current,cursor);entered.push(current);}
   else{
    const exiting=chartExits.get(current);if(exiting){clearTimeout(exiting.timer);exiting.animations?.cleanup?.();chartExits.delete(current);entered.push(current);}
    if(current.nodeType===1){
     for(const attr of [...current.attributes])if(!n.hasAttribute(attr.name)&&!['data-chart-entering','style','class'].includes(attr.name))current.removeAttribute(attr.name);
     for(const attr of [...n.attributes])if(current.getAttribute(attr.name)!==attr.value){
      const tween=['d','x','y','x1','x2','y1','y2','cx','cy','width','height','transform'].includes(attr.name)?chartTween(current.getAttribute(attr.name),attr.value):null;
      if(tween)changes.push({node:current,name:attr.name,tween,end:attr.value});else current.setAttribute(attr.name,attr.value);
     }
     sync(current,n);
    }else if(current.nodeValue!==n.nodeValue)current.nodeValue=n.nodeValue;
    if(current!==cursor)parent.insertBefore(current,cursor);
   }
   used.add(current);cursor=current.nextSibling;
  });
  for(const n of previousNodes)if(!used.has(n)&&!chartExits.has(n)){
   const animations=chartPulse(n,true);
   if(animations?.length){const timer=setTimeout(()=>{n.remove();animations.cleanup?.();chartExits.delete(n);},270);chartExits.set(n,{timer,animations});}
   else n.remove();
  }
 }
 for(const attr of [...fresh.attributes])if(old.getAttribute(attr.name)!==attr.value)old.setAttribute(attr.name,attr.value);
 sync(old,fresh);
 for(const n of [...el.children])if(n!==old)n.remove();
 for(const n of [...template.content.children])if(n!==fresh)el.append(n);
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const start=performance.now(),duration=rangeDragging?80:340;
 function frame(now){
  const t=reduced?1:Math.min(1,(now-start)/duration),ease=1-Math.pow(1-t,3);
  for(const c of changes)if(c.node.isConnected)c.node.setAttribute(c.name,t===1?c.end:c.tween(ease));
  old.querySelectorAll('[data-beta-glint],[data-chart-pulse]').forEach(light=>{if(light._curveSource)for(const name of ['d','x1','x2','y1','y2']){const value=light._curveSource.getAttribute(name);if(value!==null)light.setAttribute(name,value);}});
  if(t<1)chartTransitions.set(old,requestAnimationFrame(frame));else chartTransitions.delete(old);
 }
 if(changes.length)frame(start);
 // Draw immediately in the same event; do not wait for the axis transition.
 for(const n of entered)if(n.isConnected)chartPulse(n);
}

function renderNextUpdate(){
 const next=manifest?.next_update_estimated_at,el=$('#next-update');
 el.textContent=next?`预计下次更新 ${date(next)} SGT${Date.now()>Date.parse(next)?' · 等待更新':''}`:'预计下次更新 —';
 el.title=next?`按 ${manifest.update_cadence_minutes} 分钟监督周期估算；实际以源快照发布时间为准。`:'';
}
async function refresh(force=false){
 $('#refresh').disabled=true;
 try{
  const m=await getJSON(`./api/v1/index.json?t=${Date.now()}`);
  if(m.schema_version!==1)throw Error('不支持的数据版本');
  if(m.frontend_version&&FRONTEND_VERSION&&m.frontend_version!==FRONTEND_VERSION){
   const url=new URL(location);
   if(url.searchParams.get('ui_version')!==m.frontend_version){url.searchParams.set('ui_version',m.frontend_version);location.replace(url.href);return;}
   throw Error('页面版本正在同步，请稍后刷新');
  }
  const changed=!manifest||m.updated_at!==manifest.updated_at;
  manifest=m;renderNextUpdate();renderTaskEvents();if(!data){$('#updated').textContent=date(m.updated_at);$('#updated').dateTime=m.updated_at;}
  $('#connection').classList.remove('stale');showNotice('');
  if(changed||force||needsReload){cache.clear();renderNav();renderRunning();if(category==="bv"&&initialRun&&runCategory(runById(initialRun))==='aligned')setCategory('aligned');if(category==="kl")await loadKL(datasetId);else if(isComparison())await loadAligned(datasetId,initialRun,category);else await loadDataset(datasetId,!data||data.id!==datasetId,initialRun);if(!needsReload)initialRun=null;}
 }catch(e){$('#connection').classList.add('stale');showNotice(`更新暂不可用${data?'，保留上次数据':''} · ${e.message}`);}
 finally{$('#refresh').disabled=false;}
}
function renderNav(){
 if($('#datasets').dataset.items!==manifest.datasets.map(d=>d.id).join('|')){$('#datasets').dataset.items=manifest.datasets.map(d=>d.id).join('|');$('#datasets').innerHTML=manifest.datasets.map(d=>`<button type="button" data-dataset="${esc(d.id)}" aria-current="${d.id===datasetId}">${esc(d.id)}</button>`).join('');}
 $$('[data-dataset]').forEach(b=>{b.setAttribute('aria-current',String(b.dataset.dataset===datasetId));const empty=datasetHasResults(b.dataset.dataset)===false;b.classList.toggle('no-results',empty);b.title=empty?'尚无评测结果 · 可查看等待状态':'';});
 $$('[data-dataset]').forEach(b=>b.onclick=()=>category==="kl"?loadKL(b.dataset.dataset):isComparison()?loadAligned(b.dataset.dataset,null,category):loadDataset(b.dataset.dataset,true));
}
function renderRunning(){
 const runs=[...(manifest.running_runs||[]),...(manifest.kl?.running_runs||[])];
 $('#running-count').textContent=`${runs.length} 组`;
 $('#running-links').innerHTML=runs.map(r=>{
  const href=`?${new URLSearchParams({dataset:r.dataset,run:r.id,category:runCategory(r)})}`;
 const phase={reviewing:'审查中',evaluating:'评测中',profiling:'测量中',ready:'运行中',initializing:'准备中',finished:'收尾中',queued:'排队中'}[r.phase]||'运行中';
  return `<a class="running-link ${focusedRun===r.id?'current':''}" href="${esc(href)}" data-category-target="${runCategory(r)}" data-running="${esc(r.id)}" data-target="${esc(r.dataset)}" style="--color:${COLORS[r.method]||'#526c89'}" title="${esc(r.model+' / '+r.effort)} · 已记录 ${r.reported_attempts}/${r.budget} 轮；待审查记录不代表独立完成"><span class="swatch"></span><strong>${esc(r.dataset)} · ${esc(r.model)} ${esc(methodLabel(r))}</strong><span class="running-round">${r.category==='kl'?(r.current_apply??r.reported_attempts):r.reported_attempts}<span> / ${r.budget} ${r.category==='kl'?'Apply · r'+(r.internal_round??0):'轮'}</span></span><span class="running-phase">${phase}</span><span aria-hidden="true">↗</span></a>`;
 }).join('')||'<span class="running-empty">当前没有运行中的实验，各组状态见下方</span>';
 const waiting=manifest.waiting_runs||manifest.kl?.waiting_runs||[];
 const cards=manifest.waiting_cards||manifest.kl?.waiting_cards||[];
 const scrollPositions=new Map($$('#waiting-links .waiting-list').map(el=>[el.dataset.card,el.scrollTop]));
 $('#waiting-bar').hidden=!cards.length;
 $('#waiting-count').textContent=`${waiting.length} 组`;
 $('#waiting-links').innerHTML=cards.map(card=>`<section class="waiting-card" aria-labelledby="waiting-${esc(card.id)}"><div class="waiting-card-heading"><strong id="waiting-${esc(card.id)}">${esc(card.label)}</strong><span class="waiting-environment">${esc(card.environment_name)}</span><span class="waiting-card-count">${card.runs.length} 组</span></div><ol class="waiting-list" data-card="${esc(card.id)}" tabindex="0" aria-label="${esc(card.label)}等待队列，按执行顺序">${card.runs.map(r=>`<li><a class="running-link waiting-link" href="?category=${runCategory(r)}&dataset=${esc(r.dataset)}&run=${esc(r.id)}" data-category-target="${runCategory(r)}" data-running="${esc(r.id)}" data-target="${esc(r.dataset)}"><span class="waiting-position" title="原队列第 ${r.queue_position} 项">${r.queue_position}</span><span class="waiting-task"><strong>${esc(r.dataset)} · ${esc(r.model)} ${esc(methodLabel(r))}</strong><span>${r.reported_attempts} / ${r.budget} ${r.method==='KL'?'Apply':'轮'}</span></span><span aria-hidden="true">↗</span></a></li>`).join('')||'<li class="waiting-empty">暂无等待任务</li>'}</ol></section>`).join('');
 $$('#waiting-links .waiting-list').forEach(el=>{el.scrollTop=scrollPositions.get(el.dataset.card)||0;});
 const campaign=manifest.campaign_runs||[];
 $('#campaign-status').innerHTML=campaign.map(r=>{
  const label=r.status==='complete'?'已完成':r.status==='paused'||r.status==='blocked'?'已暂停':r.status==='running'?'运行中':'未开始';
  return `<a href="?category=${runCategory(r)}&dataset=${esc(r.dataset)}&run=${esc(r.id)}" data-campaign-run="${esc(r.id)}" data-target="${esc(r.dataset)}">${esc(r.dataset)} ${esc(methodLabel(r))} <strong>${r.reported_attempts}/${r.budget}</strong><span>${label}</span></a>`;
 }).join('');
 $$('[data-campaign-run]').forEach(a=>a.onclick=e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();return openRun(a.dataset.target,a.dataset.campaignRun,true);});
 $$('[data-running]').forEach(a=>a.onclick=e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();if(a.dataset.categoryTarget==='kl'){return loadKL(a.dataset.target,a.dataset.running);}else return openRun(a.dataset.target,a.dataset.running,true);});
}
async function loadDataset(id,reset,focusRun=null,push=false){
 bvEdition='all';
 reset=reset||data?.edition!==bvEdition;
 setCategory("bv");++klSequence;++alignedSequence;
 const seq=++loadSeq;const meta=manifest.datasets.find(d=>d.id===id)||manifest.datasets[0];datasetId=meta.id;
 const request=beginResultRequest('bv',meta.id,focusRun,push);
 try{
  const d=await datasetJSON(meta);
  if(seq!==loadSeq||category!=='bv')return;
  if(d.updated_at!==manifest.updated_at)throw Error('发布版本尚在同步');
  cache.set(meta.id,d);data={...d,edition:bvEdition,runs:d.runs.filter(r=>showBVRun(r,'bv'))};needsReload=false;
  $('#updated').textContent=date(d.updated_at);$('#updated').dateTime=d.updated_at;
  if(reset){visible=defaultRuns(data,axisMode);costRange=null;Object.assign(state,{xmin:1,xmax:roundBudget(),ymode:'focus',ymin:null,ymax:null});$('#round-run').value='all';}
  else for(const r of data.runs)if(!r.search.length&&!r.formal)visible.delete(r.id);
  if(reset)focusedRun=null;
  const target=focusRun&&data.runs.find(r=>r.id===focusRun);
  if(target){focusedRun=target.id;if(usable(target))visible.add(target.id);Object.assign(state,{xmin:1,xmax:roundBudget(),ymode:'focus',ymin:null,ymax:null});}
  const url=new URL(location);url.searchParams.delete('edition');url.searchParams.set('dataset',meta.id);url.searchParams.set('category','bv');url.searchParams.delete('apply');
  if(focusedRun)url.searchParams.set('run',focusedRun);else url.searchParams.delete('run');
  if(target)url.hash='';
  history.replaceState(null,'',url);renderNav();renderRunning();
  $('#dataset-name').textContent=data.title;$('#workload').textContent=data.workload;
  syncRange();renderAll();showNotice('');finishResultRequest(request);
  if(target)window.scrollTo({top:0,left:0,behavior:'instant'});
 }catch(e){if(seq===loadSeq){finishResultRequest(request,e);needsReload=true;$('#connection').classList.add('stale');showNotice(`数据读取失败，保留上次快照 · ${e.message}`);}}
}
function toggle(id,on){on?visible.add(id):visible.delete(id);renderAll();}
function toggleModel(model,on){data.runs.filter(r=>r.model===model&&usable(r)).forEach(r=>on?visible.add(r.id):visible.delete(r.id));renderAll();}
// Display grouping is independent of curve visibility, axes and comparison scope.
const comparisonGrouping=new Map();
function comparisonGroupMode(scope=category){return comparisonGrouping.get(scope)||'model';}
function bvControlSeries(){return data.runs.filter(r=>axisMode==='round'||r.search.some(p=>p.axes)).map(r=>({...r,method:methodLabel(r),baseMethod:r.method,color:comparisonColor(r,'bv'),available:usable(r)}));}
function renderComparisonControls(host,series,chosen,scope,onChange){
 const byTask=comparisonGroupMode(scope)==='task';
 const entries=series.filter(r=>byTask||r.baseMethod!=='B0');
 const keys=[...new Set(entries.map(r=>byTask?r.method:r.model))];
 if(byTask)keys.sort((a,b)=>{const order=['B0','B1','B2','B3','V0','Aligned KL'];return order.indexOf(a.split('-r')[0])-order.indexOf(b.split('-r')[0])||a.localeCompare(b);});
 if(!byTask&&scope==='bv')keys.sort((a,b)=>MODELS.indexOf(a)-MODELS.indexOf(b));
 const groups=keys.map(key=>({key,rows:entries.filter(r=>(byTask?r.method:r.model)===key)}));
 const inputAttr=scope==='bv'?'data-series':'data-aligned-run';
 host.dataset.grouping=byTask?'task':'model';
 host.innerHTML=groups.map(({key,rows})=>{
  const available=rows.filter(r=>r.available!==false),n=available.filter(r=>chosen.has(r.id)).length,all=available.length>0&&n===available.length,mixed=n>0&&!all;
  const effort=!byTask&&new Set(rows.map(r=>r.effort)).size===1?rows[0].effort:'';
  return `<div class="model-group"><div class="model-heading"><button type="button" data-curve-group-title="${esc(key)}" aria-label="切换 ${esc(key)} 全部曲线" ${available.length?'':'disabled'}><strong>${esc(key)}</strong></button>${effort?`<span class="effort">${esc(effort)}</span>`:''}<label class="model-toggle ${mixed?'mixed':''}" title="${n}/${available.length} 条曲线已显示"><span>${available.length?(all?'全部':mixed?'部分':'关闭'):'无曲线'}</span><input type="checkbox" data-curve-group="${esc(key)}" data-group-scope="${scope}" aria-label="${esc(key)} 全部曲线" aria-checked="${mixed?'mixed':String(all)}" ${all?'checked':''} ${available.length?'':'disabled'}></label></div><div class="chips">${rows.map(r=>{
   const ok=r.available!==false,on=ok&&chosen.has(r.id),label=byTask?r.model:r.method==='Aligned KL'?'KL':r.method;
   return `<label class="chip ${on?'active':''} ${ok?'':'disabled'}" style="--color:${r.color}" title="${esc(r.baseMethod==='B0'?'正确性实验，不绘制速度曲线':r.model+' / '+r.effort+' · '+r.method+(ok?'':' · 尚无评测结果'))}"><input type="checkbox" ${inputAttr}="${esc(r.id)}" aria-label="${esc(r.model+' '+r.method+' 曲线')}" ${on?'checked':''} ${ok?'':'disabled'}>${esc(label)}${byTask?`<small>${esc(r.effort)}</small>`:''}</label>`;
  }).join('')}</div></div>`;
 }).join('');
 host.querySelectorAll('['+inputAttr+']').forEach(el=>el.onchange=()=>{const id=el.getAttribute(inputAttr);el.checked?chosen.add(id):chosen.delete(id);onChange();});
 host.querySelectorAll('[data-curve-group-title]').forEach(el=>el.onclick=()=>{const rows=groups.find(g=>g.key===el.dataset.curveGroupTitle).rows.filter(r=>r.available!==false),on=!rows.every(r=>chosen.has(r.id));for(const r of rows)on?chosen.add(r.id):chosen.delete(r.id);onChange();});
 host.querySelectorAll('[data-curve-group]').forEach(el=>{const rows=groups.find(g=>g.key===el.dataset.curveGroup).rows.filter(r=>r.available!==false);el.indeterminate=el.getAttribute('aria-checked')==='mixed';el.onchange=()=>{for(const r of rows)el.checked?chosen.add(r.id):chosen.delete(r.id);onChange();};});
}
function renderControls(){renderComparisonControls($('#series-controls'),bvControlSeries(),visible,'bv',renderAll);}
function renderTaskEvents(){
 const labels={started:'开始',resumed:'恢复',paused:'暂停',completed:'完成'},ds=$('#event-dataset').value,kind=$('#event-kind').value;
 const events=(manifest?.task_events||[]).filter(e=>(ds==='all'||e.runs.some(r=>r.dataset===ds))&&(kind==='all'||e.kind===kind));
 $('#event-count').textContent=`${events.length} 条`;
 $('#task-events').innerHTML=events.slice(0,eventLimit).map(e=>`<li class="task-event"><time datetime="${esc(e.at)}" title="${esc(e.at)}">${date(e.at)}${e.time_basis==='observed'?'<small>记录时间</small>':''}</time><span class="event-tag ${esc(e.kind)}">${labels[e.kind]||esc(e.kind)}</span><div class="event-runs">${e.runs.map(r=>`<a href="?${new URLSearchParams({dataset:r.dataset,run:r.id,category:runCategory(r)})}" data-event-run="${esc(r.id)}" data-target="${esc(r.dataset)}">${esc(r.dataset)} · ${esc(r.model)} ${esc(methodLabel(r))} ↗</a>`).join('')}</div><p>${esc(e.reason)}</p></li>`).join('')||'<li class="empty">暂无记录</li>';
 $('#events-more').hidden=eventLimit>=events.length;
 $$('[data-event-run]').forEach(a=>a.onclick=e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();loadDataset(a.dataset.target,data?.id!==a.dataset.target,a.dataset.eventRun,true);});
}
function renderSummary(){
 let previous='';
 $('#summary tbody').innerHTML=data.runs.filter(r=>r.method!=='B0').map(r=>{
  const best=r.search.find(p=>p.round===r.search_best_round),range=best?.timing?`${fmt(best.timing.p10_ms,4)}–${fmt(best.timing.p90_ms,4)}`:'—';
  const group=previous&&previous!==r.model?'group-line':'';previous=r.model;
  return `<tr class="${group}" style="--color:${comparisonColor(r,'bv')}"><td><input class="row-check" type="checkbox" data-row="${r.id}" aria-label="显示 ${r.model} ${r.method}" ${visible.has(r.id)?'checked':''} ${usable(r)?'':'disabled'}></td><td><span class="model-label">${r.model}</span><span class="effort-label">${esc(r.effort)}</span></td><td><span class="swatch"></span> ${methodLabel(r)}</td><td>${badge(r.status)}</td><td>${r.reported_attempts} / ${r.budget}</td><td class="date">${date(r.finished_at)}</td><td class="num">${fmt(r.search_best_ms)}</td><td class="num">${range}</td><td class="num">${fmt(r.formal?.mean_ms)}</td><td class="num">${r.formal&&r.formal_pytorch?fmt(r.formal_pytorch.mean_ms/r.formal.mean_ms,3)+'×':'—'}</td></tr>`;
 }).join('');
 $$('[data-row]').forEach(e=>e.onchange=()=>toggle(e.dataset.row,e.checked));
 $('#correctness tbody').innerHTML=data.runs.filter(r=>r.method==='B0').map(r=>`<tr><td>${r.model} <span class="effort-label">${esc(r.effort)}</span></td><td>${methodLabel(r)}</td><td>${badge(r.status)}</td><td>${r.reported_attempts} / ${r.budget}</td><td>${r.accepted===true?'通过':r.accepted===false?'未接受':'—'}</td><td class="date">${date(r.finished_at)}</td></tr>`).join('');
}
function roundRows(){
 const filter=$('#round-run').value,st=$('#round-status').value;
 return selected().filter(r=>filter==='all'||r.id===filter).flatMap(r=>r.search.filter(p=>st==='all'||p.status===st).map(p=>({r,p}))).sort((a,b)=>a.p.round-b.p.round||MODELS.indexOf(a.r.model)-MODELS.indexOf(b.r.model)||METHODS.indexOf(a.r.method)-METHODS.indexOf(b.r.method));
}
function renderRoundSelector(){const current=$('#round-run').value;$('#round-run').innerHTML='<option value="all">全部已选曲线</option>'+selected().map(r=>`<option value="${r.id}">${r.model} · ${methodLabel(r)}</option>`).join('');if(selected().some(r=>r.id===current))$('#round-run').value=current;}
function renderRounds(){
 const rows=roundRows();$('#round-count').textContent=`${rows.length} 条`;
 $('#rounds tbody').innerHTML=rows.map(({r,p})=>{
  const m=p.timing,status={passed:'通过',failed:'失败',excluded:'基础设施中断'}[p.status];
  return `<tr><td>${r.model}</td><td>${methodLabel(r)}</td><td>${p.round}${p.role==='b0'?' · 初始':''}</td><td>${status||'—'}</td><td class="date">${{saved:'已保存',pending:'待完成',not_required:'不适用',historical:'历史记录'}[p.review]||'—'}</td><td class="num">${fmt(m?.mean_ms)}</td><td class="num">${fmt(m?.p10_ms)}</td><td class="num">${fmt(m?.p90_ms)}</td><td class="num">${m?`<button class="sample-button" data-sample="${r.id}|${p.round}" aria-label="${r.model} ${r.method} 第 ${p.round} 轮样本">${m.sample_count}</button>`:'—'}</td><td class="num">${fmt(p.pytorch?.mean_ms)}</td><td class="num">${m&&p.pytorch?fmt(p.pytorch.mean_ms/m.mean_ms,3)+'×':'—'}</td></tr>`;
 }).join('')||'<tr><td colspan="11" class="empty">没有符合筛选条件的数据</td></tr>';
 $$('[data-sample]').forEach(b=>b.onclick=()=>{const[id,n]=b.dataset.sample.split('|'),r=data.runs.find(r=>r.id===id),p=r.search.find(p=>p.round===+n);activeSamples={r,p};$('#sample-title').textContent=`${r.model} · ${methodLabel(r)} · 第 ${n} 轮`;$('#sample-stats').textContent=`均值 ${fmt(p.timing.mean_ms)} ms · P10–P90 ${fmt(p.timing.p10_ms)}–${fmt(p.timing.p90_ms)} ms · n=${p.timing.sample_count}`;$('#sample-values').textContent=p.timing.samples_ms.map((v,i)=>`${String(i+1).padStart(3,' ')}  ${v}`).join('\n');$('#samples').showModal();});
}
function renderWorkspaces(){
 const runs=data.runs.filter(r=>r.workspace_path);
 $('#workspace-paths').innerHTML=runs.map(r=>`<div class="workspace-row"><div class="workspace-label"><strong>${esc(r.model)} · ${esc(methodLabel(r))}</strong><span>${esc(r.effort)}</span></div><code>${esc(r.workspace_path)}</code><button type="button" data-copy-workspace="${esc(r.id)}" aria-label="复制 ${esc(r.model+' '+(methodLabel(r)))} 工作区路径">复制</button></div>`).join('')||'<p class="empty">暂无已保存的工作区路径</p>';
 $$('[data-copy-workspace]').forEach(b=>b.onclick=async()=>{const r=runs.find(r=>r.id===b.dataset.copyWorkspace);try{await navigator.clipboard.writeText(r.workspace_path);b.textContent='已复制';}catch{b.textContent='请选中路径复制';}});
}
function renderAll(){if(!data)return;axisControls();renderControls();renderSummary();renderRoundSelector();renderRounds();renderWorkspaces();renderCharts();}
function ticks(lo,hi,count){
 const raw=(hi-lo)/Math.max(count,1),exp=10**Math.floor(Math.log10(raw||1)),n=raw/exp,step=(n<=1?1:n<=2?2:n<=5?5:10)*exp;
 const out=[];for(let v=Math.ceil(lo/step)*step;v<=hi+step*1e-7;v+=step)out.push(Math.abs(v)<step*1e-8?0:v);return out;
}
function tickFmt(v){if(v===0)return '0';if(Math.abs(v)>=1000)return String(+v.toFixed(0));if(Math.abs(v)>=10)return String(+v.toFixed(2));return String(+v.toFixed(5));}
function bounds(runs,detail,windowRange=[state.xmin,state.xmax]){
 const [lowRound,highRound]=windowRange;
 const measured=runs.flatMap(r=>r.search.filter(p=>p.timing&&p.round>=lowRound&&p.round<=highRound).map(p=>p.timing[state.uncertainty?'p90_ms':'mean_ms'])).concat(runs.map(r=>r.formal?.mean_ms).filter(Number.isFinite));
 if(!detail){const vals=[...measured,...runs.flatMap(r=>series(r).filter(p=>p.round>=lowRound&&p.round<=highRound&&p.y!=null).map(p=>p.y))];return [0,Math.max(...vals,1e-3)*1.06];}
 if(state.ymode==='manual'&&Number.isFinite(state.ymin)&&Number.isFinite(state.ymax)&&state.ymax>state.ymin)return [state.ymin,state.ymax];
 let values=[];
 if(state.ymode==='all'){
  runs.forEach(r=>series(r).filter(p=>p.round>=lowRound&&p.round<=highRound&&p.y!=null).forEach(p=>values.push(p.y)));
  if(state.xmax===roundBudget())runs.forEach(r=>{if(r.formal)values.push(r.formal.mean_ms);});
 }else{
  values=runs.map(r=>{const pts=series(r).filter(p=>p.y!=null&&p.round<=highRound);return pts.length?pts[pts.length-1].y:null;}).filter(Number.isFinite);
  // Zoom the lower terminal cluster, retaining at least three series where available.
  // The overview and explicit outside-range count preserve the excluded scale context.
  const sorted=values.slice().sort((a,b)=>a-b);let cut=-1;
  for(let i=Math.min(3,sorted.length-1);i<sorted.length;i++){if(i>0&&sorted[i]/sorted[i-1]>=2){cut=i;break;}}
  if(cut>0)values=sorted.slice(0,cut);
  const focused=runs.find(r=>r.id===focusedRun),terminal=focused&&series(focused).filter(p=>p.y!=null&&p.round<=highRound).at(-1);
  if(terminal)values.push(terminal.y);
 }
 if(!values.length)return [0,1];
 const min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.15,Math.abs(max)*.025,.000001);
 return [Math.max(0,min-pad),max+pad];
}
function star(cx,cy,r=6){let path='';for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rad=i%2?r*.43:r;path+=`${i?'L':'M'}${cx+Math.cos(a)*rad},${cy+Math.sin(a)*rad}`;}return path+'Z';}
function renderChart(el,detail){
 configureRoundBrush(el,null);
 renderRoundRange(el,'bv',roundBudget(),renderCharts);
 if(axisMode!=='round') {
  const runs=selected().filter(r=>r.search.some(p=>p.axes));
  const lines=runs.map(r=>({name:r.model+' '+methodLabel(r),id:r.id,color:comparisonColor(r,'bv'),dash:seriesDash(r),
   points:r.search.map(p=>({name:'r'+p.round,axes:p.axes,y:p.timing?.mean_ms??null,range:state.uncertainty&&p.timing?[p.timing.p10_ms,p.timing.p90_ms]:null,status:p.status}))}));
  for(const [i,r] of runs.entries())if(r.formal && r.formal_axes)
   lines[i].points.push({formal:true,name:'正式结果',axes:r.formal_axes,y:r.formal.mean_ms});
  const opts={best:mode==='best',zoom:detail&&state.ymode==='focus',range:detail?costRange:null,readout:$('#hover-readout')};
  if(detail&&state.ymode==='manual')opts.yRange=[state.ymin,state.ymax];
  const domain=costChart(el,lines,opts);
  if(detail)$('#detail-domain').textContent=domain?tickFmt(domain[0])+'–'+tickFmt(domain[1])+' ms':'—';
  return;
 }
 const runs=selected(),W=el.clientWidth||700,H=el.clientHeight||350,left=W<420?53:64,right=20,top=25,bottom=43,w=W-left-right,h=H-top-bottom;
 const [xmin,xmax]=comparisonWindow('bv',roundBudget()),withFinal=xmax===roundBudget()&&runs.some(r=>r.formal),finalAt=roundBudget()+(W<500?5:2),xend=withFinal?finalAt+.9:xmax+.25;
 const [ymin,ymax]=latencyWindow(el,'bv',bounds(runs,detail,[xmin,xmax])),sx=x=>left+(x-xmin)/(xend-xmin)*w,sy=y=>top+h-(y-ymin)/(ymax-ymin)*h;
 const id=detail?'detail':'overview',clip=`clip-${id}`,yticks=ticks(ymin,ymax,H>300?5:3),xticks=ticks(xmin,xmax,W<500?4:7).filter(Number.isInteger);
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><clipPath id="${clip}"><rect x="${left}" y="${top}" width="${w}" height="${h}"/></clipPath></defs>`;
 svg+=yticks.map(v=>`<line data-chart-key="y-grid:${v}" x1="${left}" x2="${W-right}" y1="${sy(v)}" y2="${sy(v)}" stroke="#edf0f4"/><text data-chart-key="y-tick:${v}" x="${left-10}" y="${sy(v)+4}" text-anchor="end">${tickFmt(v)}</text>`).join('');
 svg+=xticks.map(v=>`<text data-chart-key="x-tick:${v}" x="${sx(v)}" y="${H-22}" text-anchor="middle">${v}</text>`).join('');
 svg+=`<line data-chart-key="x-baseline" x1="${left}" x2="${W-right}" y1="${top+h}" y2="${top+h}" stroke="#dce2e8"/><text data-chart-key="y-label" x="${left}" y="13" class="axis-label">延迟 (ms) ↓</text><text data-chart-key="x-label" x="${left+w/2}" y="${H-4}" text-anchor="middle" class="axis-label">轮次</text>`;
 if(withFinal)svg+=`<line data-chart-key="final-separator" x1="${sx(finalAt-1)}" x2="${sx(finalAt-1)}" y1="${top}" y2="${top+h}" stroke="#dce2e8" stroke-dasharray="3 4"/><text data-chart-key="final-label" x="${sx(finalAt)}" y="${H-22}" text-anchor="middle">Final</text>`;
 svg+=`<g clip-path="url(#${clip})">`;
 for(const r of runs){
  const col=comparisonColor(r,'bv'),pts=series(r);let d='',last=null;
  for(const p of pts){
   if(p.y==null){if(mode==='raw'){d+=' ';last=null;}continue;}
   if(!last)d+=`M${sx(p.round)},${sy(p.y)}`;
   else if(mode==='best')d+=`H${sx(p.round)}V${sy(p.y)}`;
   else d+=`L${sx(p.round)},${sy(p.y)}`;
   last=p;
  }
  svg+=`<g data-comparison-series="${esc(r.id)}"><path class="curve" data-run="${esc(r.id)}" d="${d}" fill="none" stroke="${col}" stroke-width="${r.id===focusedRun?3:1.8}" stroke-dasharray="${seriesDash(r)}" opacity=".88"/>`;
  for(const p of pts){
   if(p.timing){
    if(state.uncertainty)svg+=`<path d="M${sx(p.round)},${sy(p.timing.p10_ms)}V${sy(p.timing.p90_ms)}M${sx(p.round)-2.5},${sy(p.timing.p10_ms)}h5M${sx(p.round)-2.5},${sy(p.timing.p90_ms)}h5" stroke="${col}" fill="none" opacity=".35"/>`;
    svg+=`<circle cx="${sx(p.round)}" cy="${sy(value(p))}" r="${detail?2.5:1.9}" fill="${col}" opacity="${mode==='raw'?'.72':'.34'}"/>`;
   }else if(p.status==='failed'){
    const yy=top+h-5;svg+=`<path d="M${sx(p.round)-2},${yy-2}l4 4m0 -4l-4 4" fill="none" stroke="${col}" opacity=".6"/>`;
   }
  }
  if(r.formal)svg+=`<path class="formal-star" d="${star(sx(finalAt),sy(r.formal.mean_ms),detail?6:5)}" fill="${col}" stroke="white" stroke-width=".7"/>`;
  svg+='</g>';
 }
 svg+=`</g><line data-chart-key="crosshair" class="crosshair" x1="0" x2="0" y1="${top}" y2="${top+h}" stroke="#8d9aaa" stroke-dasharray="3 3" visibility="hidden"/></svg>`;
 if(!runs.length)svg+=`<div style="position:absolute;inset:45% 0;text-align:center;color:#76818f;font-size:12px">选择曲线</div>`;
 renderChartMarkup(el,svg);
 configureRoundBrush(el,{scope:'bv',maximum:roundBudget(),min:xmin,max:xmax,ymin,ymax,width:W,height:H,left,right:sx(xmax),top,bottom:top+h,redraw:renderCharts});
 if(detail){
  const clipped=runs.filter(r=>{const p=series(r).filter(p=>p.y!=null&&p.round>=xmin&&p.round<=xmax);return p.length&&!p.some(p=>p.y>=ymin&&p.y<=ymax);}).length;
  $('#detail-domain').textContent=`${tickFmt(ymin)}–${tickFmt(ymax)} ms${clipped?' · '+clipped+' 条在范围外':''}`;
  if(state.ymode!=='manual'){$('#y-min').placeholder=tickFmt(ymin);$('#y-max').placeholder=tickFmt(ymax);}
 }
 let cursor=xmin;
 function inspect(n){cursor=n;const line=el.querySelector('.crosshair');if(line){line.setAttribute('x1',sx(n===roundBudget()+2?finalAt:n));line.setAttribute('x2',sx(n===roundBudget()+2?finalAt:n));line.setAttribute('visibility','visible');}renderReadout(n);}
 el.onpointermove=e=>{const x=e.clientX-el.getBoundingClientRect().left;if(x<left||x>W-right)return;let n=Math.round(xmin+(x-left)/w*(xend-xmin));if(withFinal&&n>roundBudget())n=roundBudget()+2;inspect(Math.max(xmin,Math.min(withFinal?roundBudget()+2:xmax,n)));};
 el.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();let n=cursor+(e.key==='ArrowRight'?1:-1);if(n===roundBudget()+1)n+=e.key==='ArrowRight'?1:-1;inspect(Math.max(xmin,Math.min(withFinal?roundBudget()+2:xmax,n)));}};
 el.onpointerleave=()=>{el.querySelector('.crosshair')?.setAttribute('visibility','hidden');};
}
function renderReadout(n){
 if(axisMode!=='round')return;
 $('#hover-readout').innerHTML=`<span><strong>${n===roundBudget()+2?'正式结果 ★':'第 '+n+' 轮'}</strong></span>`+selected().map(r=>{
  const p=n===roundBudget()+2?null:r.search.find(p=>p.round===n),m=n===roundBudget()+2?r.formal:p?.timing;
  return `<span style="--color:${comparisonColor(r,'bv')}"><i class="swatch"></i>${r.model} ${methodLabel(r)} <strong>${fmt(m?.mean_ms)}</strong>${m?' ms':''}</span>`;
 }).join('');
}
function renderCharts(){if(!data)return;renderChart($('#overview'),false);renderChart($('#detail'),true);renderReadout(roundBudget()+2);renderB0Cost();}
function syncRange(){
 $('#range-axis-label').textContent=axisMode==='round'?'轮次':axisMode==='time'?'分钟':'百万 token';
 for(const [id,index] of [['x-min',0],['x-max',1]]) {
  const el=$('#'+id);el.min=axisMode==='round'?'1':'0';el.step=axisMode==='round'?'1':'any';
  if(axisMode==='round')el.max=String(roundBudget());else el.removeAttribute('max');
  el.setAttribute('aria-label',(index?'结束':'起始')+$('#range-axis-label').textContent);
 }
 if(axisMode!=='round'){
  $('#x-min').value=costRange?.[0]??'';$('#x-max').value=costRange?.[1]??'';
  $('#x-min').placeholder='0';$('#x-max').placeholder='自动';
  $('#y-mode').value=state.ymode;$('#y-min').value=state.ymin??'';$('#y-max').value=state.ymax??'';return;
 }
 for(const [id,key]of[['x-min','xmin'],['x-max','xmax'],['y-mode','ymode']])$('#'+id).value=state[key];$('#y-min').value=state.ymin??'';$('#y-max').value=state.ymax??'';}
function applyRange(){
 const min=Number($('#x-min').value),max=Number($('#x-max').value),ymode=$('#y-mode').value;
 const ymin=$('#y-min').value===''?null:Number($('#y-min').value),ymax=$('#y-max').value===''?null:Number($('#y-max').value);
 if(axisMode==='round'&&(!Number.isInteger(min)||!Number.isInteger(max)||min<1||max>roundBudget()||min>=max)){showNotice(`轮次范围：1–${roundBudget()}，起始值须小于结束值。`);return;}
 if(ymode==='manual'&&(!(ymin>=0)||!Number.isFinite(ymax)||ymax<=ymin||ymin===null)){showNotice('请输入有效的纵轴范围：0 ≤ 最小值 < 最大值。');return;}
 if(axisMode!=='round'){
  const blank=$('#x-max').value===''&&$('#x-min').value==='';
  if(!blank&&(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max<=min)){showNotice('横轴结束值须大于起始值。');return;}
  costRange=blank?null:[min,max];Object.assign(state,{ymode,ymin,ymax});
 }else {clearLatencyWindows('bv');Object.assign(state,{xmin:min,xmax:max,ymode,ymin,ymax});roundWindows.set('bv:'+datasetId,[min,max]);}showNotice('');renderCharts();
}
function download(name,text,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
function csvCell(v){return '"'+String(v??'').replace(/"/g,'""')+'"';}
$('#csv').onclick=()=>{
 const head=['dataset','model','effort','method','round','role','status','review','mean_ms','p10_ms','p90_ms','samples','pytorch_ms','pytorch_speedup','finished_at','elapsed_seconds','reported_tokens'];
 const rows=roundRows().map(({r,p})=>[data.id,r.model,r.effort,methodLabel(r),p.round,p.role,p.status,p.review,p.timing?.mean_ms,p.timing?.p10_ms,p.timing?.p90_ms,p.timing?.sample_count,p.pytorch?.mean_ms,p.timing&&p.pytorch?p.pytorch.mean_ms/p.timing.mean_ms:null,r.finished_at,p.axes?.elapsed_s,p.axes?.tokens]);
 selected().filter(r=>$('#round-run').value==='all'||$('#round-run').value===r.id).forEach(r=>{if(r.formal&&['all','passed'].includes($('#round-status').value))rows.push([data.id,r.model,r.effort,methodLabel(r),'Final','candidate','passed','independent',r.formal.mean_ms,r.formal.p10_ms,r.formal.p90_ms,r.formal.sample_count,r.formal_pytorch?.mean_ms,r.formal_pytorch?r.formal_pytorch.mean_ms/r.formal.mean_ms:null,r.finished_at,r.formal_axes?.elapsed_s,r.formal_axes?.tokens]);});
 download(`${data.id}-selected.csv`,'\ufeff'+[head,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
};
$('#json').onclick=()=>download(`${data.id}-complete.json`,JSON.stringify(data,null,2),'application/json');
$('#sample-csv').onclick=()=>{if(activeSamples)download(`${data.id}-${activeSamples.r.model}-${activeSamples.r.method}-${activeSamples.p.round}-samples.csv`,'sample,latency_ms\n'+activeSamples.p.timing.samples_ms.map((v,i)=>`${i+1},${v}`).join('\n'),'text/csv');};
$('#close-samples').onclick=()=>$('#samples').close();
$('#refresh').onclick=()=>refresh(true);
$('#event-dataset').onchange=$('#event-kind').onchange=()=>{eventLimit=12;renderTaskEvents();};
$('#events-more').onclick=()=>{eventLimit+=12;renderTaskEvents();};
$('#round-run').onchange=renderRounds;$('#round-status').onchange=renderRounds;
$('#best-mode').onclick=()=>setMode('best');$('#raw-mode').onclick=()=>setMode('raw');
function setMode(m){mode=m;$('#best-mode').classList.toggle('selected',m==='best');$('#raw-mode').classList.toggle('selected',m==='raw');$('#best-mode').setAttribute('aria-pressed',m==='best');$('#raw-mode').setAttribute('aria-pressed',m==='raw');renderCharts();}
$('#uncertainty').onchange=e=>{state.uncertainty=e.target.checked;renderCharts();};
$('#apply-range').onclick=applyRange;
$('#y-mode').onchange=()=>{if($('#y-mode').value!=='manual')applyRange();};
$('#reset').onclick=resetBVView;
for(const id of ['overview','detail'])chartResetButton($('#'+id),id,resetBVView);
new ResizeObserver(()=>{if(category==='kl')renderKL();else if(isComparison())renderAligned('#aligned-content',alignedDataset,alignedRun);else if(data)renderCharts();}).observe($('main'));
$$('[data-category]').forEach(b=>b.onclick=()=>chooseCategory(b.dataset.category));
$$('[data-axis]').forEach(b=>b.onclick=()=>changeAxis(b.dataset.axis));
setCategory(category);axisControls();
setInterval(()=>{if(!document.hidden){renderNextUpdate();refresh();}},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('popstate',()=>{document.dispatchEvent(new CustomEvent('experiment:routechange',{detail:location.href}));const url=new URL(location);axisMode=requestedAxis();bvEdition=requestedBVEdition();costRange=null;setCategory(url.searchParams.get('category'));axisControls();if(category==='kl')loadKL(url.searchParams.get('dataset')||'GQA');else if(isComparison())loadAligned(url.searchParams.get('dataset')||'GQA',url.searchParams.get('run'),category);else loadDataset(url.searchParams.get('dataset')||'GQA',true,url.searchParams.get('run'));});

// All cost views plot the verified coordinate on each record, including failed searches.
function costChart(el, lines, options={}) {
 const width=Math.max(300,el.clientWidth||700),height=options.height||el.clientHeight||330;
 const pad={l:width<420?51:66,r:20,t:23,b:44};
 const series=lines.map(line=>({...line,points:line.points.filter(p=>Number.isFinite(costX(p.axes)))}));
 const items=series.flatMap(line=>line.points.map(p=>({line,p,x:costX(p.axes)}))).sort((a,b)=>a.x-b.x);
 const note=options.readout;
 if(!items.length){
  el.innerHTML='<div class="cost-empty">暂无所选曲线的横轴数据</div>';
  if(note)note.textContent='';
  el.onkeydown=el.onpointermove=null;
  return null;
 }
 const lo=options.range?.[0]??0,hi=options.range?.[1]??Math.max(.001,items.at(-1).x)*1.025;
 const within=x=>lo<=x&&x<=hi;
 const visibleItems=items.filter(item=>within(item.x));
 const refs=options.references||[];
 let vals=visibleItems.flatMap(({p})=>[p.y,...(p.range||[])]).filter(Number.isFinite);
 let ymin=0,ymax=Math.max(.001,...vals,...refs.map(r=>r.latency_ms))*1.08;
 if(options.zoom&&vals.length){
  const tails=series.flatMap(r=>{
   const measured=r.points.filter(p=>!p.formal&&Number.isFinite(p.y)&&within(costX(p.axes)));
   return measured.length?[Math.min(...measured.map(p=>p.y))]:[];
  }).sort((a,b)=>a-b);
  let cluster=tails;
  for(let i=3;i<tails.length;i++)if(tails[i]/tails[i-1]>=2){cluster=tails.slice(0,i);break;}
  if(cluster.length){const a=cluster[0],b=cluster.at(-1),dy=Math.max((b-a)*.16,b*.04,.000001);ymin=Math.max(0,a-dy);ymax=b+dy;}
 }
 if(options.yRange&&Number.isFinite(options.yRange[0])&&options.yRange[1]>options.yRange[0])[ymin,ymax]=options.yRange;
 const x=v=>pad.l+(v-lo)/(hi-lo)*(width-pad.l-pad.r);
 const y=v=>height-pad.b-(v-ymin)/(ymax-ymin)*(height-pad.t-pad.b);
 const base=height-pad.b,clip='cost-clip-'+(el.id||'aligned')+(el.closest('#kl-panel')?'kl':'');
 const label=axisText(),yLabel=options.yLabel||'延迟 (ms) ↓';
 let svg='<svg viewBox="0 0 '+width+' '+height+'" role="img"><title>'+esc(label+' / '+yLabel)+'</title><defs><clipPath id="'+clip+'"><rect x="'+(pad.l-4)+'" y="'+(pad.t-6)+'" width="'+(width-pad.l-pad.r+8)+'" height="'+(height-pad.t-pad.b+12)+'"/></clipPath></defs>';
 for(const v of ticks(lo,hi,width<480?4:7))svg+='<text data-chart-key="x-tick:'+v+'" x="'+x(v)+'" y="'+(height-22)+'" text-anchor="middle">'+tickFmt(v)+'</text>';
 for(const v of (options.binary?[0,1]:ticks(ymin,ymax,5)))svg+='<line data-chart-key="y-grid:'+v+'" x1="'+pad.l+'" x2="'+(width-pad.r)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#edf0f4"/><text data-chart-key="y-tick:'+v+'" x="'+(pad.l-8)+'" y="'+(y(v)+4)+'" text-anchor="end">'+(options.binary?(v?'通过':'未通过'):tickFmt(v))+'</text>';
 svg+='<text data-chart-key="y-label" x="9" y="15">'+esc(yLabel)+'</text><text data-chart-key="x-label" x="'+(width/2)+'" y="'+(height-3)+'" text-anchor="middle">'+esc(label)+'</text><g clip-path="url(#'+clip+')">';
 for(const r of series){
  let best=null,path='',bestPath='',last=false,lastBest=false,epoch;
  for(const p of r.points){
   if(p.formal)continue;
   if(p.epoch!==epoch){epoch=p.epoch;best=null;last=false;lastBest=false;}
   if(Number.isFinite(p.y)&&p.eligible!==false)best=best===null?p.y:Math.min(best,p.y);
   if(options.both&&best!==null){const px=x(costX(p.axes)),py=y(best);bestPath+=lastBest?' H'+px+' V'+py:' M'+px+','+py;lastBest=true;}
   const v=options.best?best:p.y;
   if(!Number.isFinite(v)){last=false;continue;}
   const px=x(costX(p.axes)),py=y(v);
   path+=!last?' M'+px+','+py:options.best?' H'+px+' V'+py:' L'+px+','+py;
   last=true;
  }
  if(bestPath)svg+='<path d="'+bestPath+'" fill="none" stroke="#009E73" stroke-dasharray="5 3"/>';
  svg+='<path class="curve" data-run="'+esc(r.id)+'" data-aligned-curve="'+esc(r.id)+'" d="'+path+'" fill="none" stroke="'+r.color+'" stroke-width="2" stroke-dasharray="'+(r.dash||'')+'"/>';
 }
 for(const ref of refs){
  svg+='<line data-reference="'+esc(ref.kind)+'" x1="'+pad.l+'" x2="'+(width-pad.r)+'" y1="'+y(ref.latency_ms)+'" y2="'+y(ref.latency_ms)+'" stroke="'+ref.color+'" stroke-dasharray="'+ref.dash+'"><title>'+esc(ref.caption)+'</title></line>';
 }
 function description(item){
  const {line,p}=item,measure=Number.isFinite(p.y)?options.binary?(p.y?'通过':'未通过'):fmt(p.y)+' ms':(p.status==='failed'?'失败':'无计时');
  return [line.name,p.name,measure,costDetail(p)].join(' · ');
 }
 for(let i=0;i<items.length;i++){
  const item=items[i],{line,p}=item,px=x(item.x);
  if(!within(item.x))continue;
  const py=Number.isFinite(p.y)?y(p.y):base-5;
  const tip=esc(description(item)),partialToken=partial(p.axes);
  const attr=' class="cost-marker" data-cost-point="'+i+'" tabindex="0" aria-label="'+tip+'"'+(p.applyButton?' data-apply-point="'+p.applyButton+'" role="button"':'')+(partialToken?' data-token-incomplete="true"':'');
  if(p.range)svg+='<path d="M'+px+','+y(p.range[0])+' V'+y(p.range[1])+'" stroke="'+line.color+'" opacity=".45"/>';
  if(partialToken)svg+='<path'+attr+' d="M'+px+','+(py-5)+' l5,9 h-10 Z" fill="white" stroke="#9a5200" stroke-width="1.8"><title>'+tip+'</title></path>';
  else if(p.formal)svg+='<path'+attr+' d="'+star(px,py,6)+'" fill="'+line.color+'"><title>'+tip+'</title></path>';
  else if(!Number.isFinite(p.y))svg+='<path'+attr+' d="M'+(px-3)+','+(py-3)+' l6,6 m0,-6 l-6,6" stroke="'+line.color+'"><title>'+tip+'</title></path>';
  else svg+='<circle'+attr+' cx="'+px+'" cy="'+py+'" r="'+(p.selected?5:3.2)+'" fill="'+line.color+'"><title>'+tip+'</title></circle>';
 }
 renderChartMarkup(el,svg+'</g></svg>');el.tabIndex=0;
 let index=0;
 function inspect(i){index=i;if(note)note.textContent=description(items[i]);}
 const markers=el.querySelectorAll('[data-cost-point]');
 for(const marker of markers){
  const i=Number(marker.dataset.costPoint),p=items[i].p;
  marker.onfocus=marker.onpointerenter=()=>inspect(i);
  marker.onclick=()=>{inspect(i);if(p.applyButton)selectApply(p.applyButton);};
  marker.onkeydown=e=>{if(p.applyButton&&['Enter',' '].includes(e.key)){e.preventDefault();selectApply(p.applyButton);}};
 }
 el.onkeydown=e=>{
  if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
  e.preventDefault();
  const candidates=items.map((v,i)=>within(v.x)?i:-1).filter(i=>i>=0);
  if(!candidates.length)return;
  const n=candidates.indexOf(index)+(e.key==='ArrowRight'?1:-1);
  inspect(candidates[Math.min(candidates.length-1,Math.max(0,n))]);
 };
 el.onpointermove=null;
 if(note&&visibleItems.length)inspect(items.indexOf(visibleItems.find(item=>item.p.selected)||visibleItems.at(-1)));
 else if(note)note.textContent='所选范围暂无测量点';
 return [ymin,ymax];
}
function renderB0Cost(){
 const host=$('#b0-cost');
 const runs=data?.runs.filter(r=>r.method==='B0'&&r.search.some(p=>p.axes))||[];
 host.hidden=axisMode==='round'||!runs.length;
 if(host.hidden)return;
 host.innerHTML='<div class="chart" id="b0-cost-chart"></div><div class="cost-readout" aria-live="polite"></div>';
 const lines=runs.map(run=>({id:run.id,name:run.model+' '+methodLabel(run),color:'#526c89',dash:DASH[run.model],points:run.search.map(p=>({axes:p.axes,name:'r'+p.round,y:p.status==='passed'?1:p.status==='failed'?0:null,status:p.status}))}));
 costChart(host.querySelector('.chart'),lines,{height:148,binary:true,yLabel:'正确性',yRange:[-.15,1.2],readout:host.querySelector('.cost-readout')});
}

refresh();
