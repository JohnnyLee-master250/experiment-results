'use strict';
let klData=null,klRun=null,klApply=null,klSequence=0;
let klReference=null;
const klReferenceCache=new Map(),klReferenceVisible={overview:true,candidates:true};
const klMatchedVisible={overview:{same:true,reduced:true},candidates:{same:true,reduced:true}};
function selectV0AstraReference(dataset,roundLimit=Infinity){
 const run=dataset.runs.find(r=>r.model==='Astra'&&r.effort==='high'&&r.method==='V0'&&r.status==='complete');
 if(!run)return null;
 const points=run.search.filter(p=>p.round<=roundLimit&&p.status==='passed'&&Number.isFinite(p.timing?.mean_ms)&&p.timing.mean_ms>0);
 if(!points.length)return null;
 const best=points.reduce((a,b)=>a.timing.mean_ms<=b.timing.mean_ms?a:b);
 return {latency_ms:best.timing.mean_ms,round:best.round,run_id:run.id,environment:run.environment};
}
function klMatchedReferences(dataset,run){
 const latest=run?.aligned?.count;
 if(!dataset||!Number.isInteger(latest)||latest<1)return [];
 const v0=dataset.runs.find(r=>r.model==='Astra'&&r.effort==='high'&&r.method==='V0'&&r.status==='complete');
 if(!v0)return [];
 return [{kind:'same',requested:latest,color:'#D55E00',dash:'7 4'},
         {kind:'reduced',requested:Math.floor(latest*2/3),color:'#6F61A6',dash:'3 4'}].map(spec=>{
  const limit=Math.min(30,v0.budget??30,spec.requested);
  const ref=selectV0AstraReference(dataset,limit);
  return ref?{...ref,...spec,limit,caption:`V0 ${spec.kind==='same'?'同轮次':'2/3 轮次'} · 截至 r${limit} 最快 · ${fmt(ref.latency_ms)} ms`}:null;
 }).filter(Boolean);
}
function klAxisAnnotations(run){
 const applies=new Map(),candidates=new Map();
 if(!run?.aligned)return {applies,candidates};
 const aligned=new Map(run.aligned.points.map(p=>[`${p.apply}:${p.inner_sequence}`,p]));
 let round=0,elapsed=0,timeKnown=true;
 for(const a of [...run.applies].sort((a,b)=>a.apply-b.apply)){
  const ordered=[...a.candidates],ticks=new Map();
  if(ordered.length&&ordered.every(c=>c.recorded_at))ordered.sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at)||a.sequence-b.sequence);
  for(const c of ordered){
   const p=aligned.get(`${a.apply}:${c.sequence}`);
   if(p?.counted)round=p.round;
   ticks.set(c.sequence,{text:`${c.sequence}(r${round})`,detail:`内部候选 ${c.sequence} · 累计 r${round}${c.reused?' · 复用，不增加轮次':!p?.counted?' · 本条不计轮次':''}`});
  }
  candidates.set(a.apply,ticks);
  if(a.status!=='completed'||!Number.isFinite(a.elapsed_seconds)||a.elapsed_seconds<0)timeKnown=false;
  if(timeKnown)elapsed+=a.elapsed_seconds;
  if(a.status==='completed')applies.set(a.apply,{
   text:`${a.apply}(r${round} ${timeKnown?Math.round(elapsed/60)+'min':'时间未知'})`,
   detail:`Apply ${a.apply} 完成 · 累计 r${round} · ${timeKnown?'累计用时 '+fmt(elapsed/60,2)+' 分钟（已扣除记录的暂停）':'累计用时缺失'}`
  });
 }
 return {applies,candidates};
}
const KL_LABELS={not_run:'未开始',running:'运行中',complete:'已完成',ended:'待验收',waiting:'等待中',blocked:'已暂停',paused:'已暂停',completed:'已交付',failed:'失败',interrupted:'中断',unknown:'待核对',passed:'通过',infrastructure_error:'基础设施异常'};
function klStatus(s){return KL_LABELS[s]||'待核对';}
function setCategory(id){
 category=['kl','aligned'].includes(id)?id:'bv';
 $('#bv-panel').hidden=category!=='bv';$('#kl-panel').hidden=category!=='kl';$('#aligned-panel').hidden=category!=='aligned';
 $$('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
}
async function chooseCategory(id){
 setCategory(id);initialRun=null;
 return category==='kl'?loadKL(datasetId):category==='aligned'?loadAligned(datasetId):loadDataset(datasetId,true);
}
async function loadKL(id){
 const seq=++klSequence;++loadSeq;++alignedSequence;setCategory('kl');datasetId=id;
 try{
  if(!klData||klData.updated_at!==manifest.updated_at)klData=await getJSON(`./api/v1/${manifest.kl.url}?v=${encodeURIComponent(manifest.updated_at)}`);
  const meta=manifest.datasets.find(d=>d.id===id),key=`${manifest.updated_at}:${id}`;
  if(!klReferenceCache.has(key)){
   const dataset=await getJSON(`./api/v1/${meta.url}?v=${encodeURIComponent(manifest.updated_at)}`);
   if(dataset.updated_at!==manifest.updated_at)throw Error('参考曲线发布版本尚在同步');
   klReferenceCache.set(key,selectV0AstraReference(dataset));klDatasetCache.set(key,dataset);
  }
  if(seq!==klSequence||category!=='kl')return;
  if(klData.updated_at!==manifest.updated_at)throw Error('发布版本尚在同步');
  klReference=klReferenceCache.get(key);
  const runs=klData.runs.filter(r=>r.dataset===id);klRun=runs.find(r=>r.id===new URL(location).searchParams.get('run'))||runs[0];
  const wanted=Number(new URL(location).searchParams.get('apply'));
  if(!klRun?.applies.some(a=>a.apply===klApply))klApply=klRun?.applies.at(-1)?.apply??null;
  if(wanted&&klRun?.applies.some(a=>a.apply===wanted))klApply=wanted;
  const url=new URL(location);url.searchParams.set('category','kl');url.searchParams.set('dataset',id);url.searchParams.delete('run');url.searchParams.delete('apply');
  history.replaceState(null,'',url);renderNav();renderKL();showNotice('');
  $('#updated').textContent=date(manifest.updated_at);$('#updated').dateTime=manifest.updated_at;
 }catch(e){if(seq===klSequence&&category==='kl'){$('#connection').classList.add('stale');showNotice(`KL 数据读取失败，保留上次快照 · ${e.message}`);}}
}
function selectApply(index){
 klApply=Number(index);const url=new URL(location);url.searchParams.set('category','kl');url.searchParams.set('dataset',datasetId);url.searchParams.set('apply',String(index));url.hash='kl-inner';history.replaceState(null,'',url);renderKL();
}
function klChart(target,points,label,maxX,selectable=false,reference=null,axisTicks=new Map(),extraReferences=[]){
 const el=$(target),values=points.filter(p=>Number.isFinite(p.y)&&p.y>0);
 const references=[...(reference?[{...reference,kind:'full',color:'#CC79A7',dash:'8 4',caption:`V0 Astra/high 全程最快搜索均值：${fmt(reference.latency_ms)} ms，第 ${reference.round} 轮`}]:[]),...extraReferences];
 if(!values.length&&!references.length){el.innerHTML='<div class="kl-empty">暂无有效测量<br><small>结果保存后自动更新，缺失值不补成 0。</small></div>';return;}
 const w=Math.max(el.clientWidth||600,300),h=330;
 const longest=Math.max(1,...[...axisTicks.values()].map(t=>t.text.length))*6;
 const rotate=longest>(w-110)/Math.max(1,maxX-1)-6;
 const pad={l:rotate?82:58,r:24,t:24,b:rotate?115:45};
 const ymax=Math.max(...values.map(p=>p.y),...points.map(p=>p.best||0),...references.map(r=>r.latency_ms))*1.12;
 const x=v=>pad.l+(v-1)/Math.max(1,maxX-1)*(w-pad.l-pad.r),y=v=>h-pad.b-v/ymax*(h-pad.t-pad.b);
 let grid='',line='',bestLine='',last=null,lastBest=null;
 for(let i=0;i<=4;i++){const v=ymax*i/4;grid+=`<line x1="${pad.l}" x2="${w-pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#edf0f4"/><text x="${pad.l-8}" y="${y(v)+4}" text-anchor="end">${fmt(v,3)}</text>`;}
 for(let i=1;i<=maxX;i++){
  if(maxX>25&&i!==1&&i!==maxX&&i%5)continue;
  const tick=axisTicks.get(i),yy=h-pad.b+20;
  grid+=`<text class="kl-axis-tick" data-x="${i}" x="${x(i)}" y="${yy}" text-anchor="${rotate?'end':i===1?'start':i===maxX?'end':'middle'}" ${rotate?`transform="rotate(-60 ${x(i)} ${yy})"`:''}>${esc(tick?.text||String(i))}<title>${esc(tick?.detail||`${label} ${i}`)}</title></text>`;
 }
 for(const p of points){
  if(p.y!=null){line+=(last?' L':'M')+`${x(p.x)},${y(p.y)}`;last=p;}else last=null;
  if(p.best!=null){bestLine+=(lastBest?` H${x(p.x)} V${y(p.best)}`:`M${x(p.x)},${y(p.best)}`);lastBest=p;}
 }
 el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><text x="12" y="16">ms ↓</text>${grid}<path d="${bestLine}" fill="none" stroke="#009E73" stroke-width="2" stroke-dasharray="5 3"/><path d="${line}" fill="none" stroke="#0072B2" stroke-width="2"/>${values.map(p=>`<circle cx="${x(p.x)}" cy="${y(p.y)}" r="${selectable&&p.x===klApply?6:4}" fill="#0072B2" ${selectable?`data-apply-point="${p.x}" role="button" tabindex="0" aria-label="选择 Apply ${p.x}，${fmt(p.y)} 毫秒"`:''}><title>${esc(label)} ${p.x}: ${fmt(p.y)} ms</title></circle>`).join('')}<text x="${w/2}" y="${h-1}" text-anchor="middle">${esc(label)}</text></svg>`;
 if(references.length){
  const svg=el.querySelector('svg');
  for(const ref of references)svg.insertAdjacentHTML('beforeend',`<line class="${ref.kind==='full'?'kl-v0-reference':'kl-v0-matched'}" data-reference="${ref.kind}" x1="${pad.l}" x2="${w-pad.r}" y1="${y(ref.latency_ms)}" y2="${y(ref.latency_ms)}" stroke="${ref.color}" stroke-width="2" stroke-dasharray="${ref.dash}"><title>${esc(ref.caption)}${ref.kind==='full'?'':` · 最快记录为 r${ref.round}`}</title></line>`);
  if(!values.length)svg.insertAdjacentHTML('beforeend',`<text x="${w/2}" y="${h/2}" text-anchor="middle">暂无 KL 有效测量</text>`);
 }
 el.querySelectorAll('[data-apply-point]').forEach(p=>{p.onclick=()=>selectApply(p.dataset.applyPoint);p.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectApply(p.dataset.applyPoint);}};});
}
function renderKL(){
 if(category!=='kl'||!manifest)return;
 const meta=manifest.datasets.find(d=>d.id===datasetId);renderAligned('#kl-aligned',klDatasetCache.get(`${manifest.updated_at}:${datasetId}`),klRun);$('#kl-name').textContent=(meta?.title||datasetId)+' · KL';
 if(!klData){$('#kl-body').hidden=true;$('#kl-state').textContent='正在读取 KL 数据…';return;}
 if(!klRun){$('#kl-body').hidden=true;$('#kl-state').textContent='此测试集尚未登记 KL 实验';return;}
 $('#kl-body').hidden=false;const r=klRun,done=r.applies.filter(a=>a.status==='completed').length;
 $('#kl-state').textContent=`${r.model} / ${r.effort} · ${klStatus(r.status)} · ${r.phase||''}`;
 $('#kl-budget').textContent=`已交付 ${done} / ${r.budget} Apply · 每 Apply ${r.apply_timeout_seconds/60} 分钟 · 额外重试 ${r.max_retries} · 单次评测/诊断 ${r.evaluation_timeout_seconds/60} 分钟`;
 $('#kl-run-info').textContent=`开始 ${date(r.started_at)} · 独立完成 ${date(r.finished_at)} · 候选评测 ${r.applies.reduce((n,a)=>n+a.evaluations,0)} 次`;
 $('#kl-apply').innerHTML=r.applies.map(a=>`<option value="${a.apply}" ${a.apply===klApply?'selected':''}>Apply ${a.apply} · ${klStatus(a.status)}</option>`).join('')||'<option value="">暂无 Apply</option>';
 $('#kl-apply').disabled=!r.applies.length;$('#kl-apply').value=klApply==null?'':String(klApply);$('#kl-apply').onchange=e=>selectApply(e.target.value);
 let best=null;const points=r.applies.map(a=>{const v=a.delivered?.accepted?a.delivered.latency_ms:null;if(v!=null)best=best==null?v:Math.min(best,v);return {x:a.apply,y:v,best};});
 const axes=klAxisAnnotations(r),matched=klMatchedReferences(klDatasetCache.get(`${manifest.updated_at}:${datasetId}`),r);
 for(const chart of ['overview','candidates']){
  const toggle=$(`#kl-v0-${chart}`);toggle.disabled=!klReference;toggle.checked=!!klReference&&klReferenceVisible[chart];
  toggle.onchange=()=>{klReferenceVisible[chart]=toggle.checked;renderKL();};
  $(`#kl-v0-${chart}-label`).textContent=klReference?`V0 Astra/high 最快线 · ${fmt(klReference.latency_ms)} ms`:'无对应 V0 Astra 结果';
  $(`#kl-matched-${chart}`).innerHTML=['same','reduced'].map(kind=>{
   const ref=matched.find(r=>r.kind===kind),text=ref?.caption||`V0 ${kind==='same'?'同轮次':'2/3 轮次'} · 暂无对应轮次的有效结果`;
   return `<label class="kl-reference-toggle" style="color:${ref?.color||'#76818f'}"><input type="checkbox" data-matched-kind="${kind}" ${ref&&klMatchedVisible[chart][kind]?'checked':''} ${ref?'':'disabled'} style="accent-color:${ref?.color||'#76818f'}"><span>${esc(text)}</span></label>`;
  }).join('');
  $(`#kl-matched-${chart}`).querySelectorAll('input').forEach(toggle=>toggle.onchange=()=>{klMatchedVisible[chart][toggle.dataset.matchedKind]=toggle.checked;renderKL();});
 }
 klChart('#kl-overview',points,'Apply',r.budget,true,klReferenceVisible.overview?klReference:null,axes.applies,matched.filter(ref=>klMatchedVisible.overview[ref.kind]));
 const a=r.applies.find(a=>a.apply===klApply),inner=a?.candidates||[];best=null;
 klChart('#kl-candidates',inner.map(c=>{const v=c.correctness_passed?c.latency_ms:null;if(c.accepted&&v!=null)best=best==null?v:Math.min(best,v);return {x:c.sequence,y:v,best};}),'内部候选序号',Math.max(2,inner.length),false,klReferenceVisible.candidates?klReference:null,axes.candidates.get(klApply),matched.filter(ref=>klMatchedVisible.candidates[ref.kind]));
 $('#kl-inner-status').textContent=a?`${klStatus(a.status)} · 已用 ${a.elapsed_seconds==null?'未知':fmt(a.elapsed_seconds/60,1)+' 分钟'} · ${a.evaluations} 次评测 · ${a.infrastructure_errors} 次基础设施异常 · ${a.reused_snapshots} 份结果复用快照`:'尚未启动；候选次数没有预设上限，受 Apply 时限约束。';
 $('#kl-candidate-rows').innerHTML=inner.map(c=>`<tr><td>${c.sequence}</td><td>${klStatus(c.status)}</td><td>${({compile:'编译',correctness:'正确性',performance:'性能门禁'})[c.stage]||'—'}</td><td>${c.accepted?'通过':c.correctness_passed?'正确性通过':'—'}</td><td class="num">${fmt(c.latency_ms)}</td><td class="num">${fmt(c.reference_latency_ms)}</td><td>${c.reused?'复用，不新增评测':'新记录'}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">暂无候选评测记录</td></tr>';
 $('#kl-apply-rows').innerHTML=r.applies.map(a=>`<tr><td><button data-apply-row="${a.apply}">Apply ${a.apply}</button></td><td>${klStatus(a.status)}</td><td>${a.evaluations}</td><td>${a.infrastructure_errors}</td><td class="num">${fmt(a.delivered?.latency_ms)}</td><td class="num">${a.elapsed_seconds==null?'—':fmt(a.elapsed_seconds/60,1)}</td><td>${date(a.ended_at)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">已登记任务，等待正式启动</td></tr>';
 $$('[data-apply-row]').forEach(b=>b.onclick=()=>selectApply(b.dataset.applyRow));
 $('#kl-events').innerHTML=(klData.task_events||[]).filter(e=>e.run_id===r.id).map(e=>`<li class="task-event kl-task-event"><time datetime="${esc(e.at)}">${date(e.at)}</time><span class="event-tag ${esc(e.kind)}">${({started:'开始',paused:'暂停',resumed:'恢复',completed:'独立完成'})[e.kind]||'待核对'}</span><p>${esc(e.reason)}</p></li>`).join('')||'<li class="empty">尚未开始，启动后自动记录。</li>';
 $('#kl-path').textContent=r.workspace_path||'实际优化工作区在正式启动时创建。';
 $('#kl-copy').disabled=!r.workspace_path;$('#kl-copy').onclick=async()=>{await navigator.clipboard.writeText(r.workspace_path);$('#kl-copy').textContent='已复制';};
 $('#kl-json').onclick=()=>download(`kl-${datasetId}.json`,JSON.stringify(r,null,2),'application/json');
 $('#kl-csv').onclick=()=>{const lines=['apply,candidate,status,latency_ms,reference_latency_ms,accepted,reused'];for(const a of r.applies)for(const c of a.candidates)lines.push([a.apply,c.sequence,c.status,c.latency_ms??'',c.reference_latency_ms??'',c.accepted,c.reused].join(','));download(`kl-${datasetId}-candidates.csv`,lines.join('\n'),'text/csv');};
}

// A shared view: only reads published numeric results, never changes experiments.
let alignedSequence=0,alignedDataset=null,alignedRun=null;
const alignedViews=new Map(),klDatasetCache=new Map();
function alignedSeries(dataset,run){
 const series=dataset.runs.filter(r=>r.method!=='B0'&&r.search.length).map(r=>({
  id:r.id,model:r.model,effort:r.effort,method:r.method,color:COLORS[r.method],dash:DASH[r.model]||'',
  points:r.search.map(p=>({round:p.round,y:p.status==='passed'?p.timing?.mean_ms??null:null,status:p.status}))
 }));
 if(run)series.push({id:run.id,model:run.model,effort:run.effort,method:'Aligned KL',color:'#E69F00',dash:DASH[run.model]||'',
  points:(run.aligned?.points||[]).filter(p=>p.counted).map(p=>({...p,y:p.latency_ms}))});
 return series;
}
async function loadAligned(id){
 const seq=++alignedSequence;++klSequence;++loadSeq;setCategory('aligned');
 const meta=manifest.datasets.find(d=>d.id===id)||manifest.datasets[0];datasetId=meta.id;
 try{
  const [d,k]=await Promise.all([
   cache.get(meta.id)||getJSON(`./api/v1/${meta.url}?v=${encodeURIComponent(manifest.updated_at)}`),
   klData?.updated_at===manifest.updated_at?klData:getJSON(`./api/v1/${manifest.kl.url}?v=${encodeURIComponent(manifest.updated_at)}`)
  ]);
  if(seq!==alignedSequence||category!=='aligned')return;
  if(d.updated_at!==manifest.updated_at||k.updated_at!==manifest.updated_at)throw Error('发布版本尚在同步');
  cache.set(meta.id,d);klData=k;alignedDataset=d;alignedRun=k.runs.find(r=>r.dataset===meta.id);needsReload=false;
  const url=new URL(location);url.searchParams.set('category','aligned');url.searchParams.set('dataset',meta.id);url.searchParams.delete('apply');url.searchParams.delete('run');history.replaceState(null,'',url);
  $('#aligned-name').textContent=`${d.title} · Aligned KL`;
  renderNav();renderAligned('#aligned-content',d,alignedRun);showNotice('');
  $('#updated').textContent=date(manifest.updated_at);$('#updated').dateTime=manifest.updated_at;
 }catch(e){if(seq===alignedSequence&&category==='aligned'){needsReload=true;showNotice(`Aligned KL 读取失败，保留上次快照 · ${e.message}`);}}
}
function renderAligned(target,dataset,run){
 const host=$(target);if(!host||!dataset)return;
 const all=alignedSeries(dataset,run),key=dataset.id;
 if(!alignedViews.has(key))alignedViews.set(key,{visible:new Set(all.filter(r=>r.model==='Astra').map(r=>r.id)),mode:'best',zoom:false});
 const view=alignedViews.get(key),selected=all.filter(r=>view.visible.has(r.id)),points=run?.aligned?.points||[];
 const redraw=()=>renderAligned(target,dataset,run);
 host.innerHTML=`<p class="kl-caption aligned-note">按时间顺序展开内部评测：rN 为累计有效评测次数，失败占一轮；复用和基础设施异常不计轮数。B/V 为均值，KL 为中位数，预算、effort 与环境不同。B0 仅正确性，不画速度线。</p>
 <div class="aligned-controls">${[...new Set(all.map(r=>r.model))].map(model=>`<div class="model-group"><div class="model-heading"><strong>${esc(model)}</strong><label class="aligned-all"><input type="checkbox" data-aligned-model="${esc(model)}" ${all.filter(r=>r.model===model).every(r=>view.visible.has(r.id))?'checked':''}> 全部</label></div><div class="chips">${all.filter(r=>r.model===model).map(r=>`<label class="chip ${view.visible.has(r.id)?'active':''}" style="--color:${r.color}"><input type="checkbox" data-aligned-run="${esc(r.id)}" ${view.visible.has(r.id)?'checked':''}>${esc(r.method)} <small>${esc(r.effort)}</small></label>`).join('')}</div></div>`).join('')}</div>
 <div class="plot-options"><div class="segments"><button data-aligned-mode="best" aria-pressed="${view.mode==='best'}" class="${view.mode==='best'?'selected':''}">搜索最优</button><button data-aligned-mode="raw" aria-pressed="${view.mode==='raw'}" class="${view.mode==='raw'?'selected':''}">逐次测量</button></div><label><input data-aligned-zoom type="checkbox" ${view.zoom?'checked':''}> 收敛放大</label><span>● 测量 · — 最优阶梯 · × 失败</span><button data-aligned-csv>展开记录 CSV ↓</button></div>
 <div class="chart aligned-chart" tabindex="0" role="img" aria-label="Aligned KL 与 B/V 按有效评测次数对比"></div><div class="readout aligned-readout" aria-live="polite"></div>
 <details class="data-section"><summary>KL 展开记录 · r${run?.aligned?.count||0}${run?.aligned?.excluded_count?' · '+run.aligned.excluded_count+' 条不计轮次':''}</summary><div class="table-wrap rounds-wrap"><table><thead><tr><th>累计轮次</th><th>Apply</th><th>内部序号</th><th>结果</th><th>延迟 ms</th><th>记录时间 SGT</th></tr></thead><tbody>${points.map(p=>`<tr><td>${p.counted?'r'+p.round:'不计轮次'}</td><td>${p.apply}</td><td>${p.inner_sequence}</td><td>${klStatus(p.status)}</td><td>${fmt(p.latency_ms)}</td><td>${date(p.recorded_at)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">暂无 KL 内部评测；保存后自动更新</td></tr>'}</tbody></table></div></details>`;
 host.querySelectorAll('[data-aligned-run]').forEach(el=>el.onchange=()=>{el.checked?view.visible.add(el.dataset.alignedRun):view.visible.delete(el.dataset.alignedRun);redraw();});
 host.querySelectorAll('[data-aligned-model]').forEach(el=>{const ids=all.filter(r=>r.model===el.dataset.alignedModel).map(r=>r.id),n=ids.filter(id=>view.visible.has(id)).length;el.indeterminate=n>0&&n<ids.length;el.onchange=()=>{for(const id of ids)el.checked?view.visible.add(id):view.visible.delete(id);redraw();};});
 host.querySelectorAll('[data-aligned-mode]').forEach(el=>el.onclick=()=>{view.mode=el.dataset.alignedMode;redraw();});
 host.querySelector('[data-aligned-zoom]').onchange=e=>{view.zoom=e.target.checked;redraw();};
 host.querySelector('[data-aligned-csv]').onclick=()=>download(`aligned-kl-${dataset.id}.csv`,['round,apply,inner_sequence,status,counted,latency_ms,recorded_at',...points.map(p=>[p.round,p.apply,p.inner_sequence,p.status,p.counted,p.latency_ms,p.recorded_at].map(csvCell).join(','))].join('\n'),'text/csv');
 const chart=host.querySelector('.aligned-chart'),w=Math.max(320,chart.clientWidth||800),h=340,pad={l:66,r:20,t:26,b:45},maxX=Math.max(30,...all.flatMap(r=>r.points.map(p=>p.round)));
 let values=selected.flatMap(r=>r.points.filter(p=>p.y!=null).map(p=>p.y)),ymin=0,ymax=Math.max(.001,...values)*1.08;
 if(view.zoom&&values.length){const tails=selected.map(r=>Math.min(...r.points.filter(p=>p.y!=null).map(p=>p.y))).filter(Number.isFinite);if(tails.length){const lo=Math.min(...tails),hi=Math.max(...tails),space=Math.max((hi-lo)*.15,hi*.035,.000001);ymin=Math.max(0,lo-space);ymax=hi+space;}}
 const x=n=>pad.l+(n-1)/Math.max(1,maxX-1)*(w-pad.l-pad.r),y=n=>h-pad.b-(n-ymin)/(ymax-ymin)*(h-pad.t-pad.b),clip='aligned-clip-'+target.replace(/[^a-z]/g,'');
 let svg=`<svg viewBox="0 0 ${w} ${h}" role="img"><title>Aligned KL，横轴为有效评测序号，纵轴为延迟毫秒</title><defs><clipPath id="${clip}"><rect x="${pad.l}" y="${pad.t}" width="${w-pad.l-pad.r}" height="${h-pad.t-pad.b}"/></clipPath></defs>`;
 for(const v of ticks(ymin,ymax,5))svg+=`<line x1="${pad.l}" x2="${w-pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#edf0f4"/><text x="${pad.l-8}" y="${y(v)+4}" text-anchor="end">${tickFmt(v)}</text>`;
 for(const v of [...new Set([1,...ticks(1,maxX,w<500?4:8).filter(Number.isInteger),maxX])])svg+=`<text x="${x(v)}" y="${h-22}" text-anchor="middle">${v}</text>`;
 svg+=`<text x="12" y="16">ms ↓</text><text x="${w/2}" y="${h-3}" text-anchor="middle">有效评测序号 · KL rN / B、V 轮次</text><g clip-path="url(#${clip})">`;
 for(const r of selected){let best=null,path='',last=false;for(const p of r.points){if(p.y!=null)best=best==null?p.y:Math.min(best,p.y);const v=view.mode==='best'?best:p.y;if(v==null){last=false;continue;}path+=last?(view.mode==='best'?` H${x(p.round)} V${y(v)}`:` L${x(p.round)},${y(v)}`):` M${x(p.round)},${y(v)}`;last=true;}
  svg+=`<path data-aligned-curve="${esc(r.id)}" d="${path}" fill="none" stroke="${r.color}" stroke-width="${r.method==='Aligned KL'?2.6:1.8}" stroke-dasharray="${r.dash}"/>`;
  for(const p of r.points){if(p.y!=null)svg+=`<circle cx="${x(p.round)}" cy="${y(p.y)}" r="3" fill="${r.color}"><title>${esc(r.model+' '+r.method)} r${p.round}${p.apply?' · Apply '+p.apply+' / 内部 '+p.inner_sequence:''}: ${fmt(p.y)} ms</title></circle>`;else if(p.status==='failed')svg+=`<path d="M${x(p.round)-3},${h-pad.b-9}l6 6m0 -6l-6 6" stroke="${r.color}"/>`;}
 }
 svg+='</g></svg>';chart.innerHTML=svg;
 const readout=host.querySelector('.aligned-readout');
 function inspect(n){readout.innerHTML=`<strong>r${n}</strong>`+selected.map(r=>{const p=r.points.find(p=>p.round===n);return `<span style="--color:${r.color}"><i class="swatch"></i>${esc(r.model+' '+r.method)} ${p?.apply?'Apply '+p.apply+' · ':''}<strong>${fmt(p?.y)}</strong>${p?.y!=null?' ms':p?' · '+(p.status==='failed'?'失败':'无有效计时'):' · 无记录'}</span>`;}).join('');}
 let cursor=run?.aligned?.count||1;inspect(cursor);
 chart.onpointermove=e=>{cursor=Math.min(maxX,Math.max(1,Math.round(1+(e.clientX-chart.getBoundingClientRect().left-pad.l)/(w-pad.l-pad.r)*(maxX-1))));inspect(cursor);};
 chart.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();cursor=Math.max(1,Math.min(maxX,cursor+(e.key==='ArrowRight'?1:-1)));inspect(cursor);}};
 if(!values.length)readout.insertAdjacentHTML('afterbegin','<span>所选曲线暂无有效计时</span>');
 if(view.zoom)readout.insertAdjacentHTML('afterbegin',`<span>放大范围 ${fmt(ymin)}–${fmt(ymax)} ms，范围外测量已裁剪</span>`);
}
