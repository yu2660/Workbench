const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Library}=require('../src/library.cjs');
const {psJob}=require('../src/documents.cjs');
const project=path.join(__dirname,'..');
const output=path.join(project,'test-output','navigation-'+Date.now());
const profile=path.join(output,'profile');
fs.mkdirSync(profile,{recursive:true});
let app,page;const checks=[],errors=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function current(n){await expect(page.locator('.page-number')).toHaveValue(String(n));}
async function press(key){await page.locator('.page-scroll').focus();await page.keyboard.press(key);}
async function fullscreen(){return app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen());}
async function fit(){await expect.poll(async()=>page.locator('.pdf-page:not([hidden])').evaluate(el=>{if(!el.isConnected||!el.parentElement)return false;const p=el.getBoundingClientRect(),s=el.parentElement.getBoundingClientRect();return p.width<=s.width-46&&p.height<=s.height-46&&p.left>=s.left&&p.right<=s.right+1&&p.top>=s.top&&p.bottom<=s.bottom+1;})).toBe(true);}
async function rightPreview(){const thumb=await page.locator('.thumbnails').boundingBox(),scroll=await page.locator('.page-scroll').boundingBox(),notes=await page.locator('.annotation-panel').boundingBox();assert.ok(thumb.x>=notes.x+notes.width-1);assert.ok(thumb.x>scroll.x+scroll.width-1);}
async function main(){
 const source=path.join(output,'课程示例.pptx'),pdf=path.join(output,'课程示例.pdf'),job=path.join(output,'fixture.json');
 fs.writeFileSync(job,JSON.stringify({action:'fixture',source,output:pdf}));await psJob(path.join(project,'scripts','powerpoint.ps1'),job);
 const library=new Library(path.join(output,'library')),course=library.addCourse('翻页与全屏验证');library.import([source,pdf],course.id,'课程资料','');
 fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({root:library.root}));
 const env={...process.env,WORKBENCH_TEST_HOME:profile};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({args:[project,'--disable-background-timer-throttling','--disable-renderer-backgrounding'],env,timeout:30000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await expect(page.locator('.course-card')).toBeVisible();await page.locator('.course-card').click();const snapshot=await page.evaluate(()=>window.workbench.state()),ppt=snapshot.files.find(f=>f.name.endsWith('.pptx')),doc=snapshot.files.find(f=>f.name.endsWith('.pdf'));
 await page.locator(`[data-open="${ppt.id}"]`).first().click();await expect(page.locator('.textLayer span').first()).toBeVisible({timeout:90000});
 await check('PPT 预览位于最右侧且默认整页适配',async()=>{await rightPreview();await fit();await current(1);});
 await check('方向键、PageUp/PageDown、空格、首尾页及边界',async()=>{for(const [key,n]of[['ArrowRight',2],['PageDown',3],['ArrowRight',3],['PageUp',2],['ArrowLeft',1],['ArrowLeft',1],['Space',2],['End',3],['Home',1]]){await press(key);await current(n);}});
 await check('页码输入不被翻页快捷键劫持',async()=>{await page.locator('.page-number').focus();await page.keyboard.press('ArrowRight');await current(1);});
 await check('普通阅读默认不因单击翻页，支持开关',async()=>{await page.locator('.page-scroll').click({position:{x:10,y:10}});await current(1);await page.locator('[data-reader="click-mode"]').click();await expect(page.locator('[data-reader="click-mode"]')).toHaveAttribute('aria-pressed','true');await page.locator('.page-scroll').click({position:{x:10,y:10}});await current(2);});
 await check('点击翻页时拖选文字仍可高亮批注',async()=>{const text=page.locator('.pdf-page:not([hidden]) .textLayer span').first();await expect(text).toBeVisible();const box=await text.boundingBox();await page.mouse.move(box.x+2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+Math.min(box.width-2,100),box.y+box.height/2,{steps:8});await page.mouse.up();await current(2);await page.locator('[data-reader="highlight"]').click();await expect(page.locator('.annotation-item')).toHaveCount(1);await expect(page.locator('.save-status')).toHaveText('所有批注已保存',{timeout:90000});await page.locator('[data-reader="click-mode"]').click();});
 await page.locator('.zoom').selectOption('1.25');
 await check('进入真实窗口全屏并保持比例、隐藏侧栏',async()=>{await page.locator('[data-reader="present"]').click();await expect(page.locator('.reader')).toHaveClass(/presenting/);await expect.poll(fullscreen).toBe(true);await expect(page.locator('.thumbnails')).toBeHidden();await expect(page.locator('.annotation-panel')).toBeHidden();await fit();const box=await page.locator('.pdf-page:not([hidden])').boundingBox();assert.ok(Math.abs(box.width/box.height-960/540)<.005);});
 await check('全屏单击下一页、右键上一页、键盘翻页及末页边界',async()=>{await press('Home');await current(1);await page.locator('.pdf-page:not([hidden])').click({position:{x:30,y:30}});await current(2);await page.locator('.page-scroll').click({position:{x:10,y:10},button:'right'});await current(1);await press('Space');await current(2);await press('End');await page.locator('.page-scroll').click({position:{x:10,y:10}});await current(3);await expect(page.locator('.presentation-page')).toHaveText('3 / 3');});
 await page.screenshot({path:path.join(output,'presentation.png')});
 await check('Esc 退出并保留当前页、恢复缩放和右侧预览',async()=>{await press('Escape');await expect.poll(fullscreen).toBe(false);await expect(page.locator('.reader')).not.toHaveClass(/presenting/);await expect(page.locator('.thumbnails')).toBeVisible();await current(3);await expect(page.locator('.zoom')).toHaveValue('1.25');await rightPreview();});
 await check('F5 进入，退出按钮可用键盘激活',async()=>{await press('F5');await expect.poll(fullscreen).toBe(true);await page.locator('[data-reader="exit-present"]').focus();await page.keyboard.press('Enter');await expect.poll(fullscreen).toBe(false);await expect(page.locator('.reader')).not.toHaveClass(/presenting/);});
 await check('系统退出全屏同步恢复阅读布局',async()=>{await press('F5');await expect.poll(fullscreen).toBe(true);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(false));await expect(page.locator('.reader')).not.toHaveClass(/presenting/);await rightPreview();});
 await check('窗口缩小后重新适配整页',async()=>{await page.locator('.zoom').selectOption('1');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,750));await fit();});
 await page.screenshot({path:path.join(output,'right-preview.png')});
 await check('全屏翻页进度写入资料库',async()=>{const saved=await page.evaluate(()=>window.workbench.state());assert.equal(saved.files.find(f=>f.id===ppt.id).page,3);});
 await check('PDF 预览也在右侧且不显示 PPT 放映按钮',async()=>{await page.locator('[data-reader="back"]').click();await page.locator(`[data-open="${doc.id}"]`).first().click();await expect(page.locator('.textLayer span').first()).toBeVisible();await rightPreview();await expect(page.locator('[data-reader="present"]')).toHaveCount(0);await press('ArrowRight');await current(1);});
 await check('全屏 IPC 拒绝非布尔参数',async()=>{const result=await page.evaluate(async()=>{try{await window.workbench.setReaderFullscreen('yes');return false;}catch(e){return e.message;}});assert.match(result,/无效/);});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(project,'test-output','navigation-result.json'),JSON.stringify({passed:true,checks,directory:output,rendererErrors:errors},null,2));console.log('NAVIGATION PASS '+checks.length+' '+output);
}
main().catch(async e=>{console.error(e);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});});
