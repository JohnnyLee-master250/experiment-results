'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const COLORS={B1:'#0072B2',B2:'#D55E00',B3:'#CC79A7',V0:'#009E73'};
const LABELS={running:'正在跑',complete:'已完成',paused:'已暂停',not_run:'未跑',no_data:'无数据',ended:'已结束',blocked:'待处理'};
const MODELS=['Sol6','Astra','DeepSeek','DeepSeek-high'];
const METHODS=['B1','B2','B3','V0'];
const DASH={Sol6:'',Astra:'7 4',DeepSeek:'2 4','DeepSeek-high':'9 3 2 3'};
let manifest,data,cache=new Map(),visible=new Set(),datasetId=new URL(location).searchParams.get('dataset')||'GQA',mode='best',activeSamples=null,loadSeq=0,needsReload=false;
let focusedRun=null,initialRun=new URL(location).searchParams.get('run');
let eventLimit=12;
let category=new URL(location).searchParams.get("category")==="kl"?"kl":"bv";
const state={xmin:1,xmax:30,ymin:null,ymax:null,ymode:'focus',uncertainty:false};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,n=6)=>v==null?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:n,minimumFractionDigits:Math.min(3,n)});
function date(v,short=false){if(!v)return '—';return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit',...(short?{}:{hour:'2-digit',minute:'2-digit',hour12:false})}).format(new Date(v));}
function badge(s){return `<span class="badge ${esc(s)}">${esc(LABELS[s]||s)}</span>`;}
function selected(){return data.runs.filter(r=>visible.has(r.id)&&r.method!=='B0');}
function usable(r){return r.method!=='B0'&&(r.search.length>0||r.formal);}
function value(p){return p.timing?.mean_ms??null;}
function candidates(r){return r.search.filter(p=>p.timing&&p.role==='candidate');}
function series(r){
 let best=null;
 return r.search.map(p=>{if(p.timing)best=best==null?value(p):Math.min(best,value(p));return {...p,y:mode==='best'?best:value(p)};});
}
function showNotice(s){$('#notice').hidden=!s;$('#notice').textContent=s;}
async function getJSON(url){const response=await fetch(url,{cache:'no-cache'});if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json();}
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
  const changed=!manifest||m.updated_at!==manifest.updated_at;
  manifest=m;renderNextUpdate();renderTaskEvents();if(!data){$('#updated').textContent=date(m.updated_at);$('#updated').dateTime=m.updated_at;}
  $('#connection').classList.remove('stale');showNotice('');
  if(changed||force||needsReload){cache.clear();renderNav();renderRunning();if(category==="kl")await loadKL(datasetId);else await loadDataset(datasetId,!data||data.id!==datasetId,initialRun);if(!needsReload)initialRun=null;}
 }catch(e){$('#connection').classList.add('stale');showNotice(`更新暂不可用${data?'，保留上次数据':''} · ${e.message}`);}
 finally{$('#refresh').disabled=false;}
}
function renderNav(){
 $('#datasets').innerHTML=manifest.datasets.map(d=>`<button type="button" data-dataset="${esc(d.id)}" aria-current="${d.id===datasetId}">${esc(d.id)}</button>`).join('');
 $$('[data-dataset]').forEach(b=>b.onclick=()=>category==="kl"?loadKL(b.dataset.dataset):loadDataset(b.dataset.dataset,true));
}
function renderRunning(){
 const runs=[...(manifest.running_runs||[]),...(manifest.kl?.running_runs||[])];
 $('#running-count').textContent=`${runs.length} 组`;
 $('#running-links').innerHTML=runs.map(r=>{
  const href=`?${new URLSearchParams({dataset:r.dataset,run:r.id,category:r.category||'bv'})}${r.category==='kl'?'#kl-overview':'#curves'}`;
  const phase={reviewing:'审查中',evaluating:'评测中',profiling:'测量中',ready:'推进中',initializing:'初始化'}[r.phase]||'运行中';
  return `<a class="running-link ${focusedRun===r.id?'current':''}" href="${esc(href)}" data-category-target="${r.category||'bv'}" data-running="${esc(r.id)}" data-target="${esc(r.dataset)}" style="--color:${COLORS[r.method]||'#526c89'}" title="${esc(r.model+' / '+r.effort)} · 已记录 ${r.reported_attempts}/${r.budget} 轮；待审查记录不代表独立完成"><span class="swatch"></span><strong>${esc(r.dataset)} · ${esc(r.model)} ${esc(r.method)}</strong><span class="running-round">${r.reported_attempts}<span> / ${r.budget} ${r.category==='kl'?'Apply':'轮'}</span></span><span class="running-phase">${phase}</span><span aria-hidden="true">↗</span></a>`;
 }).join('')||'<span class="running-empty">暂无运行中的实验</span>';
 $$('[data-running]').forEach(a=>a.onclick=e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();if(a.dataset.categoryTarget==='kl'){loadKL(a.dataset.target);}else loadDataset(a.dataset.target,data?.id!==a.dataset.target,a.dataset.running,true);});
}
async function loadDataset(id,reset,focusRun=null,push=false){
 setCategory("bv");++klSequence;
 const seq=++loadSeq;const meta=manifest.datasets.find(d=>d.id===id)||manifest.datasets[0];datasetId=meta.id;
 try{
  const d=cache.get(meta.id)||await getJSON(`./api/v1/${meta.url}?v=${encodeURIComponent(manifest.updated_at)}`);
  if(seq!==loadSeq)return;
  if(d.updated_at!==manifest.updated_at)throw Error('发布版本尚在同步');
  cache.set(meta.id,d);data=d;needsReload=false;
  $('#updated').textContent=date(d.updated_at);$('#updated').dateTime=d.updated_at;
  if(reset){visible=new Set(data.runs.filter(usable).map(r=>r.id));Object.assign(state,{xmin:1,xmax:30,ymode:'focus',ymin:null,ymax:null});$('#round-run').value='all';}
  else for(const r of data.runs)if(!r.search.length&&!r.formal)visible.delete(r.id);
  if(reset)focusedRun=null;
  const target=focusRun&&data.runs.find(r=>r.id===focusRun);
  if(target){focusedRun=target.id;if(usable(target))visible.add(target.id);Object.assign(state,{xmin:1,xmax:30,ymode:'focus',ymin:null,ymax:null});}
  const url=new URL(location);url.searchParams.set('dataset',meta.id);url.searchParams.set('category','bv');url.searchParams.delete('apply');
  if(focusedRun)url.searchParams.set('run',focusedRun);else url.searchParams.delete('run');
  if(target)url.hash=target.method==='B0'?'correctness':'curves';
  history[push?'pushState':'replaceState'](null,'',url);renderNav();renderRunning();
  $('#dataset-name').textContent=data.title;$('#workload').textContent=data.workload;
  syncRange();renderAll();showNotice('');
  if(target){const el=$(target.method==='B0'?'#correctness':'#curves');el.scrollIntoView({block:'start'});if(target.method!=='B0')el.focus({preventScroll:true});}
 }catch(e){if(seq===loadSeq){needsReload=true;$('#connection').classList.add('stale');showNotice(`数据读取失败，保留上次快照 · ${e.message}`);}}
}
function toggle(id,on){on?visible.add(id):visible.delete(id);renderAll();}
function toggleModel(model,on){data.runs.filter(r=>r.model===model&&usable(r)).forEach(r=>on?visible.add(r.id):visible.delete(r.id));renderAll();}
function renderControls(){
 $('#series-controls').innerHTML=MODELS.map(model=>{
  const runs=data.runs.filter(r=>r.model===model),effort=runs[0]?.effort||'',available=runs.filter(usable),count=available.filter(r=>visible.has(r.id)).length,all=available.length>0&&count===available.length,mixed=count>0&&!all;
  return `<div class="model-group"><div class="model-heading"><button type="button" data-model="${model}" aria-label="切换 ${model} 全部曲线" ${available.length?'':'disabled'}>${model}</button><span class="effort">${esc(effort)}</span><span class="model-line ${model.toLowerCase()}"></span><label class="model-toggle ${mixed?'mixed':''}" title="${count}/${available.length} 条曲线已显示"><span>${available.length?(all?'全部':mixed?'部分':'关闭'):'无数据'}</span><input type="checkbox" data-model-check="${model}" aria-label="${model} 全部曲线" aria-checked="${mixed?'mixed':String(all)}" ${all?'checked':''} ${available.length?'':'disabled'}><span class="toggle-track" aria-hidden="true"></span></label></div><div class="chips">${METHODS.map(method=>{
   const r=runs.find(x=>x.method===method),on=r&&visible.has(r.id),ok=r&&usable(r);
   return `<label class="chip ${on?'active':''} ${ok?'':'disabled'}" style="--color:${COLORS[method]}" title="${esc(r?LABELS[r.status]:'无数据')}"><input type="checkbox" data-series="${esc(r?.id)}" ${on?'checked':''} ${ok?'':'disabled'} aria-label="${model} ${method} 曲线">${method}</label>`;
  }).join('')}</div></div>`;
 }).join('');
 $$('[data-series]').forEach(e=>e.onchange=()=>toggle(e.dataset.series,e.checked));
 $$('[data-model-check]').forEach(e=>{e.indeterminate=e.getAttribute('aria-checked')==='mixed';e.onchange=()=>{const model=e.dataset.modelCheck;toggleModel(model,e.checked);$(`[data-model-check="${model}"]`).focus({preventScroll:true});};});
 $$('[data-model]').forEach(e=>e.onclick=()=>{const runs=data.runs.filter(r=>r.model===e.dataset.model&&usable(r));toggleModel(e.dataset.model,!runs.every(r=>visible.has(r.id)));});
}
function renderTaskEvents(){
 const labels={started:'开始',resumed:'恢复',paused:'暂停',completed:'完成'},ds=$('#event-dataset').value,kind=$('#event-kind').value;
 const events=(manifest?.task_events||[]).filter(e=>(ds==='all'||e.runs.some(r=>r.dataset===ds))&&(kind==='all'||e.kind===kind));
 $('#event-count').textContent=`${events.length} 条`;
 $('#task-events').innerHTML=events.slice(0,eventLimit).map(e=>`<li class="task-event"><time datetime="${esc(e.at)}" title="${esc(e.at)}">${date(e.at)}${e.time_basis==='observed'?'<small>记录时间</small>':''}</time><span class="event-tag ${esc(e.kind)}">${labels[e.kind]||esc(e.kind)}</span><div class="event-runs">${e.runs.map(r=>`<a href="?${new URLSearchParams({dataset:r.dataset,run:r.id,category:r.category||'bv'})}#curves" data-event-run="${esc(r.id)}" data-target="${esc(r.dataset)}">${esc(r.dataset)} · ${esc(r.model)} ${esc(r.method)} ↗</a>`).join('')}</div><p>${esc(e.reason)}</p></li>`).join('')||'<li class="empty">暂无记录</li>';
 $('#events-more').hidden=eventLimit>=events.length;
 $$('[data-event-run]').forEach(a=>a.onclick=e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();loadDataset(a.dataset.target,data?.id!==a.dataset.target,a.dataset.eventRun,true);});
}
function renderSummary(){
 let previous='';
 $('#summary tbody').innerHTML=data.runs.filter(r=>r.method!=='B0').map(r=>{
  const best=r.search.find(p=>p.round===r.search_best_round),range=best?.timing?`${fmt(best.timing.p10_ms,4)}–${fmt(best.timing.p90_ms,4)}`:'—';
  const group=previous&&previous!==r.model?'group-line':'';previous=r.model;
  return `<tr class="${group}" style="--color:${COLORS[r.method]}"><td><input class="row-check" type="checkbox" data-row="${r.id}" aria-label="显示 ${r.model} ${r.method}" ${visible.has(r.id)?'checked':''} ${usable(r)?'':'disabled'}></td><td><span class="model-label">${r.model}</span><span class="effort-label">${esc(r.effort)}</span></td><td><span class="swatch"></span> ${r.method}</td><td>${badge(r.status)}</td><td>${r.reported_attempts} / ${r.budget}</td><td class="date">${date(r.finished_at)}</td><td class="num">${fmt(r.search_best_ms)}</td><td class="num">${range}</td><td class="num">${fmt(r.formal?.mean_ms)}</td><td class="num">${r.formal&&r.formal_pytorch?fmt(r.formal_pytorch.mean_ms/r.formal.mean_ms,3)+'×':'—'}</td></tr>`;
 }).join('');
 $$('[data-row]').forEach(e=>e.onchange=()=>toggle(e.dataset.row,e.checked));
 $('#correctness tbody').innerHTML=data.runs.filter(r=>r.method==='B0').map(r=>`<tr><td>${r.model} <span class="effort-label">${esc(r.effort)}</span></td><td>${r.run_label||'B0'}</td><td>${badge(r.status)}</td><td>${r.reported_attempts} / ${r.budget}</td><td>${r.accepted===true?'通过':r.accepted===false?'未接受':'—'}</td><td class="date">${date(r.finished_at)}</td></tr>`).join('');
}
function roundRows(){
 const filter=$('#round-run').value,st=$('#round-status').value;
 return selected().filter(r=>filter==='all'||r.id===filter).flatMap(r=>r.search.filter(p=>st==='all'||p.status===st).map(p=>({r,p}))).sort((a,b)=>a.p.round-b.p.round||MODELS.indexOf(a.r.model)-MODELS.indexOf(b.r.model)||METHODS.indexOf(a.r.method)-METHODS.indexOf(b.r.method));
}
function renderRoundSelector(){const current=$('#round-run').value;$('#round-run').innerHTML='<option value="all">全部已选曲线</option>'+selected().map(r=>`<option value="${r.id}">${r.model} · ${r.method}</option>`).join('');if(selected().some(r=>r.id===current))$('#round-run').value=current;}
function renderRounds(){
 const rows=roundRows();$('#round-count').textContent=`${rows.length} 条`;
 $('#rounds tbody').innerHTML=rows.map(({r,p})=>{
  const m=p.timing,status={passed:'通过',failed:'失败',excluded:'基础设施中断'}[p.status];
  return `<tr><td>${r.model}</td><td>${r.method}</td><td>${p.round}${p.role==='b0'?' · 初始':''}</td><td>${status||'—'}</td><td class="date">${{saved:'已保存',pending:'待完成',not_required:'不适用',historical:'历史记录'}[p.review]||'—'}</td><td class="num">${fmt(m?.mean_ms)}</td><td class="num">${fmt(m?.p10_ms)}</td><td class="num">${fmt(m?.p90_ms)}</td><td class="num">${m?`<button class="sample-button" data-sample="${r.id}|${p.round}" aria-label="${r.model} ${r.method} 第 ${p.round} 轮样本">${m.sample_count}</button>`:'—'}</td><td class="num">${fmt(p.pytorch?.mean_ms)}</td><td class="num">${m&&p.pytorch?fmt(p.pytorch.mean_ms/m.mean_ms,3)+'×':'—'}</td></tr>`;
 }).join('')||'<tr><td colspan="11" class="empty">没有符合筛选条件的数据</td></tr>';
 $$('[data-sample]').forEach(b=>b.onclick=()=>{const[id,n]=b.dataset.sample.split('|'),r=data.runs.find(r=>r.id===id),p=r.search.find(p=>p.round===+n);activeSamples={r,p};$('#sample-title').textContent=`${r.model} · ${r.method} · 第 ${n} 轮`;$('#sample-stats').textContent=`均值 ${fmt(p.timing.mean_ms)} ms · P10–P90 ${fmt(p.timing.p10_ms)}–${fmt(p.timing.p90_ms)} ms · n=${p.timing.sample_count}`;$('#sample-values').textContent=p.timing.samples_ms.map((v,i)=>`${String(i+1).padStart(3,' ')}  ${v}`).join('\n');$('#samples').showModal();});
}
function renderWorkspaces(){
 const runs=data.runs.filter(r=>r.workspace_path);
 $('#workspace-paths').innerHTML=runs.map(r=>`<div class="workspace-row"><div class="workspace-label"><strong>${esc(r.model)} · ${esc(r.run_label||r.method)}</strong><span>${esc(r.effort)}</span></div><code>${esc(r.workspace_path)}</code><button type="button" data-copy-workspace="${esc(r.id)}" aria-label="复制 ${esc(r.model+' '+(r.run_label||r.method))} 工作区路径">复制</button></div>`).join('')||'<p class="empty">暂无已保存的工作区路径</p>';
 $$('[data-copy-workspace]').forEach(b=>b.onclick=async()=>{const r=runs.find(r=>r.id===b.dataset.copyWorkspace);try{await navigator.clipboard.writeText(r.workspace_path);b.textContent='已复制';}catch{b.textContent='请选中路径复制';}});
}
function renderAll(){if(!data)return;renderControls();renderSummary();renderRoundSelector();renderRounds();renderWorkspaces();renderCharts();}
function ticks(lo,hi,count){
 const raw=(hi-lo)/Math.max(count,1),exp=10**Math.floor(Math.log10(raw||1)),n=raw/exp,step=(n<=1?1:n<=2?2:n<=5?5:10)*exp;
 const out=[];for(let v=Math.ceil(lo/step)*step;v<=hi+step*1e-7;v+=step)out.push(Math.abs(v)<step*1e-8?0:v);return out;
}
function tickFmt(v){if(v===0)return '0';if(Math.abs(v)>=1000)return String(+v.toFixed(0));if(Math.abs(v)>=10)return String(+v.toFixed(2));return String(+v.toFixed(5));}
function bounds(runs,detail){
 const measured=runs.flatMap(r=>r.search.filter(p=>p.timing).map(p=>p.timing[state.uncertainty?'p90_ms':'mean_ms'])).concat(runs.map(r=>r.formal?.mean_ms).filter(Number.isFinite));
 if(!detail)return [0,Math.max(...measured,1e-3)*1.06];
 if(state.ymode==='manual'&&Number.isFinite(state.ymin)&&Number.isFinite(state.ymax)&&state.ymax>state.ymin)return [state.ymin,state.ymax];
 let values=[];
 if(state.ymode==='all'){
  runs.forEach(r=>series(r).filter(p=>p.round>=state.xmin&&p.round<=state.xmax&&p.y!=null).forEach(p=>values.push(p.y)));
  if(state.xmax===30)runs.forEach(r=>{if(r.formal)values.push(r.formal.mean_ms);});
 }else{
  values=runs.map(r=>{const pts=series(r).filter(p=>p.y!=null&&p.round<=state.xmax);return pts.length?pts[pts.length-1].y:null;}).filter(Number.isFinite);
  // Zoom the lower terminal cluster, retaining at least three series where available.
  // The overview and explicit outside-range count preserve the excluded scale context.
  const sorted=values.slice().sort((a,b)=>a-b);let cut=-1;
  for(let i=Math.min(3,sorted.length-1);i<sorted.length;i++){if(i>0&&sorted[i]/sorted[i-1]>=2){cut=i;break;}}
  if(cut>0)values=sorted.slice(0,cut);
  const focused=runs.find(r=>r.id===focusedRun),terminal=focused&&series(focused).filter(p=>p.y!=null&&p.round<=state.xmax).at(-1);
  if(terminal)values.push(terminal.y);
 }
 if(!values.length)return [0,1];
 const min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.15,Math.abs(max)*.025,.000001);
 return [Math.max(0,min-pad),max+pad];
}
function star(cx,cy,r=6){let path='';for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rad=i%2?r*.43:r;path+=`${i?'L':'M'}${cx+Math.cos(a)*rad},${cy+Math.sin(a)*rad}`;}return path+'Z';}
function renderChart(el,detail){
 const runs=selected(),W=el.clientWidth||700,H=el.clientHeight||350,left=W<420?53:64,right=20,top=25,bottom=43,w=W-left-right,h=H-top-bottom;
 const xmin=detail?state.xmin:1,xmax=detail?state.xmax:30,withFinal=xmax===30,finalAt=W<500?35:32,xend=withFinal?finalAt+.9:xmax+.25;
 const [ymin,ymax]=bounds(runs,detail),sx=x=>left+(x-xmin)/(xend-xmin)*w,sy=y=>top+h-(y-ymin)/(ymax-ymin)*h;
 const id=detail?'detail':'overview',clip=`clip-${id}`,yticks=ticks(ymin,ymax,H>300?5:3),xticks=ticks(xmin,xmax,W<500?4:7).filter(Number.isInteger);
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><clipPath id="${clip}"><rect x="${left}" y="${top}" width="${w}" height="${h}"/></clipPath></defs>`;
 svg+=yticks.map(v=>`<line x1="${left}" x2="${W-right}" y1="${sy(v)}" y2="${sy(v)}" stroke="#edf0f4"/><text x="${left-10}" y="${sy(v)+4}" text-anchor="end">${tickFmt(v)}</text>`).join('');
 svg+=xticks.map(v=>`<text x="${sx(v)}" y="${H-22}" text-anchor="middle">${v}</text>`).join('');
 svg+=`<line x1="${left}" x2="${W-right}" y1="${top+h}" y2="${top+h}" stroke="#dce2e8"/><text x="${left}" y="13" class="axis-label">延迟 (ms) ↓</text><text x="${left+w/2}" y="${H-4}" text-anchor="middle" class="axis-label">轮次</text>`;
 if(withFinal)svg+=`<line x1="${sx(finalAt-1)}" x2="${sx(finalAt-1)}" y1="${top}" y2="${top+h}" stroke="#dce2e8" stroke-dasharray="3 4"/><text x="${sx(finalAt)}" y="${H-22}" text-anchor="middle">Final</text>`;
 svg+=`<g clip-path="url(#${clip})">`;
 for(const r of runs){
  const col=COLORS[r.method],pts=series(r);let d='',last=null;
  for(const p of pts){
   if(p.y==null){if(mode==='raw'){d+=' ';last=null;}continue;}
   if(!last)d+=`M${sx(p.round)},${sy(p.y)}`;
   else if(mode==='best')d+=`H${sx(p.round)}V${sy(p.y)}`;
   else d+=`L${sx(p.round)},${sy(p.y)}`;
   last=p;
  }
  svg+=`<path class="curve" data-run="${esc(r.id)}" d="${d}" fill="none" stroke="${col}" stroke-width="${r.id===focusedRun?3:1.8}" stroke-dasharray="${DASH[r.model]}" opacity=".88"/>`;
  for(const p of pts){
   if(p.timing){
    if(state.uncertainty)svg+=`<path d="M${sx(p.round)},${sy(p.timing.p10_ms)}V${sy(p.timing.p90_ms)}M${sx(p.round)-2.5},${sy(p.timing.p10_ms)}h5M${sx(p.round)-2.5},${sy(p.timing.p90_ms)}h5" stroke="${col}" fill="none" opacity=".35"/>`;
    svg+=`<circle cx="${sx(p.round)}" cy="${sy(value(p))}" r="${detail?2.5:1.9}" fill="${col}" opacity="${mode==='raw'?'.72':'.34'}"/>`;
   }else if(p.status==='failed'){
    const yy=top+h-5;svg+=`<path d="M${sx(p.round)-2},${yy-2}l4 4m0 -4l-4 4" fill="none" stroke="${col}" opacity=".6"/>`;
   }
  }
  if(r.formal)svg+=`<path class="formal-star" d="${star(sx(finalAt),sy(r.formal.mean_ms),detail?6:5)}" fill="${col}" stroke="white" stroke-width=".7"/>`;
 }
 svg+=`</g><line class="crosshair" x1="0" x2="0" y1="${top}" y2="${top+h}" stroke="#8d9aaa" stroke-dasharray="3 3" visibility="hidden"/></svg>`;
 if(!runs.length)svg+=`<div style="position:absolute;inset:45% 0;text-align:center;color:#76818f;font-size:12px">选择曲线</div>`;
 el.innerHTML=svg;
 if(detail){
  const clipped=runs.filter(r=>{const p=series(r).filter(p=>p.y!=null&&p.round>=xmin&&p.round<=xmax);return p.length&&!p.some(p=>p.y>=ymin&&p.y<=ymax);}).length;
  $('#detail-domain').textContent=`${tickFmt(ymin)}–${tickFmt(ymax)} ms${clipped?' · '+clipped+' 条在范围外':''}`;
  if(state.ymode!=='manual'){$('#y-min').placeholder=tickFmt(ymin);$('#y-max').placeholder=tickFmt(ymax);}
 }
 let cursor=xmin;
 function inspect(n){cursor=n;const line=el.querySelector('.crosshair');if(line){line.setAttribute('x1',sx(n===32?finalAt:n));line.setAttribute('x2',sx(n===32?finalAt:n));line.setAttribute('visibility','visible');}renderReadout(n);}
 el.onpointermove=e=>{const x=e.clientX-el.getBoundingClientRect().left;if(x<left||x>W-right)return;let n=Math.round(xmin+(x-left)/w*(xend-xmin));if(withFinal&&n>30)n=32;inspect(Math.max(xmin,Math.min(withFinal?32:xmax,n)));};
 el.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();let n=cursor+(e.key==='ArrowRight'?1:-1);if(n===31)n+=e.key==='ArrowRight'?1:-1;inspect(Math.max(xmin,Math.min(withFinal?32:xmax,n)));}};
 el.onpointerleave=()=>{el.querySelector('.crosshair')?.setAttribute('visibility','hidden');};
}
function renderReadout(n){
 $('#hover-readout').innerHTML=`<span><strong>${n===32?'正式结果 ★':'第 '+n+' 轮'}</strong></span>`+selected().map(r=>{
  const p=n===32?null:r.search.find(p=>p.round===n),m=n===32?r.formal:p?.timing;
  return `<span style="--color:${COLORS[r.method]}"><i class="swatch"></i>${r.model} ${r.method} <strong>${fmt(m?.mean_ms)}</strong>${m?' ms':''}</span>`;
 }).join('');
}
function renderCharts(){if(!data)return;renderChart($('#overview'),false);renderChart($('#detail'),true);renderReadout(32);}
function syncRange(){for(const [id,key]of[['x-min','xmin'],['x-max','xmax'],['y-mode','ymode']])$('#'+id).value=state[key];$('#y-min').value=state.ymin??'';$('#y-max').value=state.ymax??'';}
function applyRange(){
 const min=Number($('#x-min').value),max=Number($('#x-max').value),ymode=$('#y-mode').value;
 const ymin=$('#y-min').value===''?null:Number($('#y-min').value),ymax=$('#y-max').value===''?null:Number($('#y-max').value);
 if(!Number.isInteger(min)||!Number.isInteger(max)||min<1||max>30||min>=max){showNotice('轮次范围：1–30，起始值须小于结束值。');return;}
 if(ymode==='manual'&&(!(ymin>=0)||!Number.isFinite(ymax)||ymax<=ymin||ymin===null)){showNotice('请输入有效的纵轴范围：0 ≤ 最小值 < 最大值。');return;}
 Object.assign(state,{xmin:min,xmax:max,ymode,ymin,ymax});showNotice('');renderCharts();
}
function download(name,text,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
function csvCell(v){return '"'+String(v??'').replace(/"/g,'""')+'"';}
$('#csv').onclick=()=>{
 const head=['dataset','model','effort','method','round','role','status','review','mean_ms','p10_ms','p90_ms','samples','pytorch_ms','pytorch_speedup','finished_at'];
 const rows=roundRows().map(({r,p})=>[data.id,r.model,r.effort,r.method,p.round,p.role,p.status,p.review,p.timing?.mean_ms,p.timing?.p10_ms,p.timing?.p90_ms,p.timing?.sample_count,p.pytorch?.mean_ms,p.timing&&p.pytorch?p.pytorch.mean_ms/p.timing.mean_ms:null,r.finished_at]);
 selected().filter(r=>$('#round-run').value==='all'||$('#round-run').value===r.id).forEach(r=>{if(r.formal&&['all','passed'].includes($('#round-status').value))rows.push([data.id,r.model,r.effort,r.method,'Final','candidate','passed','independent',r.formal.mean_ms,r.formal.p10_ms,r.formal.p90_ms,r.formal.sample_count,r.formal_pytorch?.mean_ms,r.formal_pytorch?r.formal_pytorch.mean_ms/r.formal.mean_ms:null,r.finished_at]);});
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
$('#reset').onclick=()=>{Object.assign(state,{xmin:1,xmax:30,ymode:'focus',ymin:null,ymax:null});syncRange();showNotice('');renderCharts();};
new ResizeObserver(()=>{if(category==='kl')renderKL();else if(data)renderCharts();}).observe($('main'));
$$('[data-category]').forEach(b=>b.onclick=()=>chooseCategory(b.dataset.category));
setCategory(category);
setInterval(()=>{if(!document.hidden){renderNextUpdate();refresh();}},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('popstate',()=>{const url=new URL(location);setCategory(url.searchParams.get('category'));if(category==='kl')loadKL(url.searchParams.get('dataset')||'GQA');else loadDataset(url.searchParams.get('dataset')||'GQA',true,url.searchParams.get('run'));});
refresh();
