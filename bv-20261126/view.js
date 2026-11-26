"use strict";
const el=id=>document.getElementById(id);
const names={planned:"待派发",unscheduled:"未排期",claimed:"已认领",unclaimed:"待认领",intent:"已登记",starting:"启动中",running:"运行中",finished:"已复验",no_acceptable_result:"无通过结果",needs_reconciliation:"待核查",withdrawn:"已撤销",paused:"已暂停",passed:"通过",candidate_failure:"候选失败",infrastructure:"基础设施问题",unclassified:"待归因"};
const ms=v=>Number.isFinite(v)?v.toLocaleString("zh-CN",{maximumSignificantDigits:6}):"—";
const make=(tag,txt)=>{const n=document.createElement(tag);n.textContent=txt;return n};
const params=new URLSearchParams(location.search);let batch,chosen=params.get("method"),first=true;
if(params.get("embed")==="1"){
 document.querySelector("nav").hidden=true;document.querySelector("h1").hidden=true;document.querySelector("main").style.padding="4px 0";
 new ResizeObserver(()=>parent.postMessage({type:"bv-embed-height",height:document.body.scrollHeight},location.origin)).observe(document.body);
}
function choose(id,items){const s=el(id);const old=s.value;s.replaceChildren(...items.map(x=>new Option(x,x)));if(items.includes(old))s.value=old;}
function drawCurves(cells){
 const canvas=el("curves"), ctx=canvas.getContext("2d"), points=cells.flatMap(c=>c.attempts.filter(a=>a.timing).map(a=>({n:a.number,y:a.timing.p50_ms,m:c.method})));
 canvas.hidden=!points.length;if(!points.length)return;
 const width=Math.max(320,Math.floor(canvas.getBoundingClientRect().width)),height=166,scale=window.devicePixelRatio||1;
 canvas.width=width*scale;canvas.height=height*scale;ctx.scale(scale,scale);ctx.clearRect(0,0,width,height);
 const low=0,high=Math.max(...points.map(p=>p.y))*1.12, maxX=Math.max(2,...points.map(p=>p.n));
 const x=n=>64+(n-1)*(width-96)/(maxX-1),y=v=>height-30-(v-low)/(high-low)*(height-56);
 ctx.fillStyle=getComputedStyle(document.body).color;ctx.font="12px system-ui";ctx.fillText("候选 P50 (ms)",6,15);
 for(let i=0;i<3;i++){const value=high*i/2;ctx.fillText(value.toFixed(1),8,y(value)+3);ctx.strokeStyle="#aab5b680";ctx.beginPath();ctx.moveTo(62,y(value));ctx.lineTo(width-25,y(value));ctx.stroke();}
 ctx.fillText("1",62,height-8);ctx.fillText("原生尝试 "+maxX,width-95,height-8);
 const colors=["#00695c","#a34064","#28619c","#804b16","#7a46a5"];
 cells.forEach((c,i)=>{const ps=points.filter(p=>p.m===c.method);ctx.strokeStyle=ctx.fillStyle=colors[i%5];ctx.beginPath();ps.forEach((p,j)=>j?ctx.lineTo(x(p.n),y(p.y)):ctx.moveTo(x(p.n),y(p.y)));ctx.stroke();for(const p of ps){ctx.beginPath();ctx.arc(x(p.n),y(p.y),4,0,Math.PI*2);ctx.fill();}});
}
function render(){
 const cells=batch.cells.filter(c=>c.dataset===el("dataset").value&&c.model===el("model").value);
 const order=batch.methods;
 cells.sort((a,b)=>order.indexOf(a.method)-order.indexOf(b.method));drawCurves(cells);
 const running=batch.cells.filter(c=>c.status==="running").length,finished=batch.cells.filter(c=>c.status==="finished").length;
 el("status").textContent="11 月 26 日批次 · "+batch.cells.length+" 个实验格 · "+running+" 格运行中 · "+finished+" 格已独立复验"+(batch.updated_at?" · 更新于 "+new Date(batch.updated_at).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false})+" 北京时间":"");
 el("rows").replaceChildren();el("attempts").replaceChildren();
 for(const c of cells){
  const tr=document.createElement("tr");const b=make("button",c.method);b.style.borderLeft="4px solid "+["#00695c","#a34064","#28619c","#804b16","#7a46a5"][order.indexOf(c.method)];b.onclick=()=>{chosen=c.method;render()};const td=document.createElement("td");td.append(b);tr.append(td);
  const timed=c.attempts.filter(a=>a.timing);const best=timed.length?timed.reduce((a,b)=>a.timing.p50_ms<=b.timing.p50_ms?a:b):null;
  const phase=(names[c.status]||c.status)+(c.stage?" · "+c.stage:"");
  const speed=best&&Number.isFinite(c.pytorch_p50_ms)?(c.pytorch_p50_ms/best.timing.p50_ms).toFixed(2)+"×":"—";
  for(const text of [phase,c.native_attempts+" / "+c.valid_rounds,ms(best?.timing.p50_ms),ms(c.pytorch_p50_ms),speed,ms(c.formal?.p50_ms),c.formal?.sample_count??best?.timing.sample_count??"—"])tr.append(make("td",text));
  el("rows").append(tr);
  if(c.method!==chosen)continue;
  const box=el("attempts");box.append(make("h2",c.method+" · "+c.dataset));
  if(c.run_id)box.append(make("p","运行编号 "+c.run_id+" · 预热 "+c.warmup+" 次 · 计时协议 "+batch.protocol));
  if(c.workspace_path){
    for(const [name,value] of [["实验工作区",c.workspace_path],["卡副本工作树",c.worktree_path],["方法目录",c.method_path]]){
      const row=make("p",name+" ");const code=make("code",value);row.append(code);const copy=make("button","复制");copy.onclick=async()=>{try{await navigator.clipboard.writeText(value);copy.textContent="已复制";}catch{const range=document.createRange();range.selectNodeContents(code);getSelection().removeAllRanges();getSelection().addRange(range);}};row.append(" ",copy);box.append(row);
    }
  }
  if(c.cost){const elapsed=c.cost.duration_seconds;box.append(make("p","累计运行 "+(Number.isFinite(elapsed)?Math.round(elapsed)+" 秒":"—")+" · 主会话 / 评审 / 探针 token："+[c.cost.main_tokens,c.cost.reviewer_tokens,c.cost.probe_tokens].map(x=>x??"待回执").join(" / ")));}
  if(c.formal)box.append(make("p","独立复验 "+ms(c.formal.p50_ms)+" ms · 选定候选 #"+c.selected_attempt+" · "+c.formal.sample_count+" 个样本"));
  if(!c.attempts.length)box.append(make("p","尚无已结束的候选评测。"));
  for(const a of c.attempts){const det=document.createElement("details");det.append(make("summary","#"+a.number+" · "+(names[a.outcome]||a.outcome)+(a.timing?" · P50 "+ms(a.timing.p50_ms)+" ms":"")));det.append(make("p","正确性 "+a.correct_trials+" / "+a.total_trials+" · 设备作业 "+(a.job_id||"待回执")+" · "+(a.job_status||a.native_outcome||"待回执")));if(a.timing)det.append(make("code",a.timing.samples_ms.join(", ")));box.append(det);}
 }
}
window.addEventListener("message",event=>{if(event.origin===location.origin&&event.source===parent&&event.data?.type==="bv-refresh")load(event.data.stamp);});
async function load(stamp){try{const r=await fetch("../api/v1/bv-20261126.json"+(stamp?"?v="+encodeURIComponent(stamp):""),{cache:"no-cache"});if(!r.ok)throw Error(r.status);const incoming=await r.json();if(stamp&&incoming.updated_at<stamp){setTimeout(()=>load(stamp),2500);return;}if(batch?.updated_at&&incoming.updated_at<batch.updated_at)return;batch=incoming;choose("dataset",batch.datasets);choose("model",batch.models);if(first){first=false;if(batch.datasets.includes(params.get("dataset")))el("dataset").value=params.get("dataset");if(batch.models.includes(params.get("model")))el("model").value=params.get("model");}render();}catch(e){el("status").textContent="读取数据失败，请刷新重试。";}}
el("dataset").onchange=el("model").onchange=render;load();setInterval(load,300000);

