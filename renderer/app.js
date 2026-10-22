import * as pdfjs from '../node_modules/pdfjs-dist/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
const api = window.workbench;
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const colors = ['#698b78','#718bb3','#b98b65','#9683b4','#ba7d86','#6f9b9c'];
const categories = ['课程资料','作业','其他资料'];
let state = { root:null,courses:[],files:[],folders:[],warnings:[] };
let view = 'home', courseId = null, category = categories[0], sub = '', query = '', scope = 'all', sort = 'name', desc = false;
let activeTab = null, toastTimer, modalResolve, presentationTab = null;
const tabs = new Map();
const workspace = $('#workspace');
function toast(message, error = false) { $('#toast').textContent = message; $('#toast').className = error ? 'error' : ''; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 8500 : 3500); }
async function busy(message, task) { $('#busy-text').textContent = message; $('#busy').hidden = false; try { return await task(); } finally { $('#busy').hidden = true; } }
async function safe(task) { try { return await task(); } catch(e) { toast(e.message, true); return null; } }
function modal(html, submitLabel = '确定') {
  $('#modal-body').innerHTML = html;
  $('#modal-form button[type=submit]').textContent = submitLabel;
  $('#modal').showModal();
  setTimeout(() => $('#modal-body input, #modal-body textarea, #modal-body select')?.focus(), 30);
  return new Promise(resolve => modalResolve = resolve);
}
function finishModal(value) { const resolve = modalResolve; modalResolve = null; $('#modal').close(); resolve?.(value); }
$('#modal-form').addEventListener('submit', e => { e.preventDefault(); finishModal(new FormData(e.target)); });
$('#modal-cancel').onclick = () => finishModal(null);
$('#modal').addEventListener('cancel', e => { e.preventDefault(); finishModal(null); });
function currentCourse() { return state.courses.find(c => c.id === courseId); }
function fileIcon(f) { const ext = f.name.split('.').pop().toLowerCase(); return `<span class="file-icon ${ext.startsWith('ppt')?'ppt':ext==='pdf'?'':'other'}">${esc(ext.toUpperCase().slice(0,4))}</span>`; }
function progress(f) { return f.total ? `<div class="progress-box"><div class="progress-label"><span>${f.page}/${f.total}</span><span>${Math.round(f.page/f.total*100)}%</span></div><div class="progress-bar"><i style="width:${Math.min(100,f.page/f.total*100)}%"></i></div></div>` : '<span class="muted">尚未阅读</span>'; }
function date(t) { return t ? new Date(t).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}) : '—'; }
function size(n) { return n < 1024*1024 ? Math.max(1,Math.round(n/1024))+' KB' : (n/1024/1024).toFixed(1)+' MB'; }
function fileRows(files, showCourse = false) {
  return files.map(f => `<tr data-file="${esc(f.id)}"><td><div class="file-name" data-open="${esc(f.id)}" tabindex="0" role="button">${fileIcon(f)}<div><strong>${esc(f.name)}</strong>${showCourse?`<small>${esc(state.courses.find(c=>c.id===f.courseId)?.name)} / ${esc(f.category)}</small>`:''}</div></div></td><td>${progress(f)}</td><td class="muted">${date(f.modifiedAt)}</td><td class="muted">${size(f.size)}</td><td><div class="row-actions"><button data-open="${esc(f.id)}" aria-label="打开 ${esc(f.name)}">打开 ↗</button><button data-file-menu="${esc(f.id)}" aria-label="管理 ${esc(f.name)}">•••</button></div></td></tr>`).join('');
}
function table(rows, title = '资料名称') { return `<table class="file-table"><thead><tr><th>${title}</th><th>阅读位置</th><th>修改日期</th><th>大小</th><th></th></tr></thead><tbody>${rows}</tbody></table>`; }
function sorted(files) {
  return [...files].sort((a,b) => { let v = sort==='name' ? a.name.localeCompare(b.name,'zh-CN',{numeric:true}) : (a[sort]||0)-(b[sort]||0); return desc?-v:v; });
}
function sortControls() { return `<div class="toolbar-group"><select id="sort" aria-label="排序规则"><option value="name">按名称</option><option value="addedAt">按添加时间</option><option value="modifiedAt">按修改时间</option><option value="lastOpened">按最近打开</option></select><button id="sort-direction" title="切换正倒序">${desc?'↓ 倒序':'↑ 正序'}</button></div>`; }
function render() {
  $('#course-nav').innerHTML = state.courses.map(c=>`<button class="course-nav-item ${courseId===c.id&&view==='course'?'active':''}" data-course="${esc(c.id)}"><i class="color-dot" style="background:${c.color}"></i>${esc(c.name)}</button>`).join('');
  $('#root-label').textContent = state.root || '尚未选择资料库'; $('#root-label').title = state.root || '';
  $('#nav-home').classList.toggle('active',view==='home'); $('#nav-recent').classList.toggle('active',view==='recent');
  $('#breadcrumb').innerHTML = `学习空间 <span>/</span> ${esc(view==='reader'?'阅读空间':view==='course'?currentCourse()?.name||'课程':view==='recent'?'最近阅读':'课程书架')}`;
  if (view==='reader' && tabs.size) { renderReader(); return; }
  if (!state.root) {
    workspace.innerHTML = `<div class="content"><div class="eyebrow">A PLACE FOR YOUR LEARNING</div><h1>欢迎来到 Workbench</h1><p class="subtitle">给每门课程，一个专属的位置。</p><div class="welcome-banner"><div><strong>先为你的资料选择一个家</strong><p>资料和批注保存在本机，无需账号，随时继续上次的阅读。</p></div><span class="banner-art">▤</span></div><div class="empty"><strong>从一个资料库开始</strong>选择一个专用文件夹，之后添加的资料会移动到这里。<br><button class="primary" id="setup-root">选择资料库文件夹</button></div></div>`;
    $('#setup-root').onclick = chooseRoot; return;
  }
  const warnings = state.warnings.length ? `<div class="warning">${state.warnings.map(esc).join('<br>')}</div>` : '';
  if (query) {
    const found = sorted(state.files.filter(f=>f.name.toLowerCase().includes(query.toLowerCase()) && (scope!=='course'||!courseId||f.courseId===courseId)));
    workspace.innerHTML = `<div class="content">${warnings}<div class="page-heading"><div><div class="eyebrow">FIND YOUR MATERIALS</div><h1>搜索结果</h1><div class="subtitle">“${esc(query)}” · ${found.length} 份资料</div></div></div><div class="toolbar"><span></span>${sortControls()}</div>${found.length?table(fileRows(found,true)):'<div class="empty">没有找到匹配的文件名</div>'}</div>`;
  } else if (view==='home') {
    const recent = state.files.filter(f=>f.lastOpened).sort((a,b)=>b.lastOpened-a.lastOpened).slice(0,4);
    workspace.innerHTML = `<div class="content">${warnings}<div class="page-heading"><div><div class="eyebrow">YOUR PERSONAL LEARNING SPACE</div><h1>每一次学习，都有迹可循。</h1><div class="subtitle">整理课程，留住思路。从上次停下的地方，继续。</div></div><button class="primary" id="new-course">＋ 新建课程</button></div><div class="welcome-banner"><div><strong>让资料井然有序，让学习更专注。</strong><p>${state.courses.length} 门课程 · ${state.files.length} 份资料 · 所有内容都保存在你的电脑上</p></div><div class="banner-art">▤ ▥</div></div><div class="section-heading"><h2>我的课程 <small>${state.courses.length} 门</small></h2><span class="muted">一个课程，一个清晰的空间</span></div><div class="course-grid">${state.courses.map((c,i)=>{
      const files=state.files.filter(f=>f.courseId===c.id), last=Math.max(0,...files.map(f=>f.lastOpened));
      return `<article class="course-card" data-course="${esc(c.id)}" tabindex="0" role="button" style="--cover:${c.color}"><div class="course-cover"><span class="cover-tag">COURSE ${String(i+1).padStart(2,'0')}</span><span class="cover-icon">${['∑','Aa','λ','π','⌘','∞'][i%6]}</span></div><div class="course-info"><h3>${esc(c.name)}</h3><div class="course-meta"><span>${files.length} 份资料</span><span>3 个栏目</span></div><div class="card-foot"><span>${last?'上次阅读 '+date(last):'准备好开始新的学习了'}</span><span>↗</span></div></div></article>`;
    }).join('')}${state.courses.length?'':'<button class="add-card" id="add-card"><span>＋</span><strong>添加一门课程</strong><small>为下一段学习腾出空间</small></button>'}</div><div class="section-heading"><h2>继续阅读 <small>接着上次的进度</small></h2><button class="text-button" id="all-recent">查看全部 →</button></div>${recent.length?table(fileRows(recent,true)):'<div class="empty">打开一份 PDF 或 PPT，阅读记录会出现在这里。</div>'}</div>`;
    $('#new-course').onclick = newCourse; if ($('#add-card')) $('#add-card').onclick = newCourse; $('#all-recent').onclick=()=>navigate('recent');
  } else if (view==='recent') {
    const files=state.files.filter(f=>f.lastOpened).sort((a,b)=>b.lastOpened-a.lastOpened);
    workspace.innerHTML=`<div class="content">${warnings}<div class="page-heading"><div><div class="eyebrow">PICK UP WHERE YOU LEFT OFF</div><h1>最近阅读</h1><div class="subtitle">${files.length} 份阅读记录，随时回来继续。</div></div></div>${files.length?table(fileRows(files,true)):'<div class="empty">还没有阅读记录</div>'}</div>`;
  } else if (view==='course') {
    const c=currentCourse(); if(!c) return navigate('home');
    const folders=state.folders.filter(f=>f.courseId===c.id&&f.category===category&&f.parent===sub).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
    const files=sorted(state.files.filter(f=>f.courseId===c.id&&f.category===category&&f.parent===sub));
    let acc='';const crumbs=sub.split(/[\\/]/).filter(Boolean).map(p=>{acc=acc?acc+'\\'+p:p;return `<span>/</span><button data-folder="${esc(acc)}">${esc(p)}</button>`;}).join('');
    workspace.innerHTML=`<div class="content">${warnings}<div class="page-heading"><div><div class="eyebrow">YOUR COURSE COLLECTION</div><h1><i class="color-dot" style="background:${c.color};display:inline-block;width:13px;height:13px;margin-right:13px"></i>${esc(c.name)}</h1><div class="subtitle">${state.files.filter(f=>f.courseId===c.id).length} 份资料 · 拖入文件或文件夹，开始整理</div></div><div class="toolbar-group"><button id="edit-course">课程设置</button><button class="primary" id="import-files">＋ 添加文件</button></div></div><div class="category-tabs">${categories.map(cat=>`<button data-category="${cat}" class="${category===cat?'active':''}">${cat} <small>${state.files.filter(f=>f.courseId===c.id&&f.category===cat).length}</small></button>`).join('')}</div><div class="toolbar"><div class="folder-crumbs"><button data-folder="">${category}</button>${crumbs}</div><div class="toolbar-group"><button id="new-folder">＋ 文件夹</button><button id="import-folder">导入文件夹</button>${sortControls()}</div></div>${files.length||folders.length?table(folders.map(f=>`<tr><td><div class="file-name" data-folder="${esc(f.sub)}" tabindex="0" role="button"><span class="file-icon folder">▰</span><strong>${esc(f.name)}</strong></div></td><td class="muted">文件夹</td><td>—</td><td>—</td><td><div class="row-actions"><button data-folder-menu="${esc(f.rel)}">•••</button></div></td></tr>`).join('')+fileRows(files)):'<div class="empty"><strong>这里还很安静</strong>添加文件，或把文件和文件夹拖到这里。<br>导入会将原文件移动到资料库，只保留一份。</div>'}</div>`;
    $('#edit-course').onclick=editCourse; $('#import-files').onclick=()=>importDialog(false); $('#import-folder').onclick=()=>importDialog(true); $('#new-folder').onclick=newFolder;
  }
  if($('#sort')) { $('#sort').value=sort; $('#sort').onchange=e=>{sort=e.target.value;render();}; $('#sort-direction').onclick=()=>{desc=!desc;render();}; }
}
function navigate(next, id) { view=next;query='';$('#search').value='';if(id){courseId=id;category=categories[0];sub='';} render(); if (state.root && next !== 'reader') safe(refresh); }
async function refresh() { const next=await api.state();state=next;if(view!=='reader')render(); }
async function chooseRoot() {
  if ([...tabs.values()].some(t=>t.dirty)) return toast('请先保存尚未写回的批注',true);
  await safe(async()=>{const next=await api.chooseRoot();if(next.root!==state.root){for(const t of tabs.values())t.destroy();tabs.clear();activeTab=null;}state=next;navigate('home');});
}
function courseFields(c = {}) { return `<h2>${c.id?'课程设置':'新建课程'}</h2><label for="course-name">课程名称</label><input id="course-name" name="name" required maxlength="100" placeholder="例如：高等数学" value="${esc(c.name||'')}"><label>封面颜色</label><div class="swatches">${colors.map((v,i)=>`<label class="swatch"><input type="radio" name="color" value="${v}" ${(c.color||colors[0])===v?'checked':''}><span style="background:${v}"></span></label>`).join('')}</div>`; }
async function newCourse() { if(!state.root)return chooseRoot();const data=await modal(courseFields(),'创建课程');if(data)await safe(async()=>{state=await api.addCourse(data.get('name').trim(),data.get('color'));render();toast('课程已创建');}); }
async function editCourse() {
  const c=currentCourse();const data=await modal(courseFields(c)+`<p>修改名称会同步重命名课程文件夹。</p><button type="button" class="danger" id="delete-course">移除这门课程…</button>`,'保存');
  if(data)await safe(async()=>{state=await api.editCourse(c.id,data.get('name').trim(),data.get('color'));render();});
}
$('#modal-body').addEventListener('click',async e=>{if(e.target.id!=='delete-course')return;const c=currentCourse();finishModal(null);const data=await modal(`<h2>移除 ${esc(c.name)}？</h2><p>可以保留课程文件，稍后重新导入。</p><select name="mode"><option value="keep">仅从书架移除，保留文件</option><option value="trash">课程文件一起放入回收站</option></select>`,'移除课程');if(data)await safe(async()=>{if([...tabs.values()].some(t=>t.file.courseId===c.id&&t.dirty))throw Error('请先保存该课程的批注');state=await api.removeCourse(c.id,data.get('mode')==='trash');for(const [id,t]of tabs)if(t.file.courseId===c.id){t.destroy();tabs.delete(id);}navigate('home');});});
async function importDialog(folders) { await safe(async()=>{state=await busy('正在移动资料并更新索引…',()=>api.importDialog(courseId,category,sub,folders));render();}); }
async function newFolder() { const data=await modal('<h2>新建文件夹</h2><label for="folder-name">名称</label><input id="folder-name" name="name" required maxlength="100">','创建');if(data)await safe(async()=>{state=await api.newFolder(courseId,category,sub,data.get('name').trim());render();}); }
async function fileMenu(id, folderRel) {
  const f=id?state.files.find(f=>f.id===id):state.folders.find(f=>f.rel===folderRel);if(!f)return;
  const data=await modal(`<h2>${esc(f.name)}</h2><label>操作</label><select name="action"><option value="rename">重命名</option><option value="move">移动到…</option>${id?'<option value="external">用外部软件打开</option>':''}<option value="reveal">在资源管理器中显示</option><option value="remove">放入回收站</option></select>`);
  if(!data)return;const action=data.get('action');await safe(async()=>{
    if(action==='external')return api.external(id);
    if(action==='reveal')return api.reveal(f.rel);
    if([...tabs.values()].some(t=>t.dirty&&(t.file.id===id||t.file.rel.startsWith(f.rel+'\\'))))throw Error('请先保存相关文件的批注');
    if(action==='rename') {const d=await modal(`<h2>重命名</h2><input name="name" aria-label="新名称" required value="${esc(f.name)}"><p>将同步修改磁盘上的名称。</p>`,'重命名');if(d)state=await api.rename(f.rel,d.get('name').trim());}
    if(action==='move') {
      const destinations=state.courses.flatMap(c=>categories.flatMap(cat=>[{course:c.id,cat,sub:'',label:c.name+' / '+cat},...state.folders.filter(x=>x.courseId===c.id&&x.category===cat).map(x=>({course:c.id,cat,sub:x.sub,label:c.name+' / '+cat+' / '+x.sub}))]));
      const d=await modal(`<h2>移动到</h2><label>目标文件夹</label><select name="dest">${destinations.map((d,i)=>`<option value="${i}">${esc(d.label)}</option>`).join('')}</select>`,'移动');if(d){const dest=destinations[Number(d.get('dest'))];state=await api.move(f.rel,dest.course,dest.cat,dest.sub);}
    }
    if(action==='remove') {const d=await modal(`<h2>放入回收站？</h2><p>${esc(f.name)}${folderRel?' 及其中的全部文件':''}将移至 Windows 回收站。</p>`,'放入回收站');if(d){state=await api.remove(f.rel);for(const [key,t]of tabs)if(t.file.id===id||t.file.rel.startsWith(f.rel+'\\')){t.destroy();tabs.delete(key);}}}
    for(const t of tabs.values()){const updated=state.files.find(x=>x.id===t.file.id);if(updated)t.file=updated;}
    render();
  });
}
$('#brand').onclick=e=>{e.preventDefault();navigate('home');};$('#nav-home').onclick=()=>navigate('home');$('#nav-recent').onclick=()=>navigate('recent');$('#sidebar-add').onclick=()=>safe(newCourse);$('#settings').onclick=chooseRoot;
$('#search').oninput=e=>{query=e.target.value; if(view==='reader')view='home'; render();};$('#search-scope').onchange=e=>{scope=e.target.value;render();};
document.addEventListener('click',e=>{
  const course=e.target.closest('[data-course]');if(course){navigate('course',course.dataset.course);return;}
  const cat=e.target.closest('[data-category]');if(cat){category=cat.dataset.category;sub='';render();return;}
  const folder=e.target.closest('[data-folder]');if(folder){sub=folder.dataset.folder;render();return;}
  const open=e.target.closest('[data-open]');if(open){safe(()=>openFile(open.dataset.open));return;}
  const menu=e.target.closest('[data-file-menu]');if(menu){safe(()=>fileMenu(menu.dataset.fileMenu));return;}
  const fm=e.target.closest('[data-folder-menu]');if(fm)safe(()=>fileMenu(null,fm.dataset.folderMenu));
});
document.addEventListener('keydown',e=>{
  if(view==='reader'&&tabs.get(activeTab)?.handleKey(e))return;
  if(e.ctrlKey&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus();}
  if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role=button]')){e.preventDefault();e.target.click();}
  if(view==='reader'&&e.ctrlKey&&e.key.toLowerCase()==='z'&&!e.target.matches('input,textarea')){e.preventDefault();tabs.get(activeTab)?.undo();}
});
let dragDepth=0;
workspace.addEventListener('dragover',e=>{if(view==='course'&&!query){e.preventDefault();e.dataTransfer.dropEffect='move';workspace.classList.add('drop-active');}});
workspace.addEventListener('dragleave',e=>{if(!workspace.contains(e.relatedTarget))workspace.classList.remove('drop-active');});
workspace.addEventListener('drop',async e=>{e.preventDefault();workspace.classList.remove('drop-active');if(view!=='course'||query)return;await safe(async()=>{const drop=await api.prepareDrop(Array.from(e.dataTransfer.files));if(!drop.count)return;const data=await modal(`<h2>移动 ${drop.count} 项到资料库？</h2><p>文件会从原位置移到“${esc(currentCourse().name)} / ${esc(category)}${sub?' / '+esc(sub):''}”，只保留一份。</p>`,'移动并导入');if(data){state=await busy('正在移动资料…',()=>api.importDrop(drop.token,courseId,category,sub));render();}});});

class ReaderTab {
  constructor(file,data,pdf) { this.file=file;this.pdf=pdf;this.kind=data.kind;this.hash=data.hash;this.annotations=data.annotations;this.page=data.page;this.total=data.total;this.zoom=1;this.history=[];this.dirty=false;this.saving=Promise.resolve();this.pages=new Map();this.renderTasks=new Set();this.layoutGeneration=0;this.presenting=false;this.clickToAdvance=false;this.container=document.createElement('section');this.container.className='reader';this.build(); }
  build() {
    this.container.innerHTML=`<div class="reader-tabs"></div><div class="reader-toolbar"><button data-reader="back" title="回到课程">← 返回课程</button><span class="sep"></span><button data-reader="prev">‹</button><input class="page-number" type="number" min="1" max="${this.total}" value="${this.page}" aria-label="当前页码"><small>/ ${this.total}</small><button data-reader="next">›</button><span class="sep"></span><select class="zoom" aria-label="阅读缩放"><option value="0.75">75%</option><option value="1" selected>100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select><button data-reader="highlight" title="选中文字后高亮">▰ 高亮</button><button data-reader="underline" title="选中文字后加下划线">U̲ 划线</button><button data-reader="note" title="选中文字添加便签，或在当前页添加">▧ 便签</button><button data-reader="undo">↶ 撤销</button><button data-reader="retry">保存</button><span class="save-status">所有批注已保存</span></div><div class="reader-body"><aside class="thumbnails"></aside><div class="page-scroll"></div><aside class="annotation-panel"><h3>批注与便签 <span class="annotation-count"></span></h3><div class="annotation-list"></div></aside></div><footer class="reader-footer"><span>${this.kind==='ppt'?'PPT 静态阅读 · 批注写回原课件':'PDF 阅读 · 批注写回原文件'}</span><span>选中文字进行标注 · Ctrl Z 撤销</span></footer>`;
    this.scroller=this.container.querySelector('.page-scroll');this.thumbs=this.container.querySelector('.thumbnails');
    this.container.querySelector('.reader-body').append(this.thumbs);
    this.thumbs.setAttribute('aria-label','页面缩略图预览');
    this.scroller.tabIndex=0;
    this.container.classList.toggle('is-ppt',this.kind==='ppt');
    if(this.kind==='ppt') {
      this.container.querySelector('.save-status').insertAdjacentHTML('beforebegin','<button data-reader="click-mode" aria-pressed="false" title="开启后单击页面翻到下一页；需要选字批注时可关闭">点击翻页：关</button><button data-reader="present" title="全屏显示课件，单击或按方向键翻页，Esc 退出">⛶ 全屏放映</button>');
      this.container.querySelector('.reader-footer span:last-child').textContent='← → / PageUp PageDown 翻页 · F5 全屏 · Ctrl Z 撤销';
      const controls=document.createElement('div');controls.className='presentation-controls';controls.hidden=true;
      controls.innerHTML='<span>单击下一页 · 右键上一页</span><button data-reader="prev" aria-label="上一页">‹</button><span class="presentation-page"></span><button data-reader="next" aria-label="下一页">›</button><button data-reader="exit-present">退出全屏 (Esc)</button>';
      this.container.append(controls);
    }
    this.scroller.addEventListener('click',e=>{
      if(this.kind!=='ppt'||(!this.presenting&&!this.clickToAdvance)||e.button!==0||e.detail>1||e.ctrlKey||e.metaKey||e.altKey)return;
      if(!this.presenting&&(e.target.closest('[data-note-id]')||!window.getSelection()?.isCollapsed))return;
      this.go(this.page+1);
    });
    this.scroller.addEventListener('contextmenu',e=>{if(this.presenting){e.preventDefault();this.go(this.page-1);}});
    this.resizeObserver=new ResizeObserver(()=>{
      const size=[this.scroller.clientWidth,this.scroller.clientHeight];
      if(this.lastSize?.every((v,i)=>Math.abs(v-size[i])<2))return;
      this.lastSize=size;clearTimeout(this.resizeTimer);
      if(this.pages.size&&this.container.isConnected)this.resizeTimer=setTimeout(()=>safe(()=>this.layout()),100);
    });
    this.resizeObserver.observe(this.scroller);
    // Preserve the text selection while clicking a formatting button.
    this.container.querySelector('.reader-toolbar').addEventListener('mousedown',e=>{if(e.target.closest('[data-reader]')&&!['prev','next','back'].includes(e.target.closest('[data-reader]').dataset.reader))e.preventDefault();});
    this.container.addEventListener('click',e=>safe(async()=>{
      const command=e.target.closest('[data-reader]')?.dataset.reader;
      if(command==='back'){courseId=this.file.courseId;navigate('course');return;}
      if(command==='prev')return this.go(this.page-1);
      if(command==='next')return this.go(this.page+1);
      if(['highlight','underline','note'].includes(command))return this.addMark(command);
      if(command==='undo')return this.undo();
      if(command==='retry')return this.save();
      if(command==='present')return this.setPresentation(true);
      if(command==='exit-present')return this.setPresentation(false);
      if(command==='click-mode'){
        this.clickToAdvance=!this.clickToAdvance;
        const button=this.container.querySelector('[data-reader="click-mode"]');button.setAttribute('aria-pressed',String(this.clickToAdvance));button.textContent='点击翻页：'+(this.clickToAdvance?'开':'关');
        this.scroller.classList.toggle('click-to-advance',this.clickToAdvance);return;
      }
      const page=e.target.closest('[data-page-go]');if(page)this.go(Number(page.dataset.pageGo));
      const del=e.target.closest('[data-mark-delete]');if(del){this.checkpoint();this.annotations=this.annotations.filter(a=>a.id!==del.dataset.markDelete);this.changed();}
      const edit=e.target.closest('[data-mark-edit]');if(edit)await this.editMark(edit.dataset.markEdit);
      const jump=e.target.closest('[data-mark-jump]');if(jump)this.go(Number(jump.dataset.markJump));
      const note=e.target.closest('[data-note-id]');if(note)await this.editMark(note.dataset.noteId);
    }));
    this.container.querySelector('.page-number').onchange=e=>this.go(Number(e.target.value));
    this.container.querySelector('.zoom').onchange=e=>safe(async()=>{this.zoom=Number(e.target.value);await this.layout();});
    let progressTimer;
    this.scroller.addEventListener('scroll',()=>{clearTimeout(progressTimer);progressTimer=setTimeout(()=>{
      if(this.kind==='ppt'||!this.container.isConnected||view!=='reader'||activeTab!==this.file.id)return;
      const root=this.scroller.getBoundingClientRect();let closest=null,distance=Infinity;
      for(const [n,item]of this.pages){const rect=item.el.getBoundingClientRect();if(rect.bottom<root.top||rect.top>root.bottom)continue;const d=Math.abs(rect.top-root.top-26);if(d<distance){distance=d;closest=n;}}
      if(closest&&closest!==this.page)this.setPage(closest);
    },160);});
    this.updatePanel();
  }
  async layout() {
    const generation=++this.layoutGeneration;
    this.observer?.disconnect();for(const task of this.renderTasks)task.cancel();this.renderTasks.clear();
    for(const p of this.pages.values())p.text?.cancel();this.pages.clear();this.scroller.replaceChildren();this.thumbs.replaceChildren();
    const first=await this.pdf.getPage(1), base=first.getViewport({scale:1});
    if(this.destroyed||generation!==this.layoutGeneration)return;
    this.baseScale=this.kind==='ppt'
      ? Math.max(.05,Math.min((this.scroller.clientWidth-48)/base.width,(this.scroller.clientHeight-48)/base.height))*(this.presenting?1:this.zoom)
      : Math.min(1.2,Math.max(0.45,(this.scroller.clientWidth-60)/base.width))*this.zoom;
    this.observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)safe(()=>this.renderPage(Number(e.target.dataset.number)));},{root:this.scroller,rootMargin:'500px'});
    for(let n=1;n<=this.total;n++){
      const el=document.createElement('div');el.className='pdf-page';el.dataset.number=String(n);el.style.width=base.width*this.baseScale+'px';el.style.height=base.height*this.baseScale+'px';el.style.setProperty('--total-scale-factor',String(this.baseScale));
      if(this.kind==='ppt')el.hidden=n!==this.page;
      el.innerHTML='<div class="marks"></div>';this.scroller.append(el);this.pages.set(n,{el,scale:this.baseScale,rendering:false,rendered:false});this.observer.observe(el);
      const thumb=document.createElement('button');thumb.className='thumb';thumb.dataset.pageGo=String(n);thumb.innerHTML=`<canvas width="96" height="${Math.round(96*base.height/base.width)}"></canvas><span>${n}</span>`;this.thumbs.append(thumb);
    }
    this.thumbObserver?.disconnect();this.thumbObserver=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){this.thumbObserver.unobserve(e.target);safe(()=>this.renderThumb(Number(e.target.dataset.pageGo),e.target));}},{root:this.thumbs,rootMargin:'100px'});
    for(const thumb of this.thumbs.children)this.thumbObserver.observe(thumb);
    this.drawMarks();this.go(this.page);
  }
  async renderThumb(n,thumb) {const p=await this.pdf.getPage(n),v=p.getViewport({scale:96/p.getViewport({scale:1}).width});const c=thumb.querySelector('canvas');if(!c?.isConnected)return;c.width=Math.ceil(v.width);c.height=Math.ceil(v.height);await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;}
  async renderPage(n) {
    const item=this.pages.get(n);if(!item||item.rendering||item.rendered)return;item.rendering=true;
    const page=await this.pdf.getPage(n);if(this.pages.get(n)!==item)return;
    const viewport=page.getViewport({scale:item.scale});item.el.style.width=viewport.width+'px';item.el.style.height=viewport.height+'px';
    const canvas=document.createElement('canvas'),dpr=Math.min(2,devicePixelRatio);canvas.width=Math.ceil(viewport.width*dpr);canvas.height=Math.ceil(viewport.height*dpr);item.el.prepend(canvas);
    const task=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:dpr===1?undefined:[dpr,0,0,dpr,0,0]});this.renderTasks.add(task);
    try { await task.promise;this.renderTasks.delete(task);if(this.pages.get(n)!==item)return;const text=document.createElement('div');text.className='textLayer';item.el.append(text);item.text=new pdfjs.TextLayer({textContentSource:page.streamTextContent(),container:text,viewport});await item.text.render();item.rendered=true; }
    catch(e){if(e.name!=='RenderingCancelledException'&&e.name!=='AbortException')throw e;}finally{item.rendering=false;this.renderTasks.delete(task);}
  }
  setPage(n){this.page=n;this.container.querySelector('.page-number').value=String(n);for(const t of this.thumbs.children)t.classList.toggle('active',Number(t.dataset.pageGo)===n);for(const button of this.container.querySelectorAll('[data-reader="prev"]'))button.disabled=n===1;for(const button of this.container.querySelectorAll('[data-reader="next"]'))button.disabled=n===this.total;const label=this.container.querySelector('.presentation-page');if(label)label.textContent=n+' / '+this.total;const values={page:n,total:this.total,lastOpened:Date.now()};Object.assign(this.file,values);const entry=state.files.find(f=>f.id===this.file.id);if(entry)Object.assign(entry,values);safe(()=>api.progress(this.file.id,n,this.total));}
  go(n){n=Math.max(1,Math.min(this.total,Math.trunc(n)||1));this.setPage(n);if(this.kind==='ppt'){for(const [p,item]of this.pages)item.el.hidden=p!==n;this.scroller.scrollTop=0;}else this.pages.get(n)?.el.scrollIntoView({block:'start'});safe(()=>this.renderPage(n));if(!this.presenting)this.thumbs.querySelector(`[data-page-go="${n}"]`)?.scrollIntoView({block:'nearest'});}
  handleKey(e) {
    if(this.kind!=='ppt'||$('#modal').open)return false;
    if(e.key==='Escape'&&this.presenting){e.preventDefault();safe(()=>this.setPresentation(false));return true;}
    if(e.ctrlKey||e.metaKey||e.altKey)return this.presenting;
    if(e.target.closest('input,textarea,select,a,[contenteditable]'))return false;
    if(e.key==='F5'){e.preventDefault();safe(()=>this.setPresentation(!this.presenting));return true;}
    if(e.target.closest('button')&&[' ','Enter'].includes(e.key))return false;
    const target={ArrowRight:this.page+1,ArrowDown:this.page+1,PageDown:this.page+1,' ':this.page+1,Enter:this.page+1,ArrowLeft:this.page-1,ArrowUp:this.page-1,PageUp:this.page-1,Backspace:this.page-1,Home:1,End:this.total}[e.key];
    if(target===undefined)return false;
    e.preventDefault();this.go(target);return true;
  }
  async setPresentation(enabled,native=true) {
    if(this.kind!=='ppt'||this.destroyed||enabled===this.presenting)return;
    this.presenting=enabled;presentationTab=enabled?this:null;
    this.container.classList.toggle('presenting',enabled);
    this.container.querySelector('.presentation-controls').hidden=!enabled;
    window.getSelection()?.removeAllRanges();
    try { if(native)await api.setReaderFullscreen(enabled); }
    catch(e){this.presenting=false;presentationTab=null;this.container.classList.remove('presenting');this.container.querySelector('.presentation-controls').hidden=true;throw e;}
    if(this.destroyed)return;
    await new Promise(resolve=>requestAnimationFrame(resolve));
    await this.layout();this.scroller.focus({preventScroll:true});
  }
  selection() {
    const selection=window.getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount)return null;const range=selection.getRangeAt(0);const start=(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement)?.closest('.pdf-page'),end=(range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement)?.closest('.pdf-page');
    if(!start||start!==end||!this.scroller.contains(start))throw Error('请在同一页内选择文字后批注');
    const box=start.getBoundingClientRect();const rects=Array.from(range.getClientRects()).filter(r=>r.width>1&&r.height>2).map(r=>({x:Math.max(0,(r.left-box.left)/box.width),y:Math.max(0,(r.top-box.top)/box.height),w:Math.min(r.width/box.width,(box.right-r.left)/box.width),h:Math.min(r.height/box.height,(box.bottom-r.top)/box.height)}));
    const unique=rects.filter((r,i)=>!rects.slice(0,i).some(s=>Math.abs(r.x-s.x)<.001&&Math.abs(r.y-s.y)<.001&&Math.abs(r.w-s.w)<.001));
    if(!unique.length)return null;return {page:Number(start.dataset.number),rects:unique,text:selection.toString().slice(0,4000)};
  }
  checkpoint(){this.history.push(structuredClone(this.annotations));if(this.history.length>40)this.history.shift();}
  async addMark(type){const selected=this.selection();if(type!=='note'&&!selected)throw Error('请先用鼠标选中文字；扫描图片暂不支持选字标注');let text=selected?.text||'';if(type==='note'){const d=await modal(`<h2>添加文字便签</h2><label>便签内容</label><textarea name="text" maxlength="4000" required></textarea>`,'添加便签');if(!d)return;text=d.get('text');}this.checkpoint();this.annotations.push({id:crypto.randomUUID(),type,page:selected?.page||this.page,rects:selected?.rects||[{x:.08,y:.08,w:.03,h:.03}],text});window.getSelection()?.removeAllRanges();this.changed();}
  async editMark(id){const a=this.annotations.find(a=>a.id===id);if(!a)return;const d=await modal(`<h2>编辑${a.type==='note'?'便签':'批注说明'}</h2><textarea name="text" maxlength="4000">${esc(a.text)}</textarea>`,'保存修改');if(d){this.checkpoint();a.text=d.get('text');this.changed();}}
  undo(){if(!this.history.length)return toast('没有可以撤销的批注操作');this.annotations=this.history.pop();this.changed();}
  changed(){this.dirty=true;this.drawMarks();this.updatePanel();this.status('等待自动保存…');clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.save(),450);}
  status(text,error=false){const el=this.container.querySelector('.save-status');el.textContent=text;el.style.color=error?'#b05f50':'';}
  save(){clearTimeout(this.saveTimer);this.saving=this.saving.then(async()=>{if(!this.dirty)return;const snapshot=JSON.stringify(this.annotations);this.status('正在写回原文件…');try{const result=await api.saveAnnotations(this.file.id,this.hash,JSON.parse(snapshot));this.hash=result.hash;if(JSON.stringify(this.annotations)===snapshot)this.dirty=false;this.status(this.dirty?'有新的更改等待保存':'所有批注已保存');}catch(e){this.status('保存失败 · 点击保存重试',true);toast(e.message,true);}});return this.saving;}
  drawMarks(){for(const [n,item]of this.pages){const marks=item.el.querySelector('.marks');marks.innerHTML=this.annotations.filter(a=>a.page===n).map(a=>(a.type==='note'?a.rects.slice(0,1):a.rects).map(r=>`<span class="mark ${a.type}" ${a.type==='note'?`data-note-id="${a.id}" title="${esc(a.text)}"`:''} style="left:${r.x*100}%;top:${r.y*100}%;width:${r.w*100}%;height:${r.h*100}%">${a.type==='note'?'≡':''}</span>`).join('')).join('');}}
  updatePanel(){this.container.querySelector('.annotation-count').textContent=`(${this.annotations.length})`;this.container.querySelector('.annotation-list').innerHTML=this.annotations.length?this.annotations.map(a=>`<div class="annotation-item"><small>第 ${a.page} 页 · ${{highlight:'高亮',underline:'下划线',note:'便签'}[a.type]}</small><p>${esc(a.text)||'无文字说明'}</p><button data-mark-jump="${a.page}">定位</button><button data-mark-edit="${a.id}">编辑</button><button data-mark-delete="${a.id}">删除</button></div>`).join(''):'<p class="muted" style="line-height:1.9">选中文字，然后点击高亮或划线。<br><br>也可以给当前页面留一张便签。</p>';}
  destroy(){if(this.presenting){presentationTab=null;safe(()=>api.setReaderFullscreen(false));}this.destroyed=true;this.resizeObserver?.disconnect();clearTimeout(this.resizeTimer);this.observer?.disconnect();this.thumbObserver?.disconnect();clearTimeout(this.saveTimer);for(const p of this.pages.values())p.text?.cancel();for(const t of this.renderTasks)t.cancel();this.pdf.loadingTask.destroy().catch(()=>{});this.container.remove();}
}
async function openFile(id) {
  if(tabs.has(id)){activeTab=id;view='reader';query='';$('#search').value='';render();return;}
  const file=state.files.find(f=>f.id===id);if(!file)throw Error('文件已经移走，请刷新后重试');
  if(!/\.(pdf|pptx?)$/i.test(file.name)){await api.external(id);return;}
  await busy(/\.pdf$/i.test(file.name)?'正在打开 PDF…':'正在使用 PowerPoint 准备课件，首次打开可能需要一些时间…',async()=>{
    const data=await api.open(id);const pdf=await pdfjs.getDocument({data:new Uint8Array(data.bytes),isEvalSupported:false,useSystemFonts:true,cMapUrl:new URL('../node_modules/pdfjs-dist/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url).href,wasmUrl:new URL('../node_modules/pdfjs-dist/wasm/',import.meta.url).href}).promise;
    const tab=new ReaderTab(file,data,pdf);tabs.set(id,tab);activeTab=id;view='reader';query='';$('#search').value='';render();await tab.layout();
  });
}
function renderReader(){const active=tabs.get(activeTab)||tabs.values().next().value;if(!active){navigate('home');return;}activeTab=active.file.id;workspace.replaceChildren(active.container);for(const t of tabs.values()){t.container.querySelector('.reader-tabs').innerHTML=`<button class="reader-tab" data-tab-home="1">▦ 书架</button>${[...tabs.values()].map(x=>`<button class="reader-tab ${x===active?'active':''}" data-tab="${x.file.id}"><span>${esc(x.file.name)}</span><i data-close-tab="${x.file.id}">×</i></button>`).join('')}`;}}
document.addEventListener('click',e=>safe(async()=>{const close=e.target.closest('[data-close-tab]');if(close){const id=close.dataset.closeTab,t=tabs.get(id);await t.save();if(t.dirty){const discard=await modal('<h2>批注还没有保存</h2><p>原文件可能已被其他程序修改，或暂时无法写入。取消可保留当前批注并继续重试；放弃后可以重新打开最新文件。</p>','放弃未保存批注并关闭');if(!discard)return;t.dirty=false;}t.destroy();tabs.delete(id);if(activeTab===id)activeTab=tabs.keys().next().value;if(!tabs.size)navigate('home');else renderReader();return;}const tab=e.target.closest('[data-tab]');if(tab){activeTab=tab.dataset.tab;view='reader';render();}if(e.target.closest('[data-tab-home]'))navigate('home');}));
window.addEventListener('beforeunload',e=>{if([...tabs.values()].some(t=>t.dirty)){e.preventDefault();e.returnValue='';}});
api.onChange(()=>safe(refresh));
api.onFullscreenChange(enabled=>{if(!enabled&&presentationTab)safe(()=>presentationTab.setPresentation(false,false));});
await safe(refresh);
