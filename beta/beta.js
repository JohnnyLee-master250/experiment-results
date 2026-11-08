'use strict';
const betaConfig=JSON.parse(document.querySelector('#beta-navigation').textContent);
let betaView=new URL(location).searchParams.get('view')||'results';
let betaFuture=new URL(location).searchParams.get('edition')==='v0-r3';
let betaLogLimit=20,betaMenuId=null,betaCloseTimer=null,betaKLPending=null;
const betaHeader=$('#beta-header'),betaBackdrop=$('#beta-backdrop');
const betaLabels={started:'开始运行',paused:'暂停',resumed:'恢复运行',completed:'独立完成'};
const betaBase=document.querySelector('meta[name="beta-version"]').content;

function betaURL(push=false){
 const url=new URL(location);url.searchParams.set('view',betaView);
 if(betaFuture)url.searchParams.set('edition','v0-r3');else url.searchParams.delete('edition');
 history[push?'pushState':'replaceState'](null,'',url);
}
function betaOpenMenu(id){
 clearTimeout(betaCloseTimer);betaMenuId=id;
 $$('.beta-menu').forEach(el=>{const on=el.id==='beta-menu-'+id;el.classList.toggle('open',on);el.inert=!on;el.setAttribute('aria-hidden',String(!on));});
 $$('[data-beta-nav]').forEach(el=>el.setAttribute('aria-expanded',String(el.dataset.betaNav===id)));
 betaBackdrop.hidden=!id;
}
function betaCloseMenu(){betaOpenMenu(null);}
function betaShowView(view,push=false){
 betaView=['results','logs','queue'].includes(view)?view:'results';
 $('#beta-results-view').hidden=betaView!=='results'||betaFuture;
 $('#beta-future-view').hidden=betaView!=='results'||!betaFuture;
 $('#beta-logs-view').hidden=betaView!=='logs';$('#beta-queue-view').hidden=betaView!=='queue';
 $$('[data-beta-nav]').forEach(el=>el.setAttribute('aria-current',el.dataset.betaNav===betaView?'page':'false'));
 $('#beta-title').textContent=betaView==='logs'?'完成日志。':betaView==='queue'?'队列情况。':betaFuture?'V0-r3。':'实验结果。';
 $('#beta-kicker').textContent=betaView==='logs'?'开始、暂停、恢复与独立完成':betaView==='queue'?'按实际执行顺序':betaFuture?'下一版实验 · 待接入':`${betaConfig.result_sections.find(s=>s.id===category)?.label||'实验结果'} · ${datasetId}`;
 if(push)betaURL(true);
 if(betaView==='logs')betaRenderLogs();
}
async function betaChoose(categoryId,dataset=datasetId,model=null){
 betaFuture=categoryId==='v0-r3';betaCloseMenu();betaShowView('results');betaURL(true);
 if(betaFuture)return;
 initialRun=null;
 if(categoryId==='kl'){
  await betaEnsureKL();
  const run=model?klData?.runs.find(r=>r.dataset===dataset&&r.model===model):null;
  await loadKL(dataset,run?.id||null);
 }else if(categoryId==='aligned')await loadAligned(dataset);
 else await loadDataset(dataset,true);
 betaSync();
}
function betaMenus(){
 $('#beta-result-menu').innerHTML=betaConfig.result_sections.map(s=>`<button data-beta-category="${esc(s.id)}">${esc(s.label)}${s.status==='planned'?'<small>待接入</small>':''}</button>`).join('');
 $('#beta-dataset-menu').innerHTML=(manifest?.datasets||[]).map(d=>`<button data-beta-dataset="${esc(d.id)}">${esc(d.id)}</button>`).join('');
 $$('[data-beta-category]').forEach(b=>b.onclick=()=>betaChoose(b.dataset.betaCategory));
 $$('[data-beta-dataset]').forEach(b=>b.onclick=()=>betaChoose(betaFuture?'v0-r3':category,b.dataset.betaDataset));
 $$('.beta-menu-column').forEach(col=>[...col.querySelectorAll('button,a')].forEach((b,i)=>b.style.setProperty('--reveal-delay',`${45+i*24}ms`)));
}
async function betaEnsureKL(){
 if(!manifest?.kl)return;
 if(klData?.updated_at===manifest.updated_at)return;
 const version=manifest.updated_at;
 if(betaKLPending?.version===version)return betaKLPending.promise;
 const promise=getJSON(`./api/v1/${manifest.kl.url}?v=${encodeURIComponent(version)}`).then(d=>{if(d.updated_at===manifest.updated_at)klData=d;}).catch(()=>{});
 betaKLPending={version,promise};return promise;
}
function betaEvents(){
 const rows=(manifest?.task_events||[]).map(e=>({...e,category:'bv'}));
 for(const e of klData?.task_events||[]){
  const r=klData.runs.find(r=>r.id===e.run_id);if(!r)continue;
  rows.push({...e,category:'kl',runs:[{id:r.id,dataset:r.dataset,model:r.model,method:'KL'}]});
 }
 return [...new Map(rows.map(e=>[e.category+':'+e.id,e])).values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.id.localeCompare(b.id));
}
function betaRenderLogs(){
 const ds=$('#beta-log-dataset').value,kind=$('#beta-log-kind').value,cat=$('#beta-log-category').value;
 const events=betaEvents().filter(e=>(ds==='all'||e.runs.some(r=>r.dataset===ds))&&(kind==='all'||kind===e.kind)&&(cat==='all'||cat===e.category));
 $('#beta-log-count').textContent=`${events.length} 条`;
 $('#beta-timeline').innerHTML=events.slice(0,betaLogLimit).map(e=>`<li class="${esc(e.kind)}"><time datetime="${esc(e.at)}">${date(e.at)} SGT${e.time_basis==='observed'?' · 记录时间':''}</time><div class="beta-event-body"><span class="beta-event-kind">${betaLabels[e.kind]||esc(e.kind)}</span><div class="beta-event-links">${e.runs.map(r=>`<a href="?view=results&category=${e.category}&dataset=${esc(r.dataset)}&run=${esc(r.id)}" data-beta-event="${esc(r.id)}" data-event-category="${e.category}" data-event-dataset="${esc(r.dataset)}">${esc(r.dataset)} · ${esc(r.model)} ${esc(r.method==='V0'?'V0-r2':r.method)} ↗</a>`).join('')}</div><p>${esc(e.reason)}</p></div></li>`).join('')||'<li class="empty">暂无记录</li>';
 $('#beta-log-more').hidden=events.length<=betaLogLimit;
 $$('[data-beta-event]').forEach(a=>a.onclick=async e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();betaFuture=false;betaShowView('results');betaURL(true);if(a.dataset.eventCategory==='kl')await loadKL(a.dataset.eventDataset,a.dataset.betaEvent);else await loadDataset(a.dataset.eventDataset,true,a.dataset.betaEvent,true);betaSync();});
}
function betaQueueTable(){
 const rows=manifest?.kl?.queue||[];
 $('#kl-queue').innerHTML=`<table><thead><tr><th>顺序</th><th>测试集</th><th>模型</th><th>环境</th><th>状态</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.position}</td><td><a href="?view=results&category=kl&dataset=${esc(r.dataset)}&run=${esc(r.id)}" data-beta-queued="${esc(r.id)}" data-target="${esc(r.dataset)}">${esc(r.dataset)} ↗</a></td><td>${esc(r.model)} <small>${esc(r.effort)}</small></td><td>${esc(r.environment_name)}</td><td>${klStatus(r.status)}</td></tr>`).join('')}</tbody></table>`;
 $$('[data-beta-queued]').forEach(a=>a.onclick=async e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();betaFuture=false;betaShowView('results');betaURL(true);await loadKL(a.dataset.target,a.dataset.betaQueued);betaSync();});
}
function betaV0Labels(node=$('#beta-results-view')){
 for(const child of [...node.childNodes]){
  if(child.nodeType===3&&child.nodeValue.includes('V0'))child.nodeValue=child.nodeValue.replace(/\bV0\b(?!-r[23])/g,'V0-r2');
  else if(child.nodeType===1&&!['SCRIPT','STYLE'].includes(child.tagName))betaV0Labels(child);
 }
}
function betaBindQueueLinks(){
 $$('[data-running],[data-campaign-run]').forEach(a=>{const existing=a.onclick;a.onclick=async e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;betaFuture=false;betaShowView('results');betaURL(true);await existing(e);betaSync();};});
}
function betaSync(){
 if(!manifest)return;
 betaMenus();betaQueueTable();betaV0Labels();betaShowView(betaView);
 $('#beta-running-total').textContent=(manifest.running_runs?.length||0)+(manifest.kl?.running_runs?.length||0);
 $('#beta-waiting-total').textContent=manifest.kl?.waiting_runs?.length||0;
 const current=$('#beta-log-dataset').value;
 $('#beta-log-dataset').innerHTML='<option value="all">全部测试集</option>'+manifest.datasets.map(d=>`<option value="${esc(d.id)}">${esc(d.id)}</option>`).join('');$('#beta-log-dataset').value=current||'all';
 betaEnsureKL().then(()=>{if(betaView==='logs')betaRenderLogs();});
 if(manifest.beta_frontend_version&&manifest.beta_frontend_version!==betaBase){
  const url=new URL(location);if(url.searchParams.get('beta_version')!==manifest.beta_frontend_version){url.searchParams.set('beta_version',manifest.beta_frontend_version);location.replace(url.href);}
 }
}

// Reuse the analysis DOM and rendering functions; only the navigation owns placement.
const oldHeader=$('.page-head');$('#beta-snapshot').append(oldHeader.querySelector('.update'),oldHeader.querySelector('.api-link'));oldHeader.remove();
const queueView=$('#beta-queue-view');queueView.append($('.running-bar'),$('#waiting-bar'),$('#campaign-status'));
const queueSection=$('#kl-queue').closest('section');queueSection.querySelector('h3').textContent='本批完整队列';queueSection.querySelector('.section-head>span').textContent='原队列顺序';queueView.append(queueSection);
const legacyLog=$('#task-log');legacyLog.hidden=true;$('#beta-legacy-log').append(legacyLog);
$$('a[href^="./api/"]').forEach(a=>a.setAttribute('href','../'+a.getAttribute('href').slice(2)));
const originalRenderRunning=renderRunning;renderRunning=function(){originalRenderRunning();betaBindQueueLinks();betaSync();};
const originalRenderAll=renderAll;renderAll=function(){originalRenderAll();betaV0Labels();};
const originalRenderKL=renderKL;renderKL=function(){originalRenderKL();betaV0Labels();betaQueueTable();betaShowView(betaView);};
const originalRenderNav=renderNav;renderNav=function(){originalRenderNav();betaShowView(betaView);};
const originalRenderAligned=renderAligned;renderAligned=function(...args){originalRenderAligned(...args);betaV0Labels();};

$$('[data-beta-nav]').forEach(b=>{
 b.onpointerenter=e=>{if(e.pointerType!=='touch')betaOpenMenu(b.dataset.betaNav);};
 b.onfocus=()=>betaOpenMenu(b.dataset.betaNav);
 b.onclick=()=>{betaShowView(b.dataset.betaNav,true);betaOpenMenu(b.dataset.betaNav);};
 b.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();betaOpenMenu(b.dataset.betaNav);$('#beta-menu-'+b.dataset.betaNav).querySelector('button,a')?.focus();}};
});
betaHeader.onpointerenter=()=>clearTimeout(betaCloseTimer);
betaHeader.onpointerleave=e=>{if(e.pointerType!=='touch')betaCloseTimer=setTimeout(betaCloseMenu,160);};
betaHeader.onfocusout=()=>setTimeout(()=>{if(!betaHeader.contains(document.activeElement))betaCloseMenu();},0);
betaBackdrop.onclick=betaCloseMenu;
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const id=betaMenuId;betaCloseMenu();if(id){const b=$(`[data-beta-nav="${id}"]`);b.onfocus=null;b.focus();b.onfocus=()=>betaOpenMenu(id);}}});
$$('[data-beta-model]').forEach(b=>b.onclick=()=>betaChoose('kl',datasetId,b.dataset.betaModel));
$$('[data-beta-log]').forEach(b=>b.onclick=()=>{$('#beta-log-kind').value=b.dataset.betaLog;betaLogLimit=20;betaShowView('logs',true);betaCloseMenu();betaEnsureKL().then(betaRenderLogs);});
$$('[data-beta-view]').forEach(b=>b.onclick=()=>{betaShowView(b.dataset.betaView,true);betaCloseMenu();});
$$('[data-beta-queue]').forEach(b=>b.onclick=()=>{betaShowView('queue',true);betaCloseMenu();const id=b.dataset.betaQueue;const el=id.startsWith('card')?$(`[data-card="${id}"]`):id==='schedule'?$('#kl-queue'):id==='waiting'?$('#waiting-bar'):id==='running'?$('#running-links'):null;el?.scrollIntoView({behavior:'smooth',block:'center'});});
$$('.beta-log-filters select').forEach(el=>el.onchange=()=>{betaLogLimit=20;betaRenderLogs();});
$('#beta-log-more').onclick=()=>{betaLogLimit+=20;betaRenderLogs();};
window.addEventListener('popstate',()=>{const url=new URL(location);betaFuture=url.searchParams.get('edition')==='v0-r3';betaShowView(url.searchParams.get('view')||'results');betaCloseMenu();});
betaMenus();betaShowView(betaView);if(manifest)betaSync();
