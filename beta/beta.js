'use strict';
const betaConfig=JSON.parse(document.querySelector('#beta-navigation').textContent);
let betaView=new URL(location).searchParams.get('view')||'results';
let betaFuture=new URL(location).searchParams.get('edition')==='v0-r3';
let betaLogLimit=20,betaMenuId=null,betaCloseTimer=null,betaKLPending=null;
const betaHeader=$('#beta-header'),betaBackdrop=$('#beta-backdrop');
const betaLabels={started:'开始运行',paused:'暂停',resumed:'恢复运行',completed:'独立完成'};
const betaBase=document.querySelector('meta[name="beta-version"]').content;
let betaPreview=null;
let betaBannerIntroduced=false;
const betaAlignedSources=new Map(),betaKLChartArgs=new Map();
const betaPalette={'#0072b2':'#0071e3','#d55e00':'#ed6400','#cc79a7':'#d9398c','#009e73':'#009b68','#e69f00':'#e69a00'};
Object.assign(COLORS,{B1:'#0071e3',B2:'#ed6400',B3:'#d9398c',V0:'#009b68'});
function betaThemeText(hex){
 const rgb=hex.replace('#','').match(/../g)?.map(s=>parseInt(s,16)/255);if(rgb?.length!==3||rgb.some(x=>!Number.isFinite(x)))return '#fff';
 const v=rgb.map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4),l=.2126*v[0]+.7152*v[1]+.0722*v[2];return 1.05/(l+.05)>=4.5?'#fff':'#1d1d1f';
}
function betaTintCharts(){
 $$('#beta-results-view svg [stroke],#beta-results-view svg [fill]').forEach(el=>{for(const attr of ['stroke','fill']){const c=el.getAttribute(attr)?.toLowerCase();if(betaPalette[c])el.setAttribute(attr,betaPalette[c]);}});
}

function betaUpdateTitle(){
 const title=manifest?.datasets.find(d=>d.id===datasetId)?.title||datasetId;
 $('#beta-title').textContent=betaView==='logs'?'完成日志':betaView==='queue'?'队列情况':betaFuture?'V0-r3':title;
}

function betaURL(push=false){
 const url=new URL(location);url.searchParams.set('view',betaView);
 if(betaFuture)url.searchParams.set('edition','v0-r3');else url.searchParams.delete('edition');
 history[push?'pushState':'replaceState'](null,'',url);
}
function betaOpenMenu(id){
 clearTimeout(betaCloseTimer);if(betaMenuId===id)return;betaMenuId=id;
 $$('.beta-menu').forEach(el=>{const on=el.id==='beta-menu-'+id;el.classList.toggle('open',on);el.inert=!on;el.setAttribute('aria-hidden',String(!on));});
 $$('[data-beta-nav]').forEach(el=>el.setAttribute('aria-expanded',String(el.dataset.betaNav===id)));
 $('#beta-menu-surface').classList.toggle('open',!!id);
 betaBackdrop.hidden=!id;
}
function betaCloseMenu(){betaOpenMenu(null);}
function betaShowView(view,push=false){
 betaView=['results','logs','queue'].includes(view)?view:'results';
 $('#beta-results-view').hidden=betaView!=='results'||betaFuture;
 $('#beta-future-view').hidden=betaView!=='results'||!betaFuture;
 $('#beta-logs-view').hidden=betaView!=='logs';$('#beta-queue-view').hidden=betaView!=='queue';
 $$('[data-beta-nav]').forEach(el=>el.setAttribute('aria-current',el.dataset.betaNav===betaView?'page':'false'));
 betaUpdateTitle();
 $('#beta-kicker').textContent=betaView==='logs'?'开始、暂停、恢复与独立完成':betaView==='queue'?'按实际执行顺序':betaFuture?'下一版实验 · 待接入':`${betaConfig.result_sections.find(s=>s.id===category)?.label||'实验结果'} · ${datasetId}`;
 if(push)betaURL(true);
 if(betaView==='logs')betaRenderLogs();
}
async function betaChoose(categoryId,dataset=datasetId,model=null){
 betaSetPreview(null);
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
 betaRenderBanner();
 const current=$('#beta-log-dataset').value;
 $('#beta-log-dataset').innerHTML='<option value="all">全部测试集</option>'+manifest.datasets.map(d=>`<option value="${esc(d.id)}">${esc(d.id)}</option>`).join('');$('#beta-log-dataset').value=current||'all';
 betaEnsureKL().then(()=>{if(betaView==='logs')betaRenderLogs();});
 betaDecorateControls();
 if(manifest.beta_frontend_version&&manifest.beta_frontend_version!==betaBase){
  const url=new URL(location);if(url.searchParams.get('beta_version')!==manifest.beta_frontend_version){url.searchParams.set('beta_version',manifest.beta_frontend_version);location.replace(url.href);}
 }
}

function betaRenderBanner(){
 const banner=$('#beta-live-banner'),runs=[...(manifest.running_runs||[]),...(manifest.kl?.running_runs||[])];
 const html=runs.length?'正在运行： '+runs.map(r=>`<a href="?view=results&category=${r.category==='kl'||r.method==='KL'?'kl':'bv'}&dataset=${esc(r.dataset)}&run=${esc(r.id)}" data-beta-banner-run="${esc(r.id)}" data-target="${esc(r.dataset)}" data-category="${r.category==='kl'||r.method==='KL'?'kl':'bv'}">${esc(r.dataset)} · ${esc(r.model)} ${esc(r.method)}${r.method==='KL'?` · Apply ${r.current_apply??r.reported_attempts} · r${r.internal_round??0}`:` · ${r.reported_attempts}/${r.budget} 轮`} <span aria-hidden="true">↗</span></a>`).join('<span class="beta-banner-divider" aria-hidden="true">·</span>'):'当前暂无运行任务 <a href="?view=queue" data-beta-banner-queue>查看队列 ↗</a>';
 if(banner.innerHTML!==html){banner.innerHTML=html;
  banner.querySelectorAll('[data-beta-banner-run]').forEach(a=>a.onclick=async e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();betaSetPreview(null);betaFuture=false;betaShowView('results');betaURL(true);if(a.dataset.category==='kl')await loadKL(a.dataset.target,a.dataset.betaBannerRun);else await loadDataset(a.dataset.target,true,a.dataset.betaBannerRun,true);betaSync();});
  banner.querySelector('[data-beta-banner-queue]')?.addEventListener('click',e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();betaShowView('queue',true);});
 }
 banner.hidden=false;
 if(!betaBannerIntroduced){betaBannerIntroduced=true;if(runs.length)banner.classList.add('beta-banner-intro');}
}

// Hover previews are presentation-only: the saved visibility sets never change.
function betaControlInfo(label){
 const input=label?.querySelector('input[type=checkbox]');if(!input||input.disabled)return null;
 if(input.dataset.series)return {scope:'bv',ids:[input.dataset.series]};
 if(input.dataset.modelCheck)return {scope:'bv',ids:data.runs.filter(r=>r.model===input.dataset.modelCheck&&usable(r)&&r.method!=='B0').map(r=>r.id)};
 const host=label.closest('.aligned-controls')?.parentElement;
 if(host){const scope='#'+host.id,source=betaAlignedSources.get(scope);if(!source)return null;
  const ids=input.dataset.alignedRun?[input.dataset.alignedRun]:alignedSeries(source.dataset,source.run).filter(r=>r.model===input.dataset.alignedModel).map(r=>r.id);return {scope,ids};}
 if(label.classList.contains('kl-reference-toggle')){
  const suffix=input.id?.replace('kl-v0-','')||input.closest('[id^=kl-matched-]')?.id.replace('kl-matched-','');
  return {scope:'ref:#kl-'+suffix,ids:[],kind:input.dataset.matchedKind||'full'};
 }
 return null;
}
function betaDecorateControls(){
 const running=new Set([...(manifest?.running_runs||[]),...(manifest?.kl?.running_runs||[])].map(r=>r.id));
 $$('#series-controls label,.aligned-controls label,.plot-options label,.kl-reference-toggle').forEach(label=>{
  const input=label.querySelector('input[type=checkbox]');if(!input)return;
  label.classList.add('beta-pill');label.classList.toggle('beta-pill-disabled',input.disabled);
  const info=betaControlInfo(label);label.classList.toggle('beta-running',!!info?.ids.some(id=>running.has(id)));
  if(!label.style.getPropertyValue('--color'))label.style.setProperty('--color',label.classList.contains('kl-reference-toggle')?(input.dataset.matchedKind==='same'?'#D55E00':input.dataset.matchedKind==='reduced'?'#6F61A6':'#CC79A7'):'#526c89');
  const raw=label.style.getPropertyValue('--color').trim().toLowerCase(),color=betaPalette[raw]||raw;label.style.setProperty('--color',color);label.style.setProperty('--pill-text',betaThemeText(color));label.style.removeProperty('color');
 });
}
function betaHighlightCurves(){
 betaTintCharts();
 $$('[data-beta-glint]').forEach(e=>e.remove());
 $$('.beta-curve-highlight').forEach(e=>e.classList.remove('beta-curve-highlight'));
 if(!betaPreview)return;
 const scope=betaPreview.scope,root=scope==='bv'?$('#bv-panel'):scope.startsWith('ref:')?$(scope.slice(4)):$(scope);
 if(!root)return;
 const paths=[...root.querySelectorAll(scope.startsWith('ref:')?'[data-reference]':'path[data-run],path[data-aligned-curve]')].filter(p=>scope.startsWith('ref:')?p.dataset.reference===betaPreview.kind:betaPreview.ids.includes(p.dataset.run||p.dataset.alignedCurve));
 for(const p of paths){
  p.classList.add('beta-curve-highlight');p.style.setProperty('--curve-color',p.getAttribute('stroke'));
  const light=p.cloneNode(true);light.removeAttribute('id');light.removeAttribute('data-run');light.removeAttribute('data-aligned-curve');light.removeAttribute('data-reference');light.removeAttribute('class');light.setAttribute('data-beta-glint','');light.setAttribute('aria-hidden','true');light.classList.add('beta-curve-glint');light.style.setProperty('--curve-color',p.getAttribute('stroke'));p.parentNode.append(light);
 }
}
function betaRedrawPreview(scope){
 if(scope==='bv')renderCharts();
 else if(scope.startsWith('ref:')){const args=betaKLChartArgs.get(scope.slice(4));if(args)klChart(...args);}
 else {const s=betaAlignedSources.get(scope);if(s)renderAligned(scope,s.dataset,s.run,true);}
}
function betaSetPreview(next){
 if(JSON.stringify(next)===JSON.stringify(betaPreview))return;
 const previous=betaPreview;betaPreview=next;
 for(const scope of new Set([previous?.scope,next?.scope].filter(Boolean)))betaRedrawPreview(scope);
 betaHighlightCurves();
}
function betaPreviewEvent(e,on){
 const label=e.target.closest?.('.beta-pill');if(!label||label.contains(e.relatedTarget))return;
 if(e.pointerType==='touch')return;
 if(on)betaSetPreview(betaControlInfo(label));else betaSetPreview(null);
}
document.addEventListener('pointerover',e=>betaPreviewEvent(e,true));
document.addEventListener('pointerout',e=>betaPreviewEvent(e,false));
document.addEventListener('focusin',e=>betaPreviewEvent(e,true));
document.addEventListener('focusout',e=>betaPreviewEvent(e,false));
document.addEventListener('change',()=>{betaDecorateControls();betaHighlightCurves();});
const betaOriginalSelected=selected;
selected=function(){const rows=betaOriginalSelected();if(betaPreview?.scope==='bv')for(const r of data.runs)if(betaPreview.ids.includes(r.id)&&usable(r)&&r.method!=='B0'&&!rows.includes(r))rows.push(r);return rows;};
const betaOriginalCharts=renderCharts;
renderCharts=function(){betaOriginalCharts();betaHighlightCurves();};
const betaOriginalKLChart=klChart;
klChart=function(...args){
 betaKLChartArgs.set(args[0],args);
 const renderArgs=[...args];
 if(betaPreview?.scope==='ref:'+args[0]){
  if(betaPreview.kind==='full')renderArgs[5]=klReference;
  else {const ref=klMatchedReferences(klDatasetCache.get(`${manifest.updated_at}:${datasetId}`),klRun).find(r=>r.kind===betaPreview.kind);if(ref)renderArgs[7]=[...(args[7]||[]).filter(r=>r.kind!==ref.kind),ref];}
 }
 betaOriginalKLChart(...renderArgs);betaHighlightCurves();
};

// Reuse the analysis DOM and rendering functions; only the navigation owns placement.
const oldHeader=$('.page-head');$('#beta-snapshot').append(oldHeader.querySelector('.update'),oldHeader.querySelector('.api-link'));oldHeader.remove();
for(const id of ['kl-overview','kl-candidates']){const chart=$('#'+id);chart.parentNode.querySelector('.chart-title').after(chart);}
const queueView=$('#beta-queue-view');queueView.append($('.running-bar'),$('#waiting-bar'),$('#campaign-status'));
const queueSection=$('#kl-queue').closest('section');queueSection.querySelector('h3').textContent='本批完整队列';queueSection.querySelector('.section-head>span').textContent='原队列顺序';queueView.append(queueSection);
const legacyLog=$('#task-log');legacyLog.hidden=true;$('#beta-legacy-log').append(legacyLog);
$$('a[href^="./api/"]').forEach(a=>a.setAttribute('href','../'+a.getAttribute('href').slice(2)));
const originalRenderRunning=renderRunning;renderRunning=function(){originalRenderRunning();betaBindQueueLinks();betaSync();};
const originalRenderAll=renderAll;renderAll=function(){originalRenderAll();betaV0Labels();betaUpdateTitle();betaDecorateControls();betaHighlightCurves();};
const originalRenderKL=renderKL;renderKL=function(){originalRenderKL();betaV0Labels();betaQueueTable();betaShowView(betaView);betaDecorateControls();betaHighlightCurves();};
const originalRenderNav=renderNav;renderNav=function(){originalRenderNav();betaShowView(betaView);};
const originalRenderAligned=renderAligned;renderAligned=function(target,dataset,run,preserveControls=false){
 if(!dataset)return;betaAlignedSources.set(target,{dataset,run});
 const controls=preserveControls?$(target).querySelector('.aligned-controls'):null;
 originalRenderAligned(target,dataset,run,betaPreview?.scope===target?betaPreview.ids:[]);
 if(controls)$(target).querySelector('.aligned-controls').replaceWith(controls);
 betaV0Labels();betaDecorateControls();betaHighlightCurves();
};

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
