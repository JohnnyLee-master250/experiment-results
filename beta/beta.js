'use strict';
const betaConfig=JSON.parse(document.querySelector('#beta-navigation').textContent);
let betaView=new URL(location).searchParams.get('view')||'results';
let betaFuture=false;
let betaLogLimit=20,betaMenuId=null,betaCloseTimer=null,betaKLPending=null;
let betaMenuIntentTimer=null,betaMenuIntentId=null,betaPointerY=null;
let betaMenuCloseTimer=null,betaResultStamp=null;
const betaMotions=new WeakMap(),betaDisclosureMotions=new WeakMap();
const betaSliderPositions=new WeakMap();
let betaSliderFrame=null;
function betaReducedMotion(){return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;}
function betaAnimateContent(el){
 if(!el||el.hidden||!el.animate||betaReducedMotion())return;
 betaMotions.get(el)?.cancel();
 const animation=el.animate([{opacity:.55,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:240,easing:'cubic-bezier(.2,.7,.2,1)'});
 betaMotions.set(el,animation);animation.onfinish=()=>betaMotions.delete(el);
}
function betaResultMotion(){
 if(betaView!=='results'||betaFuture)return;
 const stamp=[category,datasetId,axisMode,category==='kl'?klRun?.id:'',category==='kl'?klApply:''];
 if(JSON.stringify(stamp)===JSON.stringify(betaResultStamp))return;
 const onlyApply=betaResultStamp&&stamp.slice(0,4).every((v,i)=>v===betaResultStamp[i]);
 betaResultStamp=stamp;
 if(onlyApply){betaAnimateContent($('#kl-candidates'));betaAnimateContent($('#kl-candidate-rows'));}
 else betaAnimateContent($(category==='kl'?'#kl-body':category==='aligned'?'#aligned-content':'#bv-panel'));
}
const betaHeader=$('#beta-header'),betaBackdrop=$('#beta-backdrop');
const betaLabels={started:'开始运行',paused:'暂停',resumed:'恢复运行',completed:'独立完成'};
const betaBase=document.querySelector('meta[name="beta-version"]').content;
let betaPreview=null;
let betaControlsRendering=0;
let betaBannerIntroduced=false;
const betaAlignedSources=new Map(),betaKLChartArgs=new Map();
const betaPalette={'#0072b2':'#0071e3','#d55e00':'#ed6400','#cc79a7':'#d9398c','#009e73':'#009b68','#e69f00':'#e69a00'};
Object.assign(COLORS,{B1:'#0071e3',B2:'#ed6400',B3:'#d9398c',V0:'#009b68'});
function betaThemeText(){return '#fff';}
function betaTintCharts(){
 $$('#beta-results-view svg [stroke],#beta-results-view svg [fill]').forEach(el=>{for(const attr of ['stroke','fill']){const c=el.getAttribute(attr)?.toLowerCase();if(betaPalette[c])el.setAttribute(attr,betaPalette[c]);}});
}

function betaUpdateTitle(){
 const title=manifest?.datasets.find(d=>d.id===datasetId)?.title||datasetId;
 const section=betaConfig.result_sections.find(s=>s.id===(category==='bv'&&bvEdition!=='legacy'?bvEdition:category))?.label;
 $('#beta-title').textContent=betaView==='logs'?'完成日志':betaView==='queue'?'队列情况':betaFuture?'V0-r3':title+(section?' · '+section:'');
 const metadata=$('#beta-run-meta');if(!metadata)return;
 const r=category==='kl'&&betaView==='results'&&!betaFuture?klRun:null;
 metadata.hidden=!r;
 if(r){const apply=r.current_apply??r.applies.at(-1)?.apply??0;metadata.innerHTML=`<span class="beta-run-progress">Apply ${apply} <span>·</span> r${r.aligned?.count??0}</span><div class="beta-run-times"><span>开始 ${date(r.started_at)}</span><span>结束 ${date(r.finished_at)}</span></div>`;}
}

function betaURL(push=false){
 const url=new URL(location);url.searchParams.set('view',betaView);
 if(bvEdition!=='legacy'&&category==='bv')url.searchParams.set('edition',bvEdition);else url.searchParams.delete('edition');
 history[push?'pushState':'replaceState'](null,'',url);
}
function betaOpenMenu(id){
 betaCancelMenuIntent();
 clearTimeout(betaCloseTimer);if(betaMenuId===id)return;const previous=betaMenuId;betaMenuId=id;
 clearTimeout(betaMenuCloseTimer);$$('.beta-menu.closing').forEach(el=>el.classList.remove('closing'));
 if(!id&&previous&&!betaReducedMotion()){$('#beta-menu-'+previous).classList.add('closing');betaMenuCloseTimer=setTimeout(()=>$$('.beta-menu.closing').forEach(el=>el.classList.remove('closing')),340);}
 $$('.beta-menu').forEach(el=>{const on=el.id==='beta-menu-'+id;el.classList.toggle('open',on);el.inert=!on;el.setAttribute('aria-hidden',String(!on));});
 $$('[data-beta-nav]').forEach(el=>el.setAttribute('aria-expanded',String(el.dataset.betaNav===id)));
 $('#beta-menu-surface').classList.toggle('open',!!id);
 betaBackdrop.hidden=!id;
}
function betaCancelMenuIntent(){clearTimeout(betaMenuIntentTimer);betaMenuIntentId=null;}
function betaScheduleMenu(id,delay=320){
 betaCancelMenuIntent();betaMenuIntentId=id;
 betaMenuIntentTimer=setTimeout(()=>{if(betaMenuIntentId===id)betaOpenMenu(id);},delay);
}
function betaCloseMenu(){betaOpenMenu(null);}
function betaShowView(view,push=false){
 const previous=betaView;
 betaView=['results','logs','queue'].includes(view)?view:'results';
 $('#beta-results-view').hidden=betaView!=='results'||betaFuture;
 $('#beta-future-view').hidden=betaView!=='results'||!betaFuture;
 $('#beta-logs-view').hidden=betaView!=='logs';$('#beta-queue-view').hidden=betaView!=='queue';
 $$('[data-beta-nav]').forEach(el=>el.setAttribute('aria-current',el.dataset.betaNav===betaView?'page':'false'));
 betaUpdateTitle();
 $('#beta-kicker').hidden=true;$('#beta-kicker').textContent='';
 if(push)betaURL(true);
 if(betaView==='logs')betaRenderLogs();
 if(previous!==betaView)betaAnimateContent($('#beta-'+(betaFuture&&betaView==='results'?'future':betaView)+'-view'));
}
async function betaChoose(categoryId,dataset=datasetId,model=null){
 betaSetPreview(null);
 betaFuture=false;if(['bv','v0-r3','bn-r2'].includes(categoryId))bvEdition=categoryId==='bv'?'legacy':categoryId;betaCloseMenu();betaShowView('results');betaURL(true);
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
 $$('[data-beta-dataset]').forEach(b=>b.onclick=()=>betaChoose(category==='bv'&&bvEdition!=='legacy'?bvEdition:category,b.dataset.betaDataset));
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
 const previous=$('#beta-timeline').innerHTML;
 const ds=$('#beta-log-dataset').value,kind=$('#beta-log-kind').value,cat=$('#beta-log-category').value;
 const events=betaEvents().filter(e=>(ds==='all'||e.runs.some(r=>r.dataset===ds))&&(kind==='all'||kind===e.kind)&&(cat==='all'||cat===e.category));
 $('#beta-log-count').textContent=`${events.length} 条`;
 $('#beta-timeline').innerHTML=events.slice(0,betaLogLimit).map(e=>`<li class="${esc(e.kind)}"><time datetime="${esc(e.at)}">${date(e.at)} SGT${e.time_basis==='observed'?' · 记录时间':''}</time><div class="beta-event-body"><span class="beta-event-kind">${betaLabels[e.kind]||esc(e.kind)}</span><div class="beta-event-links">${e.runs.map(r=>`<a href="?view=results&category=${e.category}&dataset=${esc(r.dataset)}&run=${esc(r.id)}" data-beta-event="${esc(r.id)}" data-event-category="${e.category}" data-event-dataset="${esc(r.dataset)}">${esc(r.dataset)} · ${esc(r.model)} ${esc(methodLabel(r))} ↗</a>`).join('')}</div><p>${esc(e.reason)}</p></div></li>`).join('')||'<li class="empty">暂无记录</li>';
 $('#beta-log-more').hidden=events.length<=betaLogLimit;
 $$('[data-beta-event]').forEach(a=>a.onclick=async e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();betaFuture=false;betaShowView('results');betaURL(true);if(a.dataset.eventCategory==='kl')await loadKL(a.dataset.eventDataset,a.dataset.betaEvent);else await loadDataset(a.dataset.eventDataset,true,a.dataset.betaEvent,true);betaSync();});
 betaSyncSelectChoices();
 if(betaView==='logs'&&previous!==$('#beta-timeline').innerHTML)betaAnimateContent($('#beta-timeline'));
}
function betaQueueTable(){
 const rows=[...(manifest?.bv_revisions?.queue||[]).map(r=>({...r,position:r.queue_position,category:'bv'})),...(manifest?.kl?.queue||[]).map(r=>({...r,category:'kl',method:'KL'}))];
 $('#kl-queue').innerHTML=`<table><thead><tr><th>顺序</th><th>测试集</th><th>模型</th><th>环境</th><th>状态</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.position}</td><td><a href="?view=results&category=${r.category}&dataset=${esc(r.dataset)}&run=${esc(r.id)}" data-beta-category-target="${r.category}" data-beta-queued="${esc(r.id)}" data-target="${esc(r.dataset)}">${esc(r.dataset)} · ${esc(methodLabel(r))} ↗</a></td><td>${esc(r.model)} <small>${esc(r.effort)}</small></td><td>${esc(r.environment_name)}</td><td>${klStatus(r.status)}</td></tr>`).join('')}</tbody></table>`;
 $$('[data-beta-queued]').forEach(a=>a.onclick=async e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();betaFuture=false;betaShowView('results');betaURL(true);if(a.dataset.betaCategoryTarget==='bv')await loadDataset(a.dataset.target,true,a.dataset.betaQueued,true);else await loadKL(a.dataset.target,a.dataset.betaQueued);betaSync();});
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
 $('#beta-waiting-total').textContent=(manifest.waiting_runs||manifest.kl?.waiting_runs)?.length||0;
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
 const html=runs.length?'正在运行： '+runs.map(r=>`<a href="?view=results&category=${r.category==='kl'||r.method==='KL'?'kl':'bv'}&dataset=${esc(r.dataset)}&run=${esc(r.id)}" data-beta-banner-run="${esc(r.id)}" data-target="${esc(r.dataset)}" data-category="${r.category==='kl'||r.method==='KL'?'kl':'bv'}">${esc(r.dataset)} · ${esc(r.model)} ${esc(methodLabel(r))}${r.method==='KL'?` · Apply ${r.current_apply??r.reported_attempts} · r${r.internal_round??0}`:` · ${r.reported_attempts}/${r.budget} 轮`} <span aria-hidden="true">↗</span></a>`).join('<span class="beta-banner-divider" aria-hidden="true">·</span>'):'当前暂无运行任务 <a href="?view=queue" data-beta-banner-queue>查看队列 ↗</a>';
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
  if(label.classList.contains('chip')&&input.dataset.alignedRun)for(const node of label.childNodes)if(node.nodeType===Node.TEXT_NODE&&node.nodeValue.includes('Aligned KL'))node.nodeValue=node.nodeValue.replace('Aligned KL','KL');
  const info=betaControlInfo(label);label.classList.toggle('beta-running',!!info?.ids.some(id=>running.has(id)));
  if(!label.style.getPropertyValue('--color'))label.style.setProperty('--color',label.classList.contains('kl-reference-toggle')?(input.dataset.matchedKind==='same'?'#D55E00':input.dataset.matchedKind==='reduced'?'#6F61A6':'#CC79A7'):'#526c89');
  const raw=label.style.getPropertyValue('--color').trim().toLowerCase(),color=betaPalette[raw]||raw;label.style.setProperty('--color',color);label.style.setProperty('--pill-text',betaThemeText(color));label.style.removeProperty('color');
 });
 betaSyncSelectChoices();
}
function betaSyncSelectChoices(){
 $$('#beta-results-view select,#beta-logs-view select').forEach(select=>{
  if(select.closest('#beta-legacy-log'))return;
  if(select.id==='kl-apply'){
   select.hidden=false;select.classList.add('beta-apply-select');select.closest('label').classList.add('beta-apply-field');return;
  }
  let field=select.closest('.beta-select-field');
  if(!field){
   const label=select.closest('label');field=document.createElement('div');field.className='beta-select-field';
   const caption=document.createElement('span');caption.className='beta-select-label';caption.textContent=label?[...label.childNodes].filter(n=>n!==select).map(n=>n.textContent).join('').trim():select.getAttribute('aria-label')||'';
   if(label)label.replaceWith(field);else select.before(field);field.append(caption,select);
   select.hidden=true;const group=document.createElement('div');group.className='segments beta-select-segments';group.setAttribute('role','radiogroup');group.setAttribute('aria-label',select.getAttribute('aria-label')||caption.textContent);field.append(group);
  }
  const group=field.querySelector('.beta-select-segments'),options=[...select.querySelectorAll('option')],signature=options.map(o=>o.value+'\0'+o.textContent).join('\n');
  if(group.dataset.options!==signature){group.dataset.options=signature;delete group.dataset.visibleSelection;group.replaceChildren(...options.map(option=>{
   const button=document.createElement('button');button.type='button';button.dataset.value=option.value;button.textContent=option.textContent;button.setAttribute('role','radio');
   button.onclick=()=>{select.value=option.value;select.dispatchEvent(new window.Event('change',{bubbles:true}));betaSyncSelectChoices();};
   button.onkeydown=e=>{const all=[...group.querySelectorAll('button:not(:disabled)')],i=all.indexOf(button);let next;if(e.key==='ArrowRight'||e.key==='ArrowDown')next=all[(i+1)%all.length];else if(e.key==='ArrowLeft'||e.key==='ArrowUp')next=all[(i-1+all.length)%all.length];else if(e.key==='Home')next=all[0];else if(e.key==='End')next=all.at(-1);if(next){e.preventDefault();next.click();next.focus();}};
   return button;
  }));}
  [...group.children].forEach((button,i)=>{const on=button.dataset.value===select.value;button.disabled=select.disabled||options[i].disabled;button.classList.toggle('selected',on);button.setAttribute('aria-checked',String(on));button.setAttribute('aria-pressed',String(on));button.tabIndex=on?0:-1;});
  // Reveal a changed selection within its own track without moving the page.
  // Ordinary redraws preserve the user's manual horizontal scroll position.
  if(group.dataset.visibleSelection!==select.value)requestAnimationFrame(()=>{
   if(!group.isConnected||!group.clientWidth)return;
   const active=group.querySelector('[aria-checked="true"]');if(!active)return;
   const track=group.getBoundingClientRect(),item=active.getBoundingClientRect();
   if(item.left<track.left+6)group.scrollLeft+=item.left-track.left-6;
   else if(item.right>track.right-6)group.scrollLeft+=item.right-track.right+6;
   group.dataset.visibleSelection=select.value;
  });
 });
 betaScheduleSliders();
}
// Keep a single capsule in each track. Its position changes; it is never
// recreated with the selected button, including during data-driven redraws.
function betaScheduleSliders(){
 if(betaSliderFrame!==null)return;
 betaSliderFrame=requestAnimationFrame(()=>{betaSliderFrame=null;betaSyncSliders();});
}
// Size only colored curve choices from the longest label in the current view.
// Balance rows (4, or 2+2) without stretching buttons to fill a model card.
const betaPillMeasure=document.createElement('canvas').getContext('2d');
function betaLayoutCurvePills(){
 for(const scope of $$('#bv-panel,#aligned-content,#kl-aligned')){
  if(!scope.offsetWidth)continue;
  const groups=[...scope.querySelectorAll('.chips')].filter(group=>group.clientWidth),pills=groups.flatMap(group=>[...group.querySelectorAll(':scope>.chip.beta-pill')]);
  if(!pills.length)continue;
  const natural=pills.map(pill=>{
   const css=getComputedStyle(pill),parts=[...pill.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE?node.nodeValue.trim():node.nodeType===Node.ELEMENT_NODE&&node.tagName!=='INPUT'&&node.textContent.trim());
   const textWidth=parts.reduce((width,node)=>{betaPillMeasure.font=node.nodeType===Node.TEXT_NODE?css.font:getComputedStyle(node).font;return width+betaPillMeasure.measureText(node.textContent.trim()).width;},0);
   return textWidth+parseFloat(css.paddingLeft)+parseFloat(css.paddingRight)+parseFloat(css.borderLeftWidth)+parseFloat(css.borderRightWidth)+(parts.length-1)*(parseFloat(css.columnGap)||0)+2;
  });
  const width=Math.min(Math.ceil(Math.max(56,...natural)/4)*4,...groups.map(group=>group.clientWidth));
  const value=width+'px';if(scope.style.getPropertyValue('--curve-pill-width')!==value)scope.style.setProperty('--curve-pill-width',value);
  for(const group of groups){
   const count=group.querySelectorAll(':scope>.chip.beta-pill').length;if(!count)continue;
   const gap=parseFloat(getComputedStyle(group).columnGap)||6,maxColumns=Math.max(1,Math.floor((group.clientWidth+gap)/(width+gap)));
   const rows=Math.ceil(count/Math.min(count,maxColumns)),columns=String(Math.ceil(count/rows));
   if(group.style.getPropertyValue('--curve-pill-columns')!==columns)group.style.setProperty('--curve-pill-columns',columns);
  }
 }
}
function betaSyncSliders(){
 betaLayoutCurvePills();
 $$('.segments,.dataset-tabs').forEach(group=>{
  const active=[...group.children].find(el=>el.tagName==='BUTTON'&&(el.classList.contains('selected')||el.getAttribute('aria-pressed')==='true'||el.getAttribute('aria-current')==='true'));
  if(!active||!group.clientWidth||!active.offsetWidth)return;
  group.classList.add('beta-sliding-selection');
  const position=[active.offsetLeft,active.offsetTop,active.offsetWidth,active.offsetHeight];
  if(position.every((v,i)=>v===betaSliderPositions.get(group)?.[i]))return;
  // Restored chart controls may have just re-entered the DOM; commit their old capsule position first.
  if(betaSliderPositions.has(group))getComputedStyle(group,'::before').transform;
  for(const [i,key] of ['x','y','width','height'].entries())group.style.setProperty('--selection-'+key,position[i]+'px');
  if(!betaSliderPositions.has(group)){
   // Establish the initial position without a fly-in from the corner.
   getComputedStyle(group,'::before').transform;
   group.classList.add('beta-slider-ready');
  }
  betaSliderPositions.set(group,position);
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
 if(betaControlsRendering)return;
 const label=e.target.closest?.('.beta-pill');if(!label||label.contains(e.relatedTarget))return;
 if(e.pointerType==='touch')return;
 if(on){if(!label.classList.contains('beta-hover-suppressed'))betaSetPreview(betaControlInfo(label));}
 else {if(e.type==='pointerout')label.classList.remove('beta-hover-suppressed');betaSetPreview(null);}
}
document.addEventListener('click',e=>{
 const label=e.target.closest?.('.beta-pill');if(!label||label.querySelector('input')?.disabled)return;
 if(label.matches(':hover'))label.classList.add('beta-hover-suppressed');
 // Checkbox pre-activation already changed checked. Let its change handler commit
 // that value before any control rendering can restore the previous selection.
 betaPreview=null;
},true);
document.addEventListener('pointerover',e=>betaPreviewEvent(e,true));
document.addEventListener('pointerout',e=>betaPreviewEvent(e,false));
document.addEventListener('focusin',e=>betaPreviewEvent(e,true));
document.addEventListener('focusout',e=>betaPreviewEvent(e,false));
document.addEventListener('change',e=>{
 const label=e.target.closest?.('.beta-pill');
 if(label&&(e.target.checked||e.target.indeterminate)){
  label.classList.remove('beta-hover-suppressed');
  if(label.matches(':hover'))betaSetPreview(betaControlInfo(label));
 }
 betaDecorateControls();betaHighlightCurves();
});
const betaOriginalSelected=selected;
selected=function(){const rows=betaOriginalSelected();if(betaPreview?.scope==='bv')for(const r of data.runs)if(betaPreview.ids.includes(r.id)&&usable(r)&&r.method!=='B0'&&!rows.includes(r))rows.push(r);return rows;};
const betaOriginalCharts=renderCharts;
renderCharts=function(){betaOriginalCharts();betaHighlightCurves();};
function betaControlSnapshot(host){return host?{host,nodes:[...host.childNodes],focus:host.contains(document.activeElement)?document.activeElement:null,animations:(host.getAnimations?.({subtree:true})||[]).filter(a=>['beta-pill-light','beta-pill-orbit'].includes(a.animationName)).map(a=>({target:a.effect.target,pseudo:a.effect.pseudoElement,name:a.animationName,start:a.startTime}))}:null;}
function betaRestoreControls(snapshot,fresh){
 if(!snapshot||!fresh)return false;
 const old=snapshot.host,oldNodes=snapshot.nodes;
 const oldInputs=oldNodes.flatMap(n=>[...(n.matches?.('input,button')?[n]:[]),...(n.querySelectorAll?.('input,button')||[])]),newInputs=[...fresh.querySelectorAll('input,button')];
 const key=e=>e.tagName+':'+e.id+':'+['series','modelCheck','model','alignedRun','alignedModel','matchedKind','alignedMode','alignedZoom','alignedCsv'].map(k=>e.dataset[k]??'-').join(':');
 if(!oldInputs.length||oldInputs.length!==newInputs.length||oldInputs.some((e,i)=>key(e)!==key(newInputs[i])))return false;
 for(let i=0;i<oldInputs.length;i++){
  const a=oldInputs[i],b=newInputs[i];a.checked=b.checked;a.indeterminate=b.indeterminate;a.disabled=b.disabled;
  a.onchange=e=>{b.checked=a.checked;b.indeterminate=a.indeterminate;return b.onchange?.call(b,e);};
  a.onclick=e=>{b.checked=a.checked;return b.onclick?.call(b,e);};
  for(const attr of ['aria-checked','aria-pressed','aria-label','title'])if(b.hasAttribute(attr))a.setAttribute(attr,b.getAttribute(attr));
  if(a.tagName==='BUTTON')a.classList.toggle('selected',b.classList.contains('selected'));
  const la=a.closest('label'),lb=b.closest('label');if(la&&lb){for(const cls of ['active','disabled','mixed'])la.classList.toggle(cls,lb.classList.contains(cls));if(lb.hasAttribute('title'))la.title=lb.title;
   if(la.classList.contains('model-toggle'))la.querySelector('span').textContent=lb.querySelector('span').textContent;
  }
 }
 old.replaceChildren(...oldNodes);if(fresh!==old)fresh.replaceWith(old);
 for(const a of old.getAnimations?.({subtree:true})||[]){const prior=snapshot.animations.find(p=>p.target===a.effect?.target&&p.pseudo===a.effect?.pseudoElement&&p.name===a.animationName);if(prior?.start!=null)a.startTime=prior.start;}
 if(snapshot.focus)snapshot.focus.focus({preventScroll:true});return true;
}
const betaOriginalControls=renderControls;
renderControls=function(){betaControlsRendering++;try{const snapshot=betaControlSnapshot($('#series-controls'));betaOriginalControls();betaRestoreControls(snapshot,$('#series-controls'));}finally{betaControlsRendering--;}};
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
const oldHeader=$('.page-head'),betaHomeStatus=$('#beta-home-status'),betaNavStatus=$('#beta-nav-status');
betaHomeStatus.href=document.body.dataset.apiBase||'./';
betaHomeStatus.prepend($('#connection'));betaHomeStatus.append($('#updated'));
const betaStatusZone=document.createElement('span');betaStatusZone.className='beta-status-zone';betaStatusZone.textContent='SGT';betaHomeStatus.append(betaStatusZone);
const betaJSONLink=oldHeader.querySelector('.api-link');betaJSONLink.textContent='JSON ↓';betaJSONLink.download='experiment-results.json';betaJSONLink.setAttribute('aria-label','下载实验结果 JSON');
const betaRefreshButton=$('#refresh');betaRefreshButton.textContent='↻';betaRefreshButton.title='Refresh';betaRefreshButton.setAttribute('aria-label','刷新实验结果');
betaNavStatus.append($('#next-update'),betaJSONLink,betaRefreshButton);oldHeader.remove();$('#beta-snapshot').remove();
function betaCompactDate(value,clockOnly=false){
 const parsed=new Date(value);if(!value||Number.isNaN(parsed.getTime()))return '—';
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Singapore',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(parsed).map(p=>[p.type,p.value]));
 return `${clockOnly?'':parts.month+'-'+parts.day+' '}${parts.hour}:${parts.minute}`;
}
function betaUpdateHeader(){
 const el=$('#updated'),at=manifest?.updated_at||el.dateTime,text=betaCompactDate(at);
 if(el.textContent!==text)el.textContent=text;
 if(at&&el.dateTime!==at)el.dateTime=at;
 betaHomeStatus.title=at?`Updated ${date(at)} SGT · 首页`:'实验结果首页';
 const next=manifest?.next_update_estimated_at,nextEl=$('#next-update');
 const sameDay=next&&at&&date(next,true)===date(at,true);
 nextEl.textContent=next?(Date.now()>Date.parse(next)?'Next pending':`Next ${betaCompactDate(next,sameDay)}`):'Next —';
 nextEl.title=next?`Estimated ${date(next)} SGT · ${manifest.update_cadence_minutes} min cadence`:'';
}
renderNextUpdate=betaUpdateHeader;
const betaTimeObserver=new window.MutationObserver(betaUpdateHeader);
betaTimeObserver.observe($('#updated'),{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['datetime']});
betaUpdateHeader();
const betaRunMeta=document.createElement('div');betaRunMeta.id='beta-run-meta';betaRunMeta.className='beta-run-meta';betaRunMeta.hidden=true;$('#beta-title').after(betaRunMeta);
const betaTitleRow=document.createElement('div');betaTitleRow.className='beta-title-row';$('#beta-title').before(betaTitleRow);betaTitleRow.append($('#beta-title'),betaRunMeta);
$('.kl-budget').hidden=true;
const betaSummarySection=$('#summary').closest('section'),betaSummaryDetails=document.createElement('details'),betaSummaryHead=document.createElement('summary');
betaSummaryDetails.className=betaSummarySection.className;betaSummaryDetails.open=true;betaSummaryHead.innerHTML='<span>实验组</span><span>延迟 ms ↓ · 完成日期 SGT</span>';betaSummaryDetails.append(betaSummaryHead,betaSummarySection.querySelector('.table-wrap'));betaSummarySection.replaceWith(betaSummaryDetails);
$$('#beta-results-view section.data-section').filter(section=>section.querySelector(':scope > .section-head h3')?.textContent==='实验工作区').forEach(section=>{
 const head=section.querySelector('.section-head'),title=head.querySelector('h3'),details=document.createElement('details'),summary=document.createElement('summary');
 for(const attr of section.attributes)details.setAttribute(attr.name,attr.value);
 details.classList.add('workspace-section');details.open=true;
 const caption=document.createElement('span');caption.textContent=title.textContent;if(title.id)caption.id=title.id;
 summary.append(caption,...[...head.children].filter(el=>el!==title));head.remove();details.append(summary,...section.childNodes);section.replaceWith(details);
});
for(const id of ['kl-overview','kl-candidates']){const chart=$('#'+id);chart.parentNode.querySelector('.chart-title').after(chart);}
const queueView=$('#beta-queue-view');queueView.append($('.running-bar'),$('#waiting-bar'),$('#campaign-status'));
const queueSection=$('#kl-queue').closest('section');queueSection.querySelector('h3').textContent='完整队列';queueSection.querySelector('.section-head>span').textContent='原队列顺序';queueView.append(queueSection);
const legacyLog=$('#task-log');legacyLog.hidden=true;$('#beta-legacy-log').append(legacyLog);
$$('a[href^="./api/"]').forEach(a=>a.setAttribute('href',(document.body.dataset.apiBase||'./')+a.getAttribute('href').slice(2)));
const originalRenderRunning=renderRunning;renderRunning=function(){originalRenderRunning();betaBindQueueLinks();betaSync();};
const betaOriginalSetMode=setMode;setMode=function(value){betaOriginalSetMode(value);betaScheduleSliders();};
const originalRenderAll=renderAll;renderAll=function(){originalRenderAll();betaV0Labels();betaUpdateTitle();betaDecorateControls();betaHighlightCurves();betaResultMotion();};
const originalRenderKL=renderKL;renderKL=function(){betaControlsRendering++;try{const saved=['overview','candidates'].map(id=>betaControlSnapshot($('#kl-matched-'+id)));originalRenderKL();saved.forEach(s=>{if(s)betaRestoreControls(s,s.host);});betaV0Labels();betaQueueTable();betaShowView(betaView);betaDecorateControls();betaHighlightCurves();betaResultMotion();}finally{betaControlsRendering--;}};
const originalRenderNav=renderNav;renderNav=function(){originalRenderNav();betaShowView(betaView);};
const originalRenderAligned=renderAligned;renderAligned=function(target,dataset,run,preserveControls=false){
 if(!dataset)return;betaAlignedSources.set(target,{dataset,run});
 betaControlsRendering++;try{
 const controls=betaControlSnapshot($(target).querySelector('.aligned-controls'));
 const options=betaControlSnapshot($(target).querySelector('.plot-options'));
 originalRenderAligned(target,dataset,run,betaPreview?.scope===target?betaPreview.ids:[]);
 betaRestoreControls(controls,$(target).querySelector('.aligned-controls'));
 betaRestoreControls(options,$(target).querySelector('.plot-options'));
 betaV0Labels();betaDecorateControls();betaHighlightCurves();
 if(category==='aligned')betaResultMotion();
 }finally{betaControlsRendering--;}
};

$$('[data-beta-nav]').forEach(b=>{
 b.onpointerenter=e=>{if(e.pointerType==='touch')return;betaPointerY=e.clientY;if(betaMenuId&&betaMenuId!==b.dataset.betaNav)betaScheduleMenu(b.dataset.betaNav);else betaOpenMenu(b.dataset.betaNav);};
 b.onpointermove=e=>{if(betaMenuIntentId===b.dataset.betaNav&&e.clientY>betaPointerY+2)betaScheduleMenu(b.dataset.betaNav,450);betaPointerY=e.clientY;};
 b.onpointerleave=betaCancelMenuIntent;
 b.onfocus=()=>betaOpenMenu(b.dataset.betaNav);
 b.onclick=()=>{betaShowView(b.dataset.betaNav,true);betaOpenMenu(b.dataset.betaNav);};
 b.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();betaOpenMenu(b.dataset.betaNav);$('#beta-menu-'+b.dataset.betaNav).querySelector('button,a')?.focus();}};
});
$('#beta-menu-surface').onpointerenter=betaCancelMenuIntent;
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
window.addEventListener('popstate',()=>{const url=new URL(location);betaFuture=false;bvEdition=requestedBVEdition();betaShowView(url.searchParams.get('view')||'results');betaCloseMenu();});
betaMenus();betaShowView(betaView);if(manifest)betaSync();

// Animate user-triggered changes only in the affected content, never sibling controls.
function betaControlMotion(e){
 const el=e.target;if(!el.closest)return;
 const aligned=el.closest('#aligned-content,#kl-aligned');
 if(aligned&&el.closest('.aligned-controls,.plot-options')){betaAnimateContent(aligned.querySelector('.aligned-chart'));return;}
 if(el.closest('.kl-reference-toggle')){betaAnimateContent(el.closest('.chart-card')?.querySelector('.chart'));return;}
 if(el.matches('#round-run,#round-status')){betaAnimateContent($('#rounds'));return;}
 if(el.matches('#y-mode,#apply-range,#reset')){betaAnimateContent($('#detail'));return;}
 if(el.closest('#series-controls')||el.matches('[data-row],#uncertainty,#best-mode,#raw-mode')){$$('#bv-panel .chart').forEach(betaAnimateContent);}
}
document.addEventListener('change',betaControlMotion);
document.addEventListener('click',e=>{if(e.target.closest?.('button'))betaControlMotion(e);});
document.addEventListener('click',e=>{
 const summary=e.target.closest?.('summary');if(!summary||e.target.closest('button,a,input'))return;
 const details=summary.parentElement;if(details.tagName!=='DETAILS')return;
 e.preventDefault();
 const previous=betaDisclosureMotions.get(details),opening=!(previous?.opening??details.open),start=details.offsetHeight;
 previous?.animation.cancel();
 if(betaReducedMotion()||!details.animate){details.open=opening;details.style.height='';details.style.overflow='';delete details.dataset.betaCollapsing;betaDisclosureMotions.delete(details);return;}
 details.open=true;details.style.height='';
 const css=getComputedStyle(details),closed=summary.offsetHeight+parseFloat(css.borderTopWidth)+parseFloat(css.borderBottomWidth)+parseFloat(css.paddingTop)+parseFloat(css.paddingBottom);
 const end=opening?details.offsetHeight:closed;
 details.style.overflow='hidden';details.style.height=start+'px';details.dataset.betaCollapsing=String(!opening);
 const animation=details.animate([{height:start+'px'},{height:end+'px'}],{duration:280,easing:'cubic-bezier(.2,.7,.2,1)',fill:'forwards'});
 betaDisclosureMotions.set(details,{animation,opening});
 animation.onfinish=()=>{details.open=opening;details.style.height='';details.style.overflow='';delete details.dataset.betaCollapsing;betaDisclosureMotions.delete(details);animation.cancel();};
},true);
function betaCloseSamples(){const dialog=$('#samples');if(betaReducedMotion()||!dialog.animate){dialog.close();return;}const animation=dialog.animate([{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(5px) scale(.99)'}],{duration:150,easing:'ease-in'});animation.onfinish=()=>dialog.close();}
$('#close-samples').onclick=betaCloseSamples;
$('#samples').addEventListener('cancel',e=>{e.preventDefault();betaCloseSamples();});
const betaSliderObserver=new window.MutationObserver(betaScheduleSliders);
betaSliderObserver.observe(document.querySelector('main'),{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-pressed','aria-current','aria-checked','hidden']});
window.addEventListener('resize',betaScheduleSliders);
document.fonts?.ready.then(betaScheduleSliders);
betaScheduleSliders();
