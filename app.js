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
function requestedBVEdition(){const id=new URL(location).searchParams.get('edition');return ['v0-r3','bn-r2'].includes(id)?id:'legacy';}
let bvEdition=requestedBVEdition();
function methodLabel(run){return run?.method_version||(run?.method==='V0'?'V0-r2':run?.method)||'';}
function roundBudget(){return Math.max(...(data?.runs||[]).map(r=>r.budget||30),bvEdition==='legacy'?30:50);}
function editionKey(dataset){return dataset.id+':'+(dataset.edition||'legacy');}

let category=["kl","aligned"].includes(new URL(location).searchParams.get("category"))?new URL(location).searchParams.get("category"):"bv";
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
 else if(category==='aligned')renderAligned('#aligned-content',alignedDataset,alignedRun);
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
async function getJSON(url){const base=document.body.dataset.apiBase;const target=base?new URL(url,new URL(base,location.href)).href:url;const response=await fetch(target,{cache:'no-cache'});if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json();}
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
  if(changed||force||needsReload){cache.clear();renderNav();renderRunning();if(category==="kl")await loadKL(datasetId);else if(category==="aligned")await loadAligned(datasetId);else await loadDataset(datasetId,!data||data.id!==datasetId,initialRun);if(!needsReload)initialRun=null;}
 }catch(e){$('#connection').classList.add('stale');showNotice(`更新暂不可用${data?'，保留上次数据':''} · ${e.message}`);}
 finally{$('#refresh').disabled=false;}
}
function renderNav(){
 $('#datasets').innerHTML=manifest.datasets.map(d=>`<button type="button" data-dataset="${esc(d.id)}" aria-current="${d.id===datasetId}">${esc(d.id)}</button>`).join('');
 $$('[data-dataset]').forEach(b=>b.onclick=()=>category==="kl"?loadKL(b.dataset.dataset):category==="aligned"?loadAligned(b.dataset.dataset):loadDataset(b.dataset.dataset,true));
}
function renderRunning(){
 const runs=[...(manifest.running_runs||[]),...(manifest.kl?.running_runs||[])];
 $('#running-count').textContent=`${runs.length} 组`;
 $('#running-links').innerHTML=runs.map(r=>{
  const href=`?${new URLSearchParams({dataset:r.dataset,run:r.id,category:r.category||'bv'})}${r.category==='kl'?'#kl-overview':'#curves'}`;
 const phase={reviewing:'审查中',evaluating:'评测中',profiling:'测量中',ready:'运行中',initializing:'准备中',finished:'收尾中',queued:'排队中'}[r.phase]||'运行中';
  return `<a class="running-link ${focusedRun===r.id?'current':''}" href="${esc(href)}" data-category-target="${r.category||'bv'}" data-running="${esc(r.id)}" data-target="${esc(r.dataset)}" style="--color:${COLORS[r.method]||'#526c89'}" title="${esc(r.model+' / '+r.effort)} · 已记录 ${r.reported_attempts}/${r.budget} 轮；待审查记录不代表独立完成"><span class="swatch"></span><strong>${esc(r.dataset)} · ${esc(r.model)} ${esc(methodLabel(r))}</strong><span class="running-round">${r.category==='kl'?(r.current_apply??r.reported_attempts):r.reported_attempts}<span> / ${r.budget} ${r.category==='kl'?'Apply · r'+(r.internal_round??0):'轮'}</span></span><span class="running-phase">${phase}</span><span aria-hidden="true">↗</span></a>`;
 }).join('')||'<span class="running-empty">当前没有运行中的实验，各组状态见下方</span>';
 const waiting=manifest.waiting_runs||manifest.kl?.waiting_runs||[];
 const cards=manifest.waiting_cards||manifest.kl?.waiting_cards||[];
 const scrollPositions=new Map($$('#waiting-links .waiting-list').map(el=>[el.dataset.card,el.scrollTop]));
 $('#waiting-bar').hidden=!cards.length;
 $('#waiting-count').textContent=`${waiting.length} 组`;
 $('#waiting-links').innerHTML=cards.map(card=>`<section class="waiting-card" aria-labelledby="waiting-${esc(card.id)}"><div class="waiting-card-heading"><strong id="waiting-${esc(card.id)}">${esc(card.label)}</strong><span class="waiting-environment">${esc(card.environment_name)}</span><span class="waiting-card-count">${card.runs.length} 组</span></div><ol class="waiting-list" data-card="${esc(card.id)}" tabindex="0" aria-label="${esc(card.label)}等待队列，按执行顺序">${card.runs.map(r=>`<li><a class="running-link waiting-link" href="?category=${r.category||'kl'}&dataset=${esc(r.dataset)}&run=${esc(r.id)}${r.category==='bv'?'#curves':'#kl-overview'}" data-category-target="${r.category||'kl'}" data-running="${esc(r.id)}" data-target="${esc(r.dataset)}"><span class="waiting-position" title="原队列第 ${r.queue_position} 项">${r.queue_position}</span><span class="waiting-task"><strong>${esc(r.dataset)} · ${esc(r.model)} ${esc(methodLabel(r))}</strong><span>${r.reported_attempts} / ${r.budget} ${r.method==='KL'?'Apply':'轮'}</span></span><span aria-hidden="true">↗</span></a></li>`).join('')||'<li class="waiting-empty">暂无等待任务</li>'}</ol></section>`).join('');
 $$('#waiting-links .waiting-list').forEach(el=>{el.scrollTop=scrollPositions.get(el.dataset.card)||0;});
 const campaign=manifest.campaign_runs||[];
 $('#campaign-status').innerHTML=campaign.map(r=>{
  const label=r.status==='complete'?'已完成':r.status==='paused'||r.status==='blocked'?'已暂停':r.status==='running'?'运行中':'未开始';
  return `<a href="?category=bv&dataset=${esc(r.dataset)}&run=${esc(r.id)}#curves" data-campaign-run="${esc(r.id)}" data-target="${esc(r.dataset)}">${esc(r.dataset)} ${esc(methodLabel(r))} <strong>${r.reported_attempts}/${r.budget}</strong><span>${label}</span></a>`;
 }).join('');
 $$('[data-campaign-run]').forEach(a=>a.onclick=e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();loadDataset(a.dataset.target,data?.id!==a.dataset.target,a.dataset.campaignRun,true);});
 $$('[data-running]').forEach(a=>a.onclick=e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();if(a.dataset.categoryTarget==='kl'){return loadKL(a.dataset.target,a.dataset.running);}else return loadDataset(a.dataset.target,data?.id!==a.dataset.target,a.dataset.running,true);});
}
async function loadDataset(id,reset,focusRun=null,push=false){
 if(focusRun)bvEdition=manifest.bv_revisions?.runs.find(r=>r.id===focusRun)?.edition||'legacy';
 reset=reset||data?.edition!==bvEdition;
 setCategory("bv");++klSequence;++alignedSequence;
 const seq=++loadSeq;const meta=manifest.datasets.find(d=>d.id===id)||manifest.datasets[0];datasetId=meta.id;
 try{
  const d=cache.get(meta.id)||await getJSON(`./api/v1/${meta.url}?v=${encodeURIComponent(manifest.updated_at)}`);
  if(seq!==loadSeq||category!=='bv')return;
  if(d.updated_at!==manifest.updated_at)throw Error('发布版本尚在同步');
  cache.set(meta.id,d);data={...d,edition:bvEdition,runs:d.runs.filter(r=>(r.edition||'legacy')===bvEdition)};needsReload=false;
  $('#updated').textContent=date(d.updated_at);$('#updated').dateTime=d.updated_at;
  if(reset){visible=defaultRuns(data,axisMode);costRange=null;Object.assign(state,{xmin:1,xmax:roundBudget(),ymode:'focus',ymin:null,ymax:null});$('#round-run').value='all';}
  else for(const r of data.runs)if(!r.search.length&&!r.formal)visible.delete(r.id);
  if(reset)focusedRun=null;
  const target=focusRun&&data.runs.find(r=>r.id===focusRun);
  if(target){focusedRun=target.id;if(usable(target))visible.add(target.id);Object.assign(state,{xmin:1,xmax:roundBudget(),ymode:'focus',ymin:null,ymax:null});}
  const url=new URL(location);if(bvEdition==='legacy')url.searchParams.delete('edition');else url.searchParams.set('edition',bvEdition);url.searchParams.set('dataset',meta.id);url.searchParams.set('category','bv');url.searchParams.delete('apply');
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
 $('#series-controls').innerHTML=MODELS.filter(m=>data.runs.some(r=>r.model===m)&&(axisMode==='round'||data.runs.some(r=>r.model===m&&r.search.some(p=>p.axes)))).map(model=>{
  const runs=data.runs.filter(r=>r.model===model),effort=runs[0]?.effort||'',available=runs.filter(usable),count=available.filter(r=>visible.has(r.id)).length,all=available.length>0&&count===available.length,mixed=count>0&&!all;
  return `<div class="model-group"><div class="model-heading"><button type="button" data-model="${model}" aria-label="切换 ${model} 全部曲线" ${available.length?'':'disabled'}>${model}</button><span class="effort">${esc(effort)}</span><span class="model-line ${model.toLowerCase()}"></span><label class="model-toggle ${mixed?'mixed':''}" title="${count}/${available.length} 条曲线已显示"><span>${available.length?(all?'全部':mixed?'部分':'关闭'):'无数据'}</span><input type="checkbox" data-model-check="${model}" aria-label="${model} 全部曲线" aria-checked="${mixed?'mixed':String(all)}" ${all?'checked':''} ${available.length?'':'disabled'}><span class="toggle-track" aria-hidden="true"></span></label></div><div class="chips">${METHODS.filter(method=>bvEdition==='legacy'||runs.some(r=>r.method===method)).map(method=>{
   const r=runs.find(x=>x.method===method),on=r&&visible.has(r.id),ok=r&&usable(r);
   return `<label class="chip ${on?'active':''} ${ok?'':'disabled'}" style="--color:${COLORS[method]}" title="${esc(r?LABELS[r.status]:'无数据')}"><input type="checkbox" data-series="${esc(r?.id)}" ${on?'checked':''} ${ok?'':'disabled'} aria-label="${model} ${methodLabel(r)} 曲线">${methodLabel(r)||method}</label>`;
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
 $('#task-events').innerHTML=events.slice(0,eventLimit).map(e=>`<li class="task-event"><time datetime="${esc(e.at)}" title="${esc(e.at)}">${date(e.at)}${e.time_basis==='observed'?'<small>记录时间</small>':''}</time><span class="event-tag ${esc(e.kind)}">${labels[e.kind]||esc(e.kind)}</span><div class="event-runs">${e.runs.map(r=>`<a href="?${new URLSearchParams({dataset:r.dataset,run:r.id,category:r.category||'bv'})}#curves" data-event-run="${esc(r.id)}" data-target="${esc(r.dataset)}">${esc(r.dataset)} · ${esc(r.model)} ${esc(methodLabel(r))} ↗</a>`).join('')}</div><p>${esc(e.reason)}</p></li>`).join('')||'<li class="empty">暂无记录</li>';
 $('#events-more').hidden=eventLimit>=events.length;
 $$('[data-event-run]').forEach(a=>a.onclick=e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();loadDataset(a.dataset.target,data?.id!==a.dataset.target,a.dataset.eventRun,true);});
}
function renderSummary(){
 let previous='';
 $('#summary tbody').innerHTML=data.runs.filter(r=>r.method!=='B0').map(r=>{
  const best=r.search.find(p=>p.round===r.search_best_round),range=best?.timing?`${fmt(best.timing.p10_ms,4)}–${fmt(best.timing.p90_ms,4)}`:'—';
  const group=previous&&previous!==r.model?'group-line':'';previous=r.model;
  return `<tr class="${group}" style="--color:${COLORS[r.method]}"><td><input class="row-check" type="checkbox" data-row="${r.id}" aria-label="显示 ${r.model} ${r.method}" ${visible.has(r.id)?'checked':''} ${usable(r)?'':'disabled'}></td><td><span class="model-label">${r.model}</span><span class="effort-label">${esc(r.effort)}</span></td><td><span class="swatch"></span> ${methodLabel(r)}</td><td>${badge(r.status)}</td><td>${r.reported_attempts} / ${r.budget}</td><td class="date">${date(r.finished_at)}</td><td class="num">${fmt(r.search_best_ms)}</td><td class="num">${range}</td><td class="num">${fmt(r.formal?.mean_ms)}</td><td class="num">${r.formal&&r.formal_pytorch?fmt(r.formal_pytorch.mean_ms/r.formal.mean_ms,3)+'×':'—'}</td></tr>`;
 }).join('');
 $$('[data-row]').forEach(e=>e.onchange=()=>toggle(e.dataset.row,e.checked));
 $('#correctness tbody').innerHTML=data.runs.filter(r=>r.method==='B0').map(r=>`<tr><td>${r.model} <span class="effort-label">${esc(r.effort)}</span></td><td>${r.run_label||methodLabel(r)}</td><td>${badge(r.status)}</td><td>${r.reported_attempts} / ${r.budget}</td><td>${r.accepted===true?'通过':r.accepted===false?'未接受':'—'}</td><td class="date">${date(r.finished_at)}</td></tr>`).join('');
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
 $('#workspace-paths').innerHTML=runs.map(r=>`<div class="workspace-row"><div class="workspace-label"><strong>${esc(r.model)} · ${esc(r.run_label||methodLabel(r))}</strong><span>${esc(r.effort)}</span></div><code>${esc(r.workspace_path)}</code><button type="button" data-copy-workspace="${esc(r.id)}" aria-label="复制 ${esc(r.model+' '+(r.run_label||methodLabel(r)))} 工作区路径">复制</button></div>`).join('')||'<p class="empty">暂无已保存的工作区路径</p>';
 $$('[data-copy-workspace]').forEach(b=>b.onclick=async()=>{const r=runs.find(r=>r.id===b.dataset.copyWorkspace);try{await navigator.clipboard.writeText(r.workspace_path);b.textContent='已复制';}catch{b.textContent='请选中路径复制';}});
}
function renderAll(){if(!data)return;axisControls();renderControls();renderSummary();renderRoundSelector();renderRounds();renderWorkspaces();renderCharts();}
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
  if(state.xmax===roundBudget())runs.forEach(r=>{if(r.formal)values.push(r.formal.mean_ms);});
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
 if(axisMode!=='round') {
  const runs=selected().filter(r=>r.search.some(p=>p.axes));
  const lines=runs.map(r=>({name:r.model+' '+methodLabel(r),id:r.id,color:COLORS[r.method],dash:DASH[r.model],
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
 const xmin=detail?state.xmin:1,xmax=detail?state.xmax:roundBudget(),withFinal=xmax===roundBudget(),finalAt=roundBudget()+(W<500?5:2),xend=withFinal?finalAt+.9:xmax+.25;
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
 function inspect(n){cursor=n;const line=el.querySelector('.crosshair');if(line){line.setAttribute('x1',sx(n===roundBudget()+2?finalAt:n));line.setAttribute('x2',sx(n===roundBudget()+2?finalAt:n));line.setAttribute('visibility','visible');}renderReadout(n);}
 el.onpointermove=e=>{const x=e.clientX-el.getBoundingClientRect().left;if(x<left||x>W-right)return;let n=Math.round(xmin+(x-left)/w*(xend-xmin));if(withFinal&&n>roundBudget())n=roundBudget()+2;inspect(Math.max(xmin,Math.min(withFinal?roundBudget()+2:xmax,n)));};
 el.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();let n=cursor+(e.key==='ArrowRight'?1:-1);if(n===roundBudget()+1)n+=e.key==='ArrowRight'?1:-1;inspect(Math.max(xmin,Math.min(withFinal?roundBudget()+2:xmax,n)));}};
 el.onpointerleave=()=>{el.querySelector('.crosshair')?.setAttribute('visibility','hidden');};
}
function renderReadout(n){
 if(axisMode!=='round')return;
 $('#hover-readout').innerHTML=`<span><strong>${n===roundBudget()+2?'正式结果 ★':'第 '+n+' 轮'}</strong></span>`+selected().map(r=>{
  const p=n===roundBudget()+2?null:r.search.find(p=>p.round===n),m=n===roundBudget()+2?r.formal:p?.timing;
  return `<span style="--color:${COLORS[r.method]}"><i class="swatch"></i>${r.model} ${methodLabel(r)} <strong>${fmt(m?.mean_ms)}</strong>${m?' ms':''}</span>`;
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
 }else Object.assign(state,{xmin:min,xmax:max,ymode,ymin,ymax});showNotice('');renderCharts();
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
$('#reset').onclick=()=>{costRange=null;Object.assign(state,{xmin:1,xmax:roundBudget(),ymode:'focus',ymin:null,ymax:null});syncRange();showNotice('');renderCharts();};
new ResizeObserver(()=>{if(category==='kl')renderKL();else if(category==='aligned')renderAligned('#aligned-content',alignedDataset,alignedRun);else if(data)renderCharts();}).observe($('main'));
$$('[data-category]').forEach(b=>b.onclick=()=>chooseCategory(b.dataset.category));
$$('[data-axis]').forEach(b=>b.onclick=()=>changeAxis(b.dataset.axis));
setCategory(category);axisControls();
setInterval(()=>{if(!document.hidden){renderNextUpdate();refresh();}},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('popstate',()=>{const url=new URL(location);axisMode=requestedAxis();bvEdition=requestedBVEdition();costRange=null;setCategory(url.searchParams.get('category'));axisControls();if(category==='kl')loadKL(url.searchParams.get('dataset')||'GQA');else if(category==='aligned')loadAligned(url.searchParams.get('dataset')||'GQA');else loadDataset(url.searchParams.get('dataset')||'GQA',true,url.searchParams.get('run'));});

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
 for(const v of ticks(lo,hi,width<480?4:7))svg+='<text x="'+x(v)+'" y="'+(height-22)+'" text-anchor="middle">'+tickFmt(v)+'</text>';
 for(const v of (options.binary?[0,1]:ticks(ymin,ymax,5)))svg+='<line x1="'+pad.l+'" x2="'+(width-pad.r)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#edf0f4"/><text x="'+(pad.l-8)+'" y="'+(y(v)+4)+'" text-anchor="end">'+(options.binary?(v?'通过':'未通过'):tickFmt(v))+'</text>';
 svg+='<text x="9" y="15">'+esc(yLabel)+'</text><text x="'+(width/2)+'" y="'+(height-3)+'" text-anchor="middle">'+esc(label)+'</text><g clip-path="url(#'+clip+')">';
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
 el.innerHTML=svg+'</g></svg>';el.tabIndex=0;
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
