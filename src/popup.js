import { formatBytes, mediaFamily } from './core/media.js';

const $=id => document.getElementById(id);
const send=message => chrome.runtime.sendMessage({target:'background',...message});
let tabId=-1,state={candidates:[]},jobs=[],view='media',origins,pendingGrant;
const inspecting=new Set(),errors=new Map(),choices=new Map(),names=new Map();
let lastMediaSignature='';
const active=job => ['queued','downloading','finalizing','saving'].includes(job.status);
function element(tag,className,text) {const el=document.createElement(tag);if(className) el.className=className;if(text!==undefined) el.textContent=text;return el;}
function icon(text,label,action) {const button=element('button','icon',text);button.title=label;button.setAttribute('aria-label',label);button.onclick=action;return button;}
function time(seconds) {
  if (!Number.isFinite(seconds) || seconds<=0) return '';
  seconds=Math.round(seconds);return (seconds>=3600 ? Math.floor(seconds/3600)+':' : '')+String(Math.floor(seconds%3600/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
}
function thumbnail(item) {
  const box=element('div','thumb');
  const url=item.thumbnail;
  if (url && (/^https?:\/\//.test(url) || url.startsWith('data:image/jpeg;base64,'))) {
    const image=element('img');image.src=url;image.alt='';image.referrerPolicy='no-referrer';image.onerror=() => {image.remove();box.prepend(element('span','','▷'));};box.append(image);
  } else box.append(element('span','','▷'));
  if (time(item.duration)) box.append(element('span','duration',time(item.duration)));
  return box;
}
function notice(response,retry) {
  $('notice-text').textContent=response.error || 'Please retry.';$('notice').hidden=false;
  origins=response.origins;pendingGrant=retry;$('grant').hidden=!origins?.length;
}
function candidates() {
  const inline=state.candidates.filter(item=>item.manifest);
  if(inline.length && /(^|\.)instagram\.com$/.test(new URL(state.pageUrl).hostname)) return inline;
  const children=new Set(state.candidates.flatMap(item => item.children||[]));
  const streams=new Set(state.candidates.filter(item=>item.kind==='hls').map(item=>mediaFamily(item.url)).filter(Boolean));
  return state.candidates.filter(item => !children.has(item.url) && !item.parentId && !(item.kind==='file' && streams.has(mediaFamily(item.url))));
}
async function inspect(candidate) {
  if (candidate.inspected || inspecting.has(candidate.id) || errors.has(candidate.id)) return;
  inspecting.add(candidate.id);renderMedia();
  try {
    const response=await send({type:'INSPECT',tabId,candidateId:candidate.id});
    if (response.error) {errors.set(candidate.id,response.error);if(response.origins?.length) notice(response,() => {errors.delete(candidate.id);inspect(candidate);});}
    else Object.assign(candidate,response.result,{inspected:true});
  } catch {errors.set(candidate.id,'Couldn’t read this video. Retry.');}
  finally {inspecting.delete(candidate.id);renderMedia();}
}
async function start(candidate) {
  const variant=candidate.variants?.find(item => item.url===choices.get(candidate.id)) || candidate.variants?.find(item => !item.blocked);
  if (!variant) return;
  const response=await send({type:'START_JOB',tabId,candidateId:candidate.id,url:variant.url,filename:names.get(candidate.id)||candidate.title||state.title});
  if (response.error) notice(response,() => start(candidate));
  else await refresh();
}
function renderMedia(force=false) {
  const signature=JSON.stringify([view,state.title,state.thumbnail,candidates().map(item => [item.id,item.title,item.thumbnail,item.duration,item.inspected,item.variants]),[...errors],[...choices],[...names],jobs.filter(active).map(job => job.selectedUrl)]);
  if(!force && signature===lastMediaSignature) return;
  lastMediaSignature=signature;
  const list=$('media-list');list.replaceChildren();
  const items=candidates();$('empty').hidden=items.length>0;
  for (const candidate of items) {
    const card=element('article','media-card');card.append(thumbnail({...state,...candidate}));
    const content=element('div','content'),top=element('div','title-row');
    top.append(element('span','kind',candidate.kind==='file' ? 'FILE' : candidate.kind.toUpperCase()));
    const title=element('span','title',names.get(candidate.id)||candidate.title||state.title||'Video');title.title=title.textContent;top.append(title);
    const rename=icon('✎','Rename file',() => {
      const input=element('input','rename');input.value=names.get(candidate.id)||candidate.title||state.title||'Video';input.maxLength=160;
      input.onblur=() => {names.set(candidate.id,input.value.trim()||'Video');renderMedia(true);};
      input.onkeydown=event => {if(event.key==='Enter') input.blur();};
      title.replaceWith(input);input.focus();input.select();
    });rename.classList.add('edit');top.append(rename);content.append(top);
    const actions=element('div','actions'),error=errors.get(candidate.id);
    if (error) {
      content.append(element('p','row-error',error));
      actions.append(icon('↻','Retry video details',() => {errors.delete(candidate.id);inspect(candidate);}));
    } else {
      actions.append(element('span','format',candidate.kind==='file' ? 'Original' : 'MP4'));
      const quality=element('select');quality.setAttribute('aria-label',`Quality for ${title.textContent}`);
      for (const variant of candidate.variants||[]) {
        const option=element('option','',variant.height ? `${variant.height}p` : 'Original');option.value=variant.url;option.disabled=!!variant.blocked;
        if (variant.width) option.title=`${variant.width} × ${variant.height}`;quality.append(option);
      }
      if (!quality.options.length) quality.append(element('option','','…'));
      const choice=choices.get(candidate.id) || candidate.variants?.find(item => !item.blocked)?.url;
      if (choice) quality.value=choice;
      quality.onchange=() => {choices.set(candidate.id,quality.value);renderMedia();};quality.disabled=!candidate.inspected;actions.append(quality);
      const running=jobs.find(job => active(job) && job.selectedUrl===(choice || candidate.variants?.[0]?.url));
      const button=element('button','download',running ? '✓ Added' : candidate.inspected ? '↓ Download' : 'Loading…');
      button.disabled=!!running || !candidate.inspected || !candidate.variants?.some(item => !item.blocked);
      button.onclick=() => start(candidate).catch(() => notice({error:'Couldn’t start this download.'}));actions.append(button);
    }
    content.append(actions);card.append(content);list.append(card);
  }
  const ready=items.filter(item => item.inspected && item.variants?.some(variant => !variant.blocked));
  $('download-all').hidden=view!=='media' || ready.length<2;
  $('download-all').onclick=async () => {for(const item of ready) await start(item);};
}
const jobNodes=new Map();
function renderJobs() {
  $('active-count').textContent=jobs.filter(active).length;$('active-count').hidden=!jobs.some(active);
  $('jobs-empty').hidden=jobs.length>0;
  const list=$('job-list'),seen=new Set();
  for (const [index,job] of jobs.entries()) {
    seen.add(job.id);
    const mode=active(job) ? 'active' : job.status;
    let node=jobNodes.get(job.id);
    if(!node || node.mode!==mode) {
      node?.card.remove();
      const card=element('article','job-card');card.append(thumbnail(job));
      const content=element('div','content'),top=element('div','title-row');
      const title=element('span','title',job.title);title.title=job.title;top.append(title);
      if (active(job)) top.append(icon('×','Cancel download',async () => {await send({type:'CANCEL_JOB',id:job.id});await refresh();}));
      else if (job.status==='complete') top.append(icon('↗','Show in folder',() => send({type:'SHOW_FILE',id:job.id})));
      content.append(top);
      const progress=element('progress');progress.max=100;progress.setAttribute('aria-label',`Download progress for ${job.title}`);
      content.append(progress);
      const meta=element('div','job-meta'),label=element('span',job.status==='failed' ? 'failed' : ''),size=element('span');
      meta.append(label,size);content.append(meta);
      if (job.status==='failed') content.append(element('p','row-error',job.error || 'Please retry.'));
      card.append(content);node={card,progress,label,size,mode};jobNodes.set(job.id,node);
    }
    const labels={queued:'Queued',downloading:`${Math.round(job.progress||0)}%`,finalizing:'Finalizing…',saving:'Saving…',complete:'Saved',cancelled:'Cancelled',failed:'Failed'};
    node.label.textContent=labels[job.status]||job.status;node.size.textContent=formatBytes(job.bytes||0);node.progress.value=job.progress||0;
    if(list.children[index]!==node.card) list.insertBefore(node.card,list.children[index]||null);
  }
  for(const [id,node] of jobNodes) if(!seen.has(id)){node.card.remove();jobNodes.delete(id);}
  $('clear').hidden=view!=='jobs' || !jobs.some(job => !active(job));
}
function showView(next) {
  view=next;$('media-panel').hidden=next!=='media';$('jobs-panel').hidden=next!=='jobs';
  for(const name of ['media','jobs']) {$(name+'-tab').classList.toggle('selected',next===name);$(name+'-tab').setAttribute('aria-selected',String(next===name));}
  renderMedia();renderJobs();
}
async function refresh(scan=false) {
  if(scan && tabId>=0) {
    const scanned=await send({type:'SCAN',tabId});if(scanned.error && !state.candidates.length) $('empty').textContent='Play a video to detect media.';
  }
  const response=await send({type:'GET_STATE',tabId});
  if(response.error) {notice(response);return;}
  const currentPage=state.pageUrl;
  state=response.state;state.pageUrl ||= currentPage;jobs=response.jobs||[];
  $('page-host').textContent=state.pageUrl ? new URL(state.pageUrl).hostname : '';
  renderMedia();renderJobs();
  for(const candidate of candidates().slice(0,12)) inspect(candidate);
}
$('media-tab').onclick=() => showView('media');$('jobs-tab').onclick=() => showView('jobs');
$('refresh').onclick=() => {errors.clear();refresh(true).catch(() => {});};
$('clear').onclick=async () => {await send({type:'CLEAR_FINISHED'});await refresh();};
$('dismiss').onclick=() => {$('notice').hidden=true;};
$('grant').onclick=() => {if(origins?.length) chrome.permissions.request({origins}).then(granted => {if(granted){$('notice').hidden=true;pendingGrant?.();}});};
$('enable').onclick=async () => {
  const url=state.pageUrl;if(!url) return;
  const granted=await chrome.permissions.request({origins:['https://*/*','http://*/*']});
  if(granted){$('enable').hidden=true;await refresh(true);}
};
try {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id && /^https?:/.test(tab.url||'')) {
    tabId=tab.id;
    const granted=await chrome.permissions.getAll();
    $('enable').hidden=granted.origins?.includes('https://*/*') && granted.origins?.includes('http://*/*');
    state.pageUrl=tab.url;
  }
  await refresh(true);
  chrome.storage.onChanged.addListener((changes,area) => {
    if(area!=='session') return;
    if(changes.jobs || changes[`tab:${tabId}`]) refresh().catch(() => {});
  });
  // Resume current-page discovery if the popup was opened while playback started.
  const timer=setInterval(() => refresh().catch(() => {}),2000);
  window.addEventListener('pagehide',() => clearInterval(timer),{once:true});
} catch(error) {notice({error:error.message});}
