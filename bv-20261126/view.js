"use strict";
const el=id=>document.getElementById(id);
const names={unclaimed:"待认领",intent:"已登记",starting:"启动中",running:"运行中",finished:"已复验",no_acceptable_result:"无通过结果",needs_reconciliation:"待核查",withdrawn:"已撤销",paused:"已暂停",passed:"通过",candidate_failure:"候选失败",infrastructure:"基础设施问题",unclassified:"待归因"};
const ms=v=>Number.isFinite(v)?v.toLocaleString("zh-CN",{maximumSignificantDigits:6}):"—";
const make=(tag,txt)=>{const n=document.createElement(tag);n.textContent=txt;return n};
let batch, chosen;
function choose(id,items){const s=el(id);const old=s.value;s.replaceChildren(...items.map(x=>new Option(x,x)));if(items.includes(old))s.value=old;}
function render(){
 const cells=batch.cells.filter(c=>c.dataset===el("dataset").value&&c.model===el("model").value);
 const order=batch.methods;
 cells.sort((a,b)=>order.indexOf(a.method)-order.indexOf(b.method));
 const running=batch.cells.filter(c=>c.status==="running").length,finished=batch.cells.filter(c=>c.status==="finished").length;
 el("status").textContent="11 月 26 日批次 · "+batch.cells.length+" 个实验格 · "+running+" 格运行中 · "+finished+" 格已独立复验";
 el("rows").replaceChildren();el("attempts").replaceChildren();
 for(const c of cells){
  const tr=document.createElement("tr");const b=make("button",c.method);b.onclick=()=>{chosen=c.method;render()};const td=document.createElement("td");td.append(b);tr.append(td);
  const timed=c.attempts.filter(a=>a.timing);const best=timed.length?timed.reduce((a,b)=>a.timing.p50_ms<=b.timing.p50_ms?a:b):null;
  const phase=(names[c.status]||c.status)+(c.stage?" · "+c.stage:"");
  for(const text of [phase,c.native_attempts+" / "+c.valid_rounds,ms(best?.timing.p50_ms),ms(c.formal?.p50_ms),c.formal?.sample_count??best?.timing.sample_count??"—"])tr.append(make("td",text));
  el("rows").append(tr);
  if(c.method!==chosen)continue;
  const box=el("attempts");box.append(make("h2",c.method+" · "+c.dataset));
  if(c.run_id)box.append(make("p","运行编号 "+c.run_id+" · 预热 "+c.warmup+" 次 · 计时协议 "+batch.protocol));
  if(!c.attempts.length)box.append(make("p","尚无已结束的候选评测。"));
  for(const a of c.attempts){const det=document.createElement("details");det.append(make("summary","#"+a.number+" · "+(names[a.outcome]||a.outcome)+(a.timing?" · P50 "+ms(a.timing.p50_ms)+" ms":"")));if(a.timing)det.append(make("code",a.timing.samples_ms.join(", ")));box.append(det);}
 }
}
async function load(){try{const r=await fetch("../api/v1/bv-20261126.json",{cache:"no-cache"});if(!r.ok)throw Error(r.status);batch=await r.json();choose("dataset",batch.datasets);choose("model",batch.models);render();}catch(e){el("status").textContent="读取数据失败，请刷新重试。";}}
el("dataset").onchange=el("model").onchange=render;load();setInterval(load,300000);

