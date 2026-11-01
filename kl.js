'use strict';
let klData=null,klRun=null,klApply=null,klSequence=0;
const KL_LABELS={not_run:'未开始',running:'进行中',complete:'独立完成',ended:'结束 · 待验收',blocked:'待处理',paused:'已暂停',completed:'已交付',failed:'失败',interrupted:'中断',unknown:'待核对',passed:'通过',infrastructure_error:'基础设施异常'};
function klStatus(s){return KL_LABELS[s]||'待核对';}
function setCategory(id){
 category=id==='kl'?'kl':'bv';
 $('#bv-panel').hidden=category!=='bv';$('#kl-panel').hidden=category!=='kl';
 $$('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
}
async function chooseCategory(id){
 setCategory(id);initialRun=null;
 return category==='kl'?loadKL(datasetId):loadDataset(datasetId,true);
}
async function loadKL(id){
 const seq=++klSequence;setCategory('kl');datasetId=id;
 try{
  if(!klData||klData.updated_at!==manifest.updated_at)klData=await getJSON(`./api/v1/${manifest.kl.url}?v=${encodeURIComponent(manifest.updated_at)}`);
  if(seq!==klSequence||category!=='kl')return;
  if(klData.updated_at!==manifest.updated_at)throw Error('发布版本尚在同步');
  const runs=klData.runs.filter(r=>r.dataset===id);klRun=runs.find(r=>r.id===new URL(location).searchParams.get('run'))||runs[0];
  const wanted=Number(new URL(location).searchParams.get('apply'));
  if(!klRun?.applies.some(a=>a.apply===klApply))klApply=klRun?.applies.at(-1)?.apply??null;
  if(wanted&&klRun?.applies.some(a=>a.apply===wanted))klApply=wanted;
  const url=new URL(location);url.searchParams.set('category','kl');url.searchParams.set('dataset',id);url.searchParams.delete('run');url.searchParams.delete('apply');
  history.replaceState(null,'',url);renderNav();renderKL();showNotice('');
  $('#updated').textContent=date(manifest.updated_at);$('#updated').dateTime=manifest.updated_at;
 }catch(e){$('#connection').classList.add('stale');showNotice(`KL 数据读取失败，保留上次快照 · ${e.message}`);}
}
function selectApply(index){
 klApply=Number(index);const url=new URL(location);url.searchParams.set('category','kl');url.searchParams.set('dataset',datasetId);url.searchParams.set('apply',String(index));url.hash='kl-inner';history.replaceState(null,'',url);renderKL();
}
function klChart(target,points,label,maxX,selectable=false){
 const el=$(target),values=points.filter(p=>Number.isFinite(p.y)&&p.y>0);
 if(!values.length){el.innerHTML='<div class="kl-empty">暂无有效测量<br><small>结果保存后自动更新，缺失值不补成 0。</small></div>';return;}
 const w=Math.max(el.clientWidth||600,300),h=290,pad={l:58,r:18,t:24,b:40};
 const ymax=Math.max(...values.map(p=>p.y),...points.map(p=>p.best||0))*1.12;
 const x=v=>pad.l+(v-1)/Math.max(1,maxX-1)*(w-pad.l-pad.r),y=v=>h-pad.b-v/ymax*(h-pad.t-pad.b);
 let grid='',line='',bestLine='',last=null,lastBest=null;
 for(let i=0;i<=4;i++){const v=ymax*i/4;grid+=`<line x1="${pad.l}" x2="${w-pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#edf0f4"/><text x="${pad.l-8}" y="${y(v)+4}" text-anchor="end">${fmt(v,3)}</text>`;}
 for(let i=1;i<=maxX;i++){if(maxX>25&&i!==1&&i!==maxX&&i%5)continue;grid+=`<text x="${x(i)}" y="${h-18}" text-anchor="middle">${i}</text>`;}
 for(const p of points){
  if(p.y!=null){line+=(last?' L':'M')+`${x(p.x)},${y(p.y)}`;last=p;}else last=null;
  if(p.best!=null){bestLine+=(lastBest?` H${x(p.x)} V${y(p.best)}`:`M${x(p.x)},${y(p.best)}`);lastBest=p;}
 }
 el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><text x="12" y="16">ms ↓</text>${grid}<path d="${bestLine}" fill="none" stroke="#009E73" stroke-width="2" stroke-dasharray="5 3"/><path d="${line}" fill="none" stroke="#0072B2" stroke-width="2"/>${values.map(p=>`<circle cx="${x(p.x)}" cy="${y(p.y)}" r="${selectable&&p.x===klApply?6:4}" fill="#0072B2" ${selectable?`data-apply-point="${p.x}" role="button" tabindex="0" aria-label="选择 Apply ${p.x}，${fmt(p.y)} 毫秒"`:''}><title>${esc(label)} ${p.x}: ${fmt(p.y)} ms</title></circle>`).join('')}<text x="${w/2}" y="${h-1}" text-anchor="middle">${esc(label)}</text></svg>`;
 el.querySelectorAll('[data-apply-point]').forEach(p=>{p.onclick=()=>selectApply(p.dataset.applyPoint);p.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectApply(p.dataset.applyPoint);}};});
}
function renderKL(){
 if(category!=='kl')return;
 const meta=manifest.datasets.find(d=>d.id===datasetId);$('#kl-name').textContent=(meta?.title||datasetId)+' · KL';
 if(!klRun){$('#kl-body').hidden=true;$('#kl-state').textContent='此测试集尚未登记 KL 实验';return;}
 $('#kl-body').hidden=false;const r=klRun,done=r.applies.filter(a=>a.status==='completed').length;
 $('#kl-state').textContent=`${r.model} / ${r.effort} · ${klStatus(r.status)} · ${r.phase||''}`;
 $('#kl-budget').textContent=`已交付 ${done} / ${r.budget} Apply · 每 Apply ${r.apply_timeout_seconds/60} 分钟 · 额外重试 ${r.max_retries} · 单次评测/诊断 ${r.evaluation_timeout_seconds/60} 分钟`;
 $('#kl-run-info').textContent=`开始 ${date(r.started_at)} · 独立完成 ${date(r.finished_at)} · 候选评测 ${r.applies.reduce((n,a)=>n+a.evaluations,0)} 次`;
 $('#kl-apply').innerHTML=r.applies.map(a=>`<option value="${a.apply}" ${a.apply===klApply?'selected':''}>Apply ${a.apply} · ${klStatus(a.status)}</option>`).join('')||'<option value="">暂无 Apply</option>';
 $('#kl-apply').disabled=!r.applies.length;$('#kl-apply').value=klApply==null?'':String(klApply);$('#kl-apply').onchange=e=>selectApply(e.target.value);
 let best=null;const points=r.applies.map(a=>{const v=a.delivered?.accepted?a.delivered.latency_ms:null;if(v!=null)best=best==null?v:Math.min(best,v);return {x:a.apply,y:v,best};});
 klChart('#kl-overview',points,'Apply',r.budget,true);
 const a=r.applies.find(a=>a.apply===klApply),inner=a?.candidates||[];best=null;
 klChart('#kl-candidates',inner.map(c=>{const v=c.correctness_passed?c.latency_ms:null;if(c.accepted&&v!=null)best=best==null?v:Math.min(best,v);return {x:c.sequence,y:v,best};}),'内部候选序号',Math.max(2,inner.length));
 $('#kl-inner-status').textContent=a?`${klStatus(a.status)} · 已用 ${a.elapsed_seconds==null?'未知':fmt(a.elapsed_seconds/60,1)+' 分钟'} · ${a.evaluations} 次评测 · ${a.infrastructure_errors} 次基础设施异常 · ${a.reused_snapshots} 份结果复用快照`:'尚未启动；候选次数没有预设上限，受 Apply 时限约束。';
 $('#kl-candidate-rows').innerHTML=inner.map(c=>`<tr><td>${c.sequence}</td><td>${klStatus(c.status)}</td><td>${({compile:'编译',correctness:'正确性',performance:'性能门禁'})[c.stage]||'—'}</td><td>${c.accepted?'通过':c.correctness_passed?'正确性通过':'—'}</td><td class="num">${fmt(c.latency_ms)}</td><td class="num">${fmt(c.reference_latency_ms)}</td><td>${c.reused?'复用，不新增评测':'新记录'}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">暂无候选评测记录</td></tr>';
 $('#kl-apply-rows').innerHTML=r.applies.map(a=>`<tr><td><button data-apply-row="${a.apply}">Apply ${a.apply}</button></td><td>${klStatus(a.status)}</td><td>${a.evaluations}</td><td>${a.infrastructure_errors}</td><td class="num">${fmt(a.delivered?.latency_ms)}</td><td class="num">${a.elapsed_seconds==null?'—':fmt(a.elapsed_seconds/60,1)}</td><td>${date(a.ended_at)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">已登记任务，等待正式启动</td></tr>';
 $$('[data-apply-row]').forEach(b=>b.onclick=()=>selectApply(b.dataset.applyRow));
 $('#kl-events').innerHTML=(klData.task_events||[]).filter(e=>e.run_id===r.id).map(e=>`<li><time>${date(e.at)}</time><strong>${({started:'开始',paused:'暂停',resumed:'恢复',completed:'独立完成'})[e.kind]||'待核对'}</strong><p>${esc(e.reason)}</p></li>`).join('')||'<li>尚未开始，启动后自动记录。</li>';
 $('#kl-path').textContent=r.workspace_path||'实际优化工作区在正式启动时创建。';
 $('#kl-copy').disabled=!r.workspace_path;$('#kl-copy').onclick=async()=>{await navigator.clipboard.writeText(r.workspace_path);$('#kl-copy').textContent='已复制';};
 $('#kl-json').onclick=()=>download(`kl-${datasetId}.json`,JSON.stringify(r,null,2),'application/json');
 $('#kl-csv').onclick=()=>{const lines=['apply,candidate,status,latency_ms,reference_latency_ms,accepted,reused'];for(const a of r.applies)for(const c of a.candidates)lines.push([a.apply,c.sequence,c.status,c.latency_ms??'',c.reference_latency_ms??'',c.accepted,c.reused].join(','));download(`kl-${datasetId}-candidates.csv`,lines.join('\n'),'text/csv');};
}
