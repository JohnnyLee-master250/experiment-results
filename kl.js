'use strict';
let klData=null,klRun=null,klApply=null,klSequence=0;
let klReference=null;
const klRunChoices=new Map();
function selectedKL(runs){
 const wanted=new URL(location).searchParams.get('run')||klRunChoices.get(datasetId);
 return runs.find(r=>r.id===wanted)||runs[0];
}
function selectKLRun(id){
 klRun=klData.runs.find(r=>r.id===id&&r.dataset===datasetId);
 if(!klRun)return;
 klRunChoices.set(datasetId,id);klApply=klRun.applies.at(-1)?.apply??null;
 const url=new URL(location);url.searchParams.set('run',id);url.searchParams.delete('apply');history.replaceState(null,'',url);renderKL();
}
const klReferenceCache=new Map(),klReferenceVisible={overview:true,candidates:true};
const klMatchedVisible={overview:{same:true,reduced:true},candidates:{same:true,reduced:true}};
function selectV0AstraReference(dataset,roundLimit=Infinity){
 const run=dataset.runs.find(r=>!r.edition&&r.model==='Astra'&&r.effort==='high'&&r.method==='V0'&&r.status==='complete');
 if(!run)return null;
 const points=run.search.filter(p=>p.round<=roundLimit&&p.status==='passed'&&Number.isFinite(p.timing?.mean_ms)&&p.timing.mean_ms>0);
 if(!points.length)return null;
 const best=points.reduce((a,b)=>a.timing.mean_ms<=b.timing.mean_ms?a:b);
 return {latency_ms:best.timing.mean_ms,round:best.round,run_id:run.id,environment:run.environment};
}
function klMatchedReferences(dataset,run){
 const latest=run?.aligned?.count;
 if(!dataset||!Number.isInteger(latest)||latest<1)return [];
 const v0=dataset.runs.find(r=>!r.edition&&r.model==='Astra'&&r.effort==='high'&&r.method==='V0'&&r.status==='complete');
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
const KL_LABELS={not_run:'未开始',running:'运行中',complete:'已完成',ended:'待验收',waiting:'等待中',blocked:'已暂停',paused:'已暂停',completed:'已交付',failed:'失败',interrupted:'中断',awaiting_audit:'待验收',unknown:'待核对',passed:'通过',infrastructure_error:'基础设施异常'};
function klStatus(s){return KL_LABELS[s]||'待核对';}
function setCategory(id){
 category=['kl','aligned','all','all-with-b01'].includes(id)?id:'bv';axisControls();
 $('#bv-panel').hidden=category!=='bv';$('#kl-panel').hidden=category!=='kl';$('#aligned-panel').hidden=!isComparison();
 $$('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
}
async function chooseCategory(id){
 setCategory(id);initialRun=null;
 return category==='kl'?loadKL(datasetId):isComparison()?loadAligned(datasetId,null,category):loadDataset(datasetId,true);
}
async function loadKL(id,focusRun=null,focusModel=null){
 const seq=++klSequence;++loadSeq;++alignedSequence;setCategory('kl');datasetId=id;
 const request=beginResultRequest('kl',id,focusRun);
 try{
  const meta=manifest.datasets.find(d=>d.id===id),version=manifest.updated_at,key=`${version}:${id}`;
  const [nextKL,dataset]=await Promise.all([publishedKL(version),datasetJSON(meta,version)]);
  if(seq!==klSequence||category!=='kl')return;
  if(nextKL.updated_at!==manifest.updated_at)throw Error('发布版本尚在同步');
  klData=nextKL;klReferenceCache.set(key,selectV0AstraReference(dataset));klDatasetCache.set(key,dataset);
  klReference=klReferenceCache.get(key);
  const runs=klData.runs.filter(r=>r.dataset===id);klRun=runs.find(r=>r.id===focusRun)||(focusModel&&runs.find(r=>r.model===focusModel))||selectedKL(runs);if(klRun)klRunChoices.set(id,klRun.id);
  const wanted=Number(new URL(location).searchParams.get('apply'));
  if(!klRun?.applies.some(a=>a.apply===klApply))klApply=klRun?.applies.at(-1)?.apply??null;
  if(wanted&&klRun?.applies.some(a=>a.apply===wanted))klApply=wanted;
  const url=new URL(location);url.searchParams.set('category','kl');url.searchParams.set('dataset',id);if(klRun)url.searchParams.set('run',klRun.id);url.searchParams.delete('apply');if(focusRun)url.hash='';
  history.replaceState(null,'',url);renderNav();renderKL();showNotice('');finishResultRequest(request);
  if(focusRun)window.scrollTo({top:0,left:0,behavior:'instant'});
  $('#updated').textContent=date(manifest.updated_at);$('#updated').dateTime=manifest.updated_at;
 }catch(e){if(seq===klSequence&&category==='kl'){finishResultRequest(request,e);$('#connection').classList.add('stale');showNotice(`KL 数据读取失败，保留上次快照 · ${e.message}`);}}
}
function selectApply(index){
 klApply=Number(index);const url=new URL(location);url.searchParams.set('category','kl');url.searchParams.set('dataset',datasetId);url.searchParams.set('apply',String(index));url.hash='kl-inner';history.replaceState(null,'',url);renderKL();
}
function klPlotHeight(el,fallback){
 const h=typeof getComputedStyle==='function'?parseFloat(getComputedStyle(el).getPropertyValue('--kl-plot-height')):NaN;
 return Number.isFinite(h)&&h>=200?h:fallback;
}
function klChart(target,points,label,maxX,selectable=false,reference=null,axisTicks=new Map(),extraReferences=[]){
 const el=$(target);configureRoundBrush(el,null);
 const values=points.filter(p=>Number.isFinite(p.y)&&p.y>0);
 const references=[...(reference?[{...reference,kind:'full',color:'#CC79A7',dash:'8 4',caption:`V0 Astra/high 全程最快搜索均值：${fmt(reference.latency_ms)} ms，第 ${reference.round} 轮`}]:[]),...extraReferences];
 if(axisMode!=='round'){
  let readout=el.parentNode.querySelector('.cost-readout');
  if(!readout){readout=document.createElement('div');readout.className='cost-readout';readout.setAttribute('aria-live','polite');el.after(readout);}
  readout.hidden=false;
  const series={id:klRun.id,name:'KL',color:'#0072B2',points:points.map(p=>({...p,
   name:selectable?'Apply '+p.x:'Apply '+klApply+' · 内部 '+(axisTicks.get(p.x)?.text||p.x),
   applyButton:selectable?p.x:null,selected:selectable&&p.x===klApply}))};
  costChart(el,[series],{references,readout,both:true,scope:'kl',viewKey:klRun.id+(selectable?'':':apply'+klApply),redraw:renderKL});
  return;
 }
 const costReadout=el.parentNode.querySelector('.cost-readout');if(costReadout)costReadout.hidden=true;
 if(!values.length&&!references.length){bindMeasurementChart(el,[],'kl',renderKL);el.innerHTML='<div class="kl-empty">暂无有效测量<br><small>结果保存后自动更新，缺失值不补成 0。</small></div>';return;}
 const w=Math.max(el.clientWidth||600,300),h=klPlotHeight(el,330);
 const longest=Math.max(1,...[...axisTicks.values()].map(t=>t.text.length))*6;
 const rotate=longest>(w-110)/Math.max(1,maxX-1)-6;
 const pad={l:rotate?82:58,r:24,t:24,b:rotate?115:45};
 const domainValues=[...values.flatMap(p=>[p.y,...bandValues(p.timing,'kl')]),...points.map(p=>p.best),...references.map(r=>r.latency_ms)].filter(Number.isFinite);
 const scale=latencyScale(el,'kl',[0,Math.max(...domainValues)*1.12],domainValues,pad.t,h-pad.b),{min:ymin,max:ymax}=scale;
 const x=v=>pad.l+(v-1)/Math.max(1,maxX-1)*(w-pad.l-pad.r),y=scale.project;
 let grid='',line='',bestLine='',last=null,lastBest=null;
 for(const v of scale.ticks){grid+=`<line data-chart-key="y-grid:${v}" x1="${pad.l}" x2="${w-pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#edf0f4"/><text data-chart-key="y-tick:${v}" x="${pad.l-8}" y="${y(v)+4}" text-anchor="end">${latencyTick(v)}</text>`;}
 for(let i=1;i<=maxX;i++){
  if(maxX>25&&i!==1&&i!==maxX&&i%5)continue;
  const tick=axisTicks.get(i),yy=h-pad.b+20;
  grid+=`<text data-chart-key="x-tick:${i}" class="kl-axis-tick" data-x="${i}" x="${x(i)}" y="${yy}" text-anchor="${rotate?'end':i===1?'start':i===maxX?'end':'middle'}" ${rotate?`transform="rotate(-60 ${x(i)} ${yy})"`:''}>${esc(tick?.text||String(i))}<title>${esc(tick?.detail||`${label} ${i}`)}</title></text>`;
 }
 for(const p of points){
  if(scale.valid(p.y)){line+=(last?' L':'M')+`${x(p.x)},${y(p.y)}`;last=p;}else last=null;
  if(scale.valid(p.best)){bestLine+=(lastBest?` H${x(p.x)} V${y(p.best)}`:`M${x(p.x)},${y(p.best)}`);lastBest=p;}
 }
 let markup=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><text data-chart-key="y-label" x="12" y="16">ms ↓${scale.log?' · log':''}</text>${grid}${sampleBandSVG(points,x,y,'#0072B2','kl',el.id,false)}<path data-chart-key="kl-best" d="${bestLine}" fill="none" stroke="#009E73" stroke-width="2" stroke-dasharray="5 3"/><path data-chart-key="kl-measurements" d="${line}" fill="none" stroke="#0072B2" stroke-width="2"/>${values.map(p=>`<circle${measurementMarker(p.measurement)} cx="${x(p.x)}" cy="${y(p.y)}" r="${selectable&&p.x===klApply?6:4}" fill="#0072B2" ${selectable?`data-apply-point="${p.x}" role="button" tabindex="0" aria-label="选择 Apply ${p.x}，${fmt(p.y)} 毫秒"`:''}><title>${esc(label)} ${p.x}: ${fmt(p.y)} ms</title></circle>`).join('')}<text data-chart-key="x-label" x="${w/2}" y="${h-1}" text-anchor="middle">${esc(label)}</text>`;
 if(references.length){
  for(const ref of references)markup+=`<line class="${ref.kind==='full'?'kl-v0-reference':'kl-v0-matched'}" data-reference="${ref.kind}" x1="${pad.l}" x2="${w-pad.r}" y1="${y(ref.latency_ms)}" y2="${y(ref.latency_ms)}" stroke="${ref.color}" stroke-width="2" stroke-dasharray="${ref.dash}"><title>${esc(ref.caption)}${ref.kind==='full'?'':` · 最快记录为 r${ref.round}`}</title></line>`;
  if(!values.length)markup+=`<text x="${w/2}" y="${h/2}" text-anchor="middle">暂无 KL 有效测量</text>`;
 }
 renderChartMarkup(el,markup+'</svg>');
 el._inspectionScale={min:1,max:maxX,ymin,ymax,logY:scale.log,invertY:scale.invert,width:w,height:h,left:pad.l,right:w-pad.r,top:pad.t,bottom:h-pad.b};
 bindMeasurementChart(el,values.map(p=>({...p.measurement,color:'#0072B2'})),'kl',renderKL);
 el.querySelectorAll('[data-apply-point]').forEach(p=>{p.onclick=()=>selectApply(p.dataset.applyPoint);p.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectApply(p.dataset.applyPoint);}};});
}
function renderKL(){
 if(!manifest)return;
 const queue=$('#kl-queue');if(queue)queue.innerHTML='<table><thead><tr><th>顺序</th><th>测试集</th><th>模型</th><th>状态</th></tr></thead><tbody>'+(manifest.kl.queue||[]).map(q=>`<tr><td>${q.position}</td><td><a href="?category=kl&dataset=${encodeURIComponent(q.dataset)}&run=${encodeURIComponent(q.id)}#kl-panel">${esc(q.dataset)}</a></td><td>${esc(q.model)} / ${esc(q.effort)}</td><td>${klStatus(q.status)}</td></tr>`).join('')+'</tbody></table>';
 if(category!=='kl'||!manifest)return;
 renderNav();
 const options=klData?.runs.filter(r=>r.dataset===datasetId)||[];
 const selector=$('#kl-run-select');if(selector){selector.innerHTML=options.map(r=>`<option value="${esc(r.id)}" data-no-results="${!r.applies.some(a=>a.delivered?.accepted||(a.candidates||[]).length)}" ${r.id===klRun?.id?'selected':''}>${esc(r.model+' / '+r.effort+' · '+klStatus(r.status))}</option>`).join('');selector.value=klRun?.id||'';selector.onchange=e=>selectKLRun(e.target.value);}
 const meta=manifest.datasets.find(d=>d.id===datasetId);$('#kl-name').textContent=(meta?.title||datasetId)+' · KL';
 if(!klData){$('#kl-body').hidden=true;$('#kl-state').textContent='正在读取 KL 数据…';return;}
 if(!klRun){$('#kl-body').hidden=true;$('#kl-state').textContent='此测试集尚未登记 KL 实验';return;}
 $('#kl-body').hidden=false;const r=klRun,done=r.applies.filter(a=>a.status==='completed').length;
 $('#kl-state').textContent=`${r.model} / ${r.effort} · ${klStatus(r.status)} · ${r.phase||''}`;
 $('#kl-budget').textContent=`已交付 ${done} / ${r.budget} Apply · 每 Apply ${r.apply_timeout_seconds/60} 分钟 · 额外重试 ${r.max_retries} · 单次评测/诊断 ${r.evaluation_timeout_seconds/60} 分钟`;
 $('#kl-run-info').textContent=`开始 ${date(r.started_at)} · 独立完成 ${date(r.finished_at)} · 候选评测 ${r.applies.reduce((n,a)=>n+a.evaluations,0)} 次`;
 $('#kl-apply').innerHTML=r.applies.map(a=>`<option value="${a.apply}" ${a.apply===klApply?'selected':''}>Apply ${a.apply} · ${klStatus(a.status)}</option>`).join('')||'<option value="">暂无 Apply</option>';
 $('#kl-apply').disabled=!r.applies.length;$('#kl-apply').value=klApply==null?'':String(klApply);$('#kl-apply').onchange=e=>selectApply(e.target.value);
 let best=null;const points=r.applies.map(a=>{const v=a.delivered?.accepted?a.delivered.latency_ms:null;if(v!=null)best=best==null?v:Math.min(best,v);return {x:a.apply,y:v,best,timing:a.delivered?.timing,measurement:measurementInfo({...r,method:'KL'},{apply:a.apply,round:Math.max(0,...(r.aligned?.points||[]).filter(p=>p.counted&&p.apply<=a.apply).map(p=>p.round)),y:v,timing:a.delivered?.timing}),axes:a.axes,epoch:r.dataset==='Mega'&&a.apply>=5?2:1};});
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
 for(const which of ['overview','candidates'])chartResetButton($('#kl-'+which),'kl-'+which,()=>{clearCostWindows('kl');klReferenceVisible[which]=true;klMatchedVisible[which]={same:true,reduced:true};if(which==='candidates')klApply=klRun.applies.at(-1)?.apply??null;renderKL();});
 const a=r.applies.find(a=>a.apply===klApply),inner=a?.candidates||[];best=null;
 klChart('#kl-candidates',inner.map(c=>{const v=c.correctness_passed?c.latency_ms:null;if(c.accepted&&v!=null)best=best==null?v:Math.min(best,v);return {x:c.sequence,y:v,best,timing:c.timing,measurement:measurementInfo({...r,method:'KL'},{apply:klApply,inner_sequence:c.sequence,round:r.aligned?.points.find(p=>p.apply===klApply&&p.inner_sequence===c.sequence)?.round,y:v,timing:c.timing}),axes:c.axes,eligible:c.accepted,status:c.status};}),'内部候选序号',Math.max(2,inner.length),false,klReferenceVisible.candidates?klReference:null,axes.candidates.get(klApply),matched.filter(ref=>klMatchedVisible.candidates[ref.kind]));
 $('#kl-inner-status').textContent=a?`${klStatus(a.status)} · 已用 ${a.elapsed_seconds==null?'未知':fmt(a.elapsed_seconds/60,1)+' 分钟'} · ${a.evaluations} 次评测 · ${a.infrastructure_errors} 次基础设施异常 · ${a.reused_snapshots} 份结果复用快照`:'尚未启动；候选次数没有预设上限，受 Apply 时限约束。';
 $('#kl-candidate-rows').innerHTML=inner.map(c=>`<tr><td>${c.sequence}</td><td>${klStatus(c.status)}</td><td>${({compile:'编译',correctness:'正确性',performance:'性能门禁'})[c.stage]||'—'}</td><td>${c.accepted?'通过':c.correctness_passed?'正确性通过':'—'}</td><td class="num">${fmt(c.latency_ms)}</td><td class="num">${fmt(c.reference_latency_ms)}</td><td>${c.reused?'复用，不新增评测':'新记录'}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">暂无候选评测记录</td></tr>';
 $('#kl-apply-rows').innerHTML=r.applies.map(a=>`<tr><td><button data-apply-row="${a.apply}">Apply ${a.apply}</button></td><td>${klStatus(a.status)}</td><td>${a.evaluations}</td><td>${a.infrastructure_errors}</td><td class="num">${fmt(a.delivered?.latency_ms)}</td><td class="num">${a.elapsed_seconds==null?'—':fmt(a.elapsed_seconds/60,1)}</td><td>${date(a.ended_at)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">已登记任务，等待正式启动</td></tr>';
 $$('[data-apply-row]').forEach(b=>b.onclick=()=>selectApply(b.dataset.applyRow));
 $('#kl-events').innerHTML=(klData.task_events||[]).filter(e=>e.run_id===r.id).map(e=>`<li class="task-event kl-task-event"><time datetime="${esc(e.at)}">${date(e.at)}</time><span class="event-tag ${esc(e.kind)}">${({started:'开始',paused:'暂停',resumed:'恢复',completed:'独立完成'})[e.kind]||'待核对'}</span><p>${esc(e.reason)}</p></li>`).join('')||'<li class="empty">尚未开始，启动后自动记录。</li>';
 $('#kl-json').onclick=()=>download(`kl-${datasetId}.json`,JSON.stringify(r,null,2),'application/json');
 $('#kl-csv').onclick=()=>{const lines=['apply,candidate,status,latency_ms,reference_latency_ms,accepted,reused,elapsed_seconds,reported_tokens,missing_responses,disputed,tokens_complete'];for(const a of r.applies)for(const c of a.candidates)lines.push([a.apply,c.sequence,c.status,c.latency_ms??'',c.reference_latency_ms??'',c.accepted,c.reused,c.axes?.elapsed_s,c.axes?.tokens,c.axes?.missing_responses,c.axes?.disputed,c.axes?.tokens_complete].join(','));download(`kl-${datasetId}-candidates.csv`,lines.join('\n'),'text/csv');};
}

// A shared view: only reads published numeric results, never changes experiments.
let alignedSequence=0,alignedDataset=null,alignedRun=null;
const alignedViews=new Map(),klDatasetCache=new Map();
function alignedViewKey(dataset){return (dataset.comparison_scope||'aligned')+':'+dataset.id+':'+axisMode;}
function alignedView(dataset,series){
 const key=alignedViewKey(dataset);
 if(!alignedViews.has(key))alignedViews.set(key,{visible:new Set(series.filter(r=>axisMode!=='round'||r.model==='Astra').map(r=>r.id)),mode:'best',zoom:false,compressed:false,visualScale:1});
 return alignedViews.get(key);
}
function alignedPeers(dataset,run){return [...(run?[run]:[]),...(klData?.runs.filter(r=>r.dataset===dataset.id&&r.id!==run?.id)||[])];}
function alignedSeries(dataset,run){
 const series=dataset.runs.filter(r=>r.method!=='B0'&&showBVRun(r,dataset.comparison_scope)&&(comparisonHasB(dataset.comparison_scope)||r.method==='V0')).map(r=>({
  id:r.id,model:r.model,effort:r.effort,method:methodLabel(r),baseMethod:r.method,available:r.search.length>0,color:comparisonColor(r,dataset.comparison_scope||'aligned'),dash:seriesDash(r),
  points:r.search.map(p=>({round:p.round,y:p.status==='passed'?p.timing?.mean_ms??null:null,status:p.status,axes:p.axes,recorded_at:p.recorded_at,timing:p.timing,measurement:measurementInfo(r,{...p,y:p.timing?.mean_ms})}))
 }));
 for(const r of alignedPeers(dataset,run))series.push({id:r.id,model:r.model,effort:r.effort,method:'Aligned KL',baseMethod:'KL',available:(r.aligned?.points||[]).some(p=>p.counted),color:comparisonColor({...r,baseMethod:'KL'},dataset.comparison_scope||'aligned'),dash:DASH[r.model]||'',
  points:(r.aligned?.points||[]).filter(p=>p.counted).map(p=>({...p,y:p.latency_ms,measurement:measurementInfo({...r,method:'KL'},{...p,y:p.latency_ms}),epoch:r.id.startsWith('kl-astra-high-serial-20261102-')&&r.dataset==='Mega'&&p.apply>=5?2:1}))});
 return series;
}
async function loadAligned(id,focusRun=null,scope=isComparison()?category:'aligned',push=false){
 scope=isComparison(scope)?scope:'aligned';
 const seq=++alignedSequence;++klSequence;++loadSeq;setCategory(scope);
 const meta=manifest.datasets.find(d=>d.id===id)||manifest.datasets[0];datasetId=meta.id;
 const request=beginResultRequest(scope,meta.id,focusRun,push);
 try{
  const [d,k]=await Promise.all([
   datasetJSON(meta),
   publishedKL()
  ]);
  if(seq!==alignedSequence||category!==scope)return;
  if(d.updated_at!==manifest.updated_at||k.updated_at!==manifest.updated_at)throw Error('发布版本尚在同步');
  cache.set(meta.id,d);klData=k;alignedDataset={...d,comparison_scope:scope};alignedRun=k.runs.find(r=>r.dataset===meta.id);needsReload=false;
  const series=alignedSeries(alignedDataset,alignedRun),view=alignedView(alignedDataset,series);
  if(focusRun&&series.some(r=>r.id===focusRun)){view.visible.add(focusRun);focusedRun=focusRun;}else if(focusRun)focusedRun=null;
  const url=new URL(location);url.searchParams.set('category',scope);url.searchParams.set('dataset',meta.id);url.searchParams.delete('apply');url.searchParams.delete('edition');
  if(focusRun)url.searchParams.set('run',focusRun);else if(!series.some(r=>r.id===url.searchParams.get('run')))url.searchParams.delete('run');
  if(focusRun)url.hash='';history.replaceState(null,'',url);
  $('#aligned-name').textContent=`${d.title} · ${scope==='all-with-b01'?'All（with B0/1）':scope==='all'?'All':'V/Aligned KL'}`;
  renderNav();renderAligned('#aligned-content',alignedDataset,alignedRun);showNotice('');finishResultRequest(request);
  $('#updated').textContent=date(manifest.updated_at);$('#updated').dateTime=manifest.updated_at;
  if(focusRun)window.scrollTo({top:0,left:0,behavior:'instant'});
 }catch(e){if(seq===alignedSequence&&category===scope){finishResultRequest(request,e);needsReload=true;showNotice(`对比数据读取失败，保留上次快照 · ${e.message}`);}}
}
function animateAlignedCompression(view,host,key){
 cancelAnimationFrame(view.compressionFrame);const from=view.visualScale??1,to=view.compressed?2/3:1;
 if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){view.visualScale=to;view.paintCompression?.(to);return;}
 const start=performance.now();
 function frame(now){
  if(!host.isConnected||host.dataset.comparisonKey!==key)return;
  const t=Math.min(1,(now-start)/520),eased=t*t*(3-2*t);view.visualScale=from+(to-from)*eased;view.paintCompression?.(view.visualScale);
  if(t<1)view.compressionFrame=requestAnimationFrame(frame);
 }
 view.compressionFrame=requestAnimationFrame(frame);
}
function renderAligned(target,dataset,run,previewIds=[]){
 const host=$(target);if(!host||!dataset)return;
 const series=alignedSeries(dataset,run);
 const all=series,key=alignedViewKey(dataset),view=alignedView(dataset,series);
 host.dataset.comparisonKey=key;
 const selected=all.filter(r=>view.visible.has(r.id)||previewIds.includes(r.id)),peers=alignedPeers(dataset,run);
 const points=peers.flatMap(r=>(r.aligned?.points||[]).map(p=>({...p,run_id:r.id,model:r.model,effort:r.effort})));
 const records=dataset.runs.filter(r=>showBVRun(r,dataset.comparison_scope)&&(comparisonHasB(dataset.comparison_scope)||r.method==='V0'));
 const redraw=()=>renderAligned(target,dataset,run);
 const retainedControls=host.querySelector(':scope > .aligned-controls'),retainedCard=host.querySelector(':scope > .aligned-card'),retainedChart=host.querySelector('.aligned-chart'),retainedRange=host.querySelector('.comparison-range');
 const recordKey=(dataset.comparison_scope||'aligned')+':'+dataset.id;
 const retainedRecords=new Map(host.dataset.recordsKey===recordKey?[...host.querySelectorAll(':scope > details[data-record-panel]')].map(d=>[d.dataset.recordPanel,d]):[]);host.dataset.recordsKey=recordKey;
 const scaffold=`<p class="kl-caption aligned-note">${comparisonHasB(dataset.comparison_scope)?'B/V':'V'} 均值 · KL 中位数</p>
 <div class="aligned-controls"></div>
 <section class="chart-card aligned-card"><div class="chart-title"><h3>速度曲线</h3></div><div class="plot-options"><div class="segments" aria-label="曲线指标"><button data-aligned-mode="best" aria-pressed="${view.mode==='best'}" class="${view.mode==='best'?'selected':''}">搜索最优</button><button data-aligned-mode="raw" aria-pressed="${view.mode==='raw'}" class="${view.mode==='raw'?'selected':''}">逐次测量</button></div><label class="chip aligned-compression" style="--color:#8a56d6" title="仅轮次轴：KL 轮次 ÷ 1.5，真实轮次不变"><input type="checkbox" data-aligned-compress ${view.compressed?'checked':''} ${axisMode!=='round'?'disabled':''}>KL ×⅔</label><label><input data-aligned-zoom type="checkbox" ${view.zoom?'checked':''}> 收敛放大</label><span class="mark-key">● 测量 · — 最优阶梯 · × 失败</span><button data-aligned-csv>CSV ↓</button></div>
 <div class="chart aligned-chart" tabindex="0" role="img" aria-label="${comparisonHasB(dataset.comparison_scope)?'全部结果':'V 与 Aligned KL'} 按有效评测次数对比"></div><div class="readout aligned-readout" aria-live="polite"></div></section>
 <details class="data-section" data-record-panel="kl"><summary>KL 展开记录 · ${points.length} 条</summary><div class="table-wrap rounds-wrap"><table><thead><tr><th>模型 / effort</th><th>累计轮次</th><th>Apply</th><th>内部序号</th><th>结果</th><th>延迟 ms</th><th>记录时间 SGT</th></tr></thead><tbody>${points.map(p=>`<tr><td>${esc(p.model)} / ${esc(p.effort)}</td><td>${p.counted?'r'+p.round:'不计轮次'}</td><td>${p.apply}</td><td>${p.inner_sequence}</td><td>${klStatus(p.status)}</td><td>${fmt(p.latency_ms)}</td><td>${date(p.recorded_at)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">暂无 KL 内部评测；保存后自动更新</td></tr>'}</tbody></table></div></details>
 <details class="data-section" data-record-panel="bv"><summary>${comparisonHasB(dataset.comparison_scope)?'B/V':'V'} 实验记录</summary><div class="table-wrap"><table><thead><tr><th>模型 / effort</th><th>方法</th><th>状态</th><th>轮次</th><th>搜索最优 ms</th><th>正式结果 ms</th><th>完成 SGT</th></tr></thead><tbody>${records.map(r=>`<tr><td>${esc(r.model)} / ${esc(r.effort)}</td><td>${esc(methodDisplayLabel(r))}</td><td>${badge(r.status)}</td><td>${r.reported_attempts}/${r.budget}</td><td>${r.method==='B0'?'正确性 · '+(r.accepted===true?'通过':r.accepted===false?'未接受':'待定'):fmt(r.search_best_ms)}</td><td>${fmt(r.formal?.mean_ms)}</td><td>${date(r.finished_at)}</td></tr>`).join('')}</tbody></table></div></details>`;
 // Preserve the actual slider node while dragging; detaching a native range ends its gesture.
 const template=document.createElement('template');template.innerHTML=scaffold;
 for(const child of [...host.children])if(child!==retainedCard&&child!==retainedControls)child.remove();
 let afterChart=false;
 for(const child of [...template.content.children]){
  if(child.classList.contains('aligned-controls')&&retainedControls)continue;
  if(child.classList.contains('aligned-card')){if(!retainedCard)host.append(child);afterChart=true;}
  else if(!afterChart&&retainedCard)host.insertBefore(child,retainedControls||retainedCard);
  else if(child.matches('details[data-record-panel]')&&retainedRecords.has(child.dataset.recordPanel)){
   const saved=retainedRecords.get(child.dataset.recordPanel);
   if(saved.innerHTML!==child.innerHTML){const scroll=saved.querySelector('.table-wrap')?.scrollTop||0;saved.innerHTML=child.innerHTML;if(saved.querySelector('.table-wrap'))saved.querySelector('.table-wrap').scrollTop=scroll;}
   host.append(saved);
  }else host.append(child);
 }
 renderComparisonControls(host.querySelector('.aligned-controls'),all,view.visible,dataset.comparison_scope||'aligned',redraw);
 chartResetButton(host.querySelector('.aligned-chart'),'comparison',()=>{roundWindows.delete((dataset.comparison_scope||'aligned')+':'+dataset.id);clearLatencyWindows(dataset.comparison_scope||'aligned',dataset.id);clearCostWindows(dataset.comparison_scope||'aligned',dataset.id);view.zoom=false;view.compressed=false;view.visualScale=1;redraw();});
 host.querySelector('[data-aligned-compress]').checked=view.compressed;
 host.querySelector('[data-aligned-compress]').disabled=axisMode!=='round';
 host.querySelector('[data-aligned-zoom]').checked=view.zoom;
 host.querySelectorAll('[data-aligned-mode]').forEach(button=>{const active=button.dataset.alignedMode===view.mode;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
 host.querySelector('[data-aligned-compress]').onchange=e=>{view.compressed=e.target.checked;view.visualScale=view.compressed?2/3:1;redraw();};
 host.querySelectorAll('[data-aligned-mode]').forEach(el=>el.onclick=()=>{view.mode=el.dataset.alignedMode;redraw();});
 host.querySelector('[data-aligned-zoom]').onchange=e=>{clearLatencyWindows(dataset.comparison_scope||'aligned',dataset.id);view.zoom=e.target.checked;redraw();};
 host.querySelector('[data-aligned-csv]').onclick=()=>download(`aligned-kl-${dataset.id}.csv`,['run_id,model,effort,round,apply,inner_sequence,status,counted,latency_ms,recorded_at,elapsed_seconds,reported_tokens,missing_responses,disputed,tokens_complete',...points.map(p=>[p.run_id,p.model,p.effort,p.round,p.apply,p.inner_sequence,p.status,p.counted,p.latency_ms,p.recorded_at,p.axes?.elapsed_s,p.axes?.tokens,p.axes?.missing_responses,p.axes?.disputed,p.axes?.tokens_complete].map(csvCell).join(','))].join('\n'),'text/csv');
 if(axisMode!=='round'){
  if(retainedRange)retainedRange.hidden=true;
  const chart=host.querySelector('.aligned-chart');configureRoundBrush(chart,null);chart.setAttribute('aria-label','Aligned KL · '+axisText());
  costChart(chart,selected.map(r=>({...r,name:r.model+' '+r.method,points:r.points.map(p=>({...p,name:'r'+p.round+(p.apply?' · Apply '+p.apply:'' )}))})),{best:view.mode==='best',zoom:view.zoom,scope:dataset.comparison_scope||'aligned',redraw,readout:host.querySelector('.aligned-readout')});
  return;
 }
 const chart=host.querySelector('.aligned-chart'),w=Math.max(320,chart.clientWidth||800),h=klPlotHeight(chart,340),pad={l:66,r:20,t:26,b:45},maxX=Math.max(30,...selected.flatMap(r=>r.points.map(p=>p.round*(r.baseMethod==='KL'?(view.visualScale??1):1))));
 const [minRound,maxRound]=comparisonWindow(dataset.comparison_scope||'aligned',maxX);
 renderRoundRange(chart,dataset.comparison_scope||'aligned',maxX,redraw);
 const displayed=r=>{let best=null;return r.points.map(p=>{if(Number.isFinite(p.y)&&p.y>0)best=best==null?p.y:Math.min(best,p.y);return {...p,viewY:view.mode==='best'?best:p.y,viewX:p.round*(r.baseMethod==='KL'?(view.visualScale??1):1)};});};
 const inRange=p=>p.viewX>=minRound&&p.viewX<=maxRound;
 let values=selected.flatMap(r=>displayed(r).filter(p=>inRange(p)&&p.viewY!=null).flatMap(p=>[p.viewY,p.y,...bandValues(p.timing,dataset.comparison_scope||'aligned')]).filter(Number.isFinite)),ymin=0,ymax=Math.max(.001,...values)*1.08;
 if(view.zoom&&values.length){const tails=selected.map(r=>Math.min(...displayed(r).filter(p=>inRange(p)&&p.viewY!=null).map(p=>p.viewY))).filter(Number.isFinite);if(tails.length){const lo=Math.min(...tails),hi=Math.max(...tails),space=Math.max((hi-lo)*.15,hi*.035,.000001);ymin=Math.max(0,lo-space);ymax=hi+space;}}
 const bandDomain=selected.flatMap(r=>bandPoints(r.points,view.mode==='best').filter(p=>{const v=p.round*(r.baseMethod==='KL'?(view.visualScale??1):1);return v>=minRound&&v<=maxRound;})).flatMap(p=>bandValues(p.bandTiming,dataset.comparison_scope||'aligned'));
 if(bandDomain.length){ymin=Math.min(ymin,Math.min(...bandDomain)*.98);ymax=Math.max(ymax,Math.max(...bandDomain)*1.04);}
 const scale=latencyScale(chart,dataset.comparison_scope||'aligned',latencyWindow(chart,dataset.comparison_scope||'aligned',[ymin,ymax]),[...values,...bandDomain],pad.t,h-pad.b);
 [ymin,ymax]=[scale.min,scale.max];
 const x=n=>pad.l+(n-minRound)/Math.max(1,maxRound-minRound)*(w-pad.l-pad.r),y=scale.project,clip='aligned-clip-'+target.replace(/[^a-z]/g,'');
 let svg=`<svg viewBox="0 0 ${w} ${h}" role="img"><title>Aligned KL，横轴为有效评测序号，纵轴为延迟毫秒</title><defs><clipPath id="${clip}"><rect x="${pad.l}" y="${pad.t}" width="${w-pad.l-pad.r}" height="${h-pad.t-pad.b}"/></clipPath></defs>`;
 for(const v of scale.ticks)svg+=`<line data-chart-key="y-grid:${v}" x1="${pad.l}" x2="${w-pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#edf0f4"/><text data-chart-key="y-tick:${v}" x="${pad.l-8}" y="${y(v)+4}" text-anchor="end">${latencyTick(v)}</text>`;
 for(const v of [...new Set([minRound,...ticks(minRound,maxRound,w<500?4:8).filter(Number.isInteger),maxRound])])svg+=`<text data-chart-key="x-tick:${v}" x="${x(v)}" y="${h-22}" text-anchor="middle">${v}</text>`;
 svg+=`<text data-chart-key="y-label" x="12" y="16">ms ↓${scale.log?' · log':''}</text><text data-chart-key="x-label" x="${w/2}" y="${h-3}" text-anchor="middle">轮次${view.compressed?' · KL r ÷ 1.5':''}</text><g clip-path="url(#${clip})">`;
 function curvePath(r,ratio=1){let best=null,path='',last=false;for(const p of r.points){if(Number.isFinite(p.y)&&p.y>0)best=best==null?p.y:Math.min(best,p.y);const v=view.mode==='best'?best:p.y;if(!scale.valid(v)){last=false;continue;}path+=last?(view.mode==='best'?` H${x(p.round*ratio)} V${y(v)}`:` L${x(p.round*ratio)},${y(v)}`):` M${x(p.round*ratio)},${y(v)}`;last=true;}return path;}
 const compression=view.visualScale??(view.compressed?2/3:1);
 for(const r of selected){const kl=r.baseMethod==='KL',ratio=kl?compression:1;
  svg+=`<g data-comparison-series="${esc(r.id)}">`+sampleBandSVG(r.points.map(p=>({...p,x:p.round*ratio})),x,y,r.color,dataset.comparison_scope||'aligned',r.id,view.mode==='best')+`<path data-aligned-curve="${esc(r.id)}" d="${curvePath(r,ratio)}" fill="none" stroke="${r.color}" stroke-width="${kl?2.6:1.8}" stroke-dasharray="${r.dash}"/>`;
  for(const p of r.points){const pos=x(p.round*ratio);if(scale.valid(p.y))svg+=`<circle${measurementMarker(p.measurement)} data-real-round="${p.round}" cx="${pos}" cy="${y(p.y)}" r="3" fill="${r.color}"><title>${esc(r.model+' '+r.method)} r${p.round}${p.apply?' · Apply '+p.apply+' / 内部 '+p.inner_sequence:''}: ${fmt(p.y)} ms</title></circle>`;else if(p.status==='failed')svg+=`<path data-failed-round="${p.round}" d="M${pos-3},${h-pad.b-9}l6 6m0 -6l-6 6" stroke="${r.color}"/>`;}
  svg+='</g>';
 }
 svg+='</g></svg>';renderChartMarkup(chart,svg);
 bindMeasurementChart(chart,selected.flatMap(r=>r.points.filter(p=>p.y!=null).map(p=>({...p.measurement,color:r.color}))),dataset.comparison_scope||'aligned',redraw);
 configureRoundBrush(chart,{scope:dataset.comparison_scope||'aligned',maximum:maxX,min:minRound,max:maxRound,ymin,ymax,logY:scale.log,invertY:scale.invert,width:w,height:h,left:pad.l,right:w-pad.r,top:pad.t,bottom:h-pad.b,redraw});
 view.paintCompression=ratio=>{
  for(const r of selected.filter(r=>r.baseMethod==='KL')){
   const group=[...chart.querySelectorAll('[data-comparison-series]')].find(el=>el.dataset.comparisonSeries===r.id);if(!group)continue;
   group.querySelector('[data-aligned-curve]').setAttribute('d',curvePath(r,ratio));
   group.querySelectorAll('[data-real-round]').forEach(el=>el.setAttribute('cx',x(+el.dataset.realRound*ratio)));
   group.querySelectorAll('[data-failed-round]').forEach(el=>el.setAttribute('d',`M${x(+el.dataset.failedRound*ratio)-3},${h-pad.b-9}l6 6m0 -6l-6 6`));
  }
  inspect(cursor);
 };
 const readout=host.querySelector('.aligned-readout');
 function inspect(n){readout.innerHTML=`<strong>r${n}</strong>`+selected.map(r=>{const actual=r.baseMethod==='KL'?Math.round(n/(view.visualScale||1)):n,p=r.points.find(p=>p.round===actual);return `<span style="--color:${r.color}"><i class="swatch"></i>${esc(r.model+' '+r.method)} r${actual} ${p?.apply?'Apply '+p.apply+' · ':''}<strong>${fmt(p?.y)}</strong>${p?.y!=null?' ms':p?' · '+(p.status==='failed'?'失败':'无有效计时'):' · 无记录'}</span>`;}).join('');}
 let cursor=Math.round((run?.aligned?.count||1)*(view.visualScale||1));inspect(cursor);
 chart.onpointermove=e=>{cursor=Math.min(maxRound,Math.max(minRound,Math.round(minRound+(e.clientX-chart.getBoundingClientRect().left-pad.l)/(w-pad.l-pad.r)*(maxRound-minRound))));inspect(cursor);};
 chart.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();cursor=Math.max(minRound,Math.min(maxRound,cursor+(e.key==='ArrowRight'?1:-1)));inspect(cursor);}};
 if(!values.length)readout.insertAdjacentHTML('afterbegin','<span>所选曲线暂无有效计时</span>');
 if(view.zoom)readout.insertAdjacentHTML('afterbegin',`<span>放大范围 ${fmt(ymin)}–${fmt(ymax)} ms，范围外测量已裁剪</span>`);
}
