/* Bind the current B/V edition to the native queue, results and directory views. */
(() => {
  const script = document.currentScript;
  const editionUrl = new URL("./", script.src);
  const text = (tag, value) => {const node=document.createElement(tag);node.textContent=value;return node;};
  const human = {"running":"占用设备","queued":"等待设备","eval":"候选评测","msprof":"性能分析","finish":"独立复验","profiling":"性能分析"};
  function route(id) {
    const parts=String(id).split("--");
    if(parts.length!==4||parts[0]!=="bv26")return null;
    const u=new URL(editionUrl);
    u.search=new URLSearchParams({method:parts[1],dataset:parts[2],model:{"gpt-astra":"gpt-6.2-astra","gpt-sol":"gpt-6.2-sol",deepseek:"deepseek-flash"}[parts[3]]});
    return u;
  }
  function link(label,id) {const a=text("a",label);a.href=route(id)||editionUrl;return a;}
  function mount(parent,id,tag="section") {
    let el=document.getElementById(id);if(el)return el;
    const host=document.querySelector(parent);if(!host)return null;
    el=document.createElement(tag);el.id=id;el.className="panel bv-current-panel";host.prepend(el);return el;
  }
  function update(){
    if(typeof manifest==="undefined"||!manifest?.bv_20261126)return;
    const info=manifest.bv_20261126;
    const runs=new Map((manifest.bv_revisions?.runs||[]).filter(r=>r.edition==="bv-20261126").map(r=>[r.id,r]));
    const queue=mount("#beta-queue-view","bv-current-queue");
    if(queue && queue.dataset.stamp!==manifest.updated_at){
      queue.dataset.stamp=manifest.updated_at;queue.replaceChildren(text("h2","B/V · 设备队列"));
      const requests=info.fifo.requests;
      queue.append(text("p",info.card+" · NPU "+info.logical_device+" · "+info.running+" 个运行会话 · "+info.planned+" 格待派发"));
      if(info.fifo.hold)queue.append(text("strong","设备队列已挂起，等待核查。"));
      if(!requests.length)queue.append(text("p",info.fifo.known?"当前没有设备票据。":"尚无设备队列回执。"));
      else {
        const table=document.createElement("table"),head=document.createElement("thead"),hr=document.createElement("tr");
        ["顺序","设备票号","实验格","作业","设备状态"].forEach(x=>hr.append(text("th",x)));head.append(hr);table.append(head);
        const body=document.createElement("tbody");
        for(const q of requests){
          const r=runs.get(q.cell_id),tr=document.createElement("tr");tr.dataset.ticket=q.ticket;
          tr.append(text("td",q.position),text("td","#"+q.ticket));
          const cell=document.createElement("td");cell.append(r?link(r.dataset+" · "+r.method+" · "+r.model,r.id):text("span","其他工作区"));tr.append(cell,text("td",human[q.operation]||q.operation||"—"),text("td",human[q.status]||q.status));body.append(tr);
        }
        table.append(body);queue.append(table);
      }
    }
    for(const [view,label] of [["results","B/V 11·26 · 搜索与复验"],["comparison","B/V 11·26 · 方法对比"]]){
      const host=document.querySelector("#beta-"+view+"-view");if(!host||host.hidden)continue;
      const panel=mount("#beta-"+view+"-view","bv-current-"+view);
      if(!panel)continue;
      const ds=(typeof datasetId!=="undefined"&&info.datasets.includes(datasetId))?datasetId:"Sonny";
      if(panel.dataset.dataset===ds){
        if(panel.dataset.stamp!==manifest.updated_at){panel.dataset.stamp=manifest.updated_at;panel.querySelector("iframe")?.contentWindow?.postMessage({type:"bv-refresh",stamp:manifest.updated_at},location.origin);}
        continue;
      }
      panel.dataset.stamp=manifest.updated_at;
      panel.dataset.dataset=ds;panel.replaceChildren(text("h2",label));
      const frame=document.createElement("iframe");frame.title=label;
      const u=new URL(editionUrl);u.search=new URLSearchParams({embed:"1",dataset:ds});frame.src=u.href;
      frame.style.cssText="width:100%;height:400px;border:0";panel.append(frame);
    }
    const dir=document.getElementById("ws-rows");
    if(dir)for(const button of dir.querySelectorAll("[data-ws-copy]")){
      const r=runs.get(button.dataset.wsCopy);
      if(!r||button.parentElement.querySelector(".bv-worktree"))continue;
      const detail=document.createElement("details");detail.className="bv-worktree";detail.append(text("summary","工作树与方法目录"));
      for(const [label,value] of [["卡副本工作树",r.worktree_path],["方法目录",r.method_path]]){
        const line=text("div",label+" ");line.append(text("code",value));const copy=text("button","复制");copy.type="button";
        copy.onclick=async()=>{try{await navigator.clipboard.writeText(value);copy.textContent="已复制";}catch{copy.textContent="请选择路径复制";}};line.append(copy);detail.append(line);
      }
      button.parentElement.append(detail);
    }
    // Real hrefs also work with copy link, open in a new tab and keyboard navigation.
    for(const a of document.querySelectorAll('a[href*="run=bv26--"]')){
      const u=route(new URL(a.href).searchParams.get("run"));if(u){a.href=u.href;a.dataset.bvEditionLink="1";}
    }
  }
  document.addEventListener("click",e=>{
    const a=e.target.closest("a");if(!a)return;
    const old=new URL(a.href,location.href),u=route(old.searchParams.get("run"));
    if(!u&&!a.dataset.bvEditionLink)return;
    if(u)a.href=u.href;
    e.stopImmediatePropagation();
  },true);
  const direct=route(new URL(location.href).searchParams.get("run"));if(direct){location.replace(direct);return;}
  let scheduled=false;
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;update();});}}
  new MutationObserver(schedule).observe(document.querySelector("main")||document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["hidden"]});
  window.addEventListener("message",e=>{if(e.origin!==location.origin||e.data?.type!=="bv-embed-height")return;for(const frame of document.querySelectorAll(".bv-current-panel iframe"))if(e.source===frame.contentWindow)frame.style.height=Math.min(1200,Math.max(250,Number(e.data.height)||400))+"px";});
  document.addEventListener("experiment:routechange",schedule);
  schedule();
})();

