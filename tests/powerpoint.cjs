const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {psJob,Documents}=require('../src/documents.cjs');const {Library,fingerprint}=require('../src/library.cjs');
const {PDFDocument}=require('pdf-lib');
async function main(){
 const output=path.join(__dirname,'..','test-output','powerpoint-'+Date.now());fs.mkdirSync(output,{recursive:true});const script=path.join(__dirname,'..','scripts','powerpoint.ps1');
 const fixture=path.join(output,'示例课件.pptx'),job=path.join(output,'fixture.json');fs.writeFileSync(job,JSON.stringify({action:'fixture',source:fixture,output:path.join(output,'fixture.pdf')}));
 const created=await psJob(script,job);assert.equal(created.total,3);
 const lib=new Library(path.join(output,'library'));const c=lib.addCourse('线性代数');const file=lib.import([fixture],c.id,'课程资料','').files[0];const docs=new Documents(lib,path.join(output,'cache'),script);
 let opened=await docs.open(file.id);assert.equal(opened.total,3);assert.equal((await PDFDocument.load(opened.bytes)).getPageCount(),3);
 const items=['highlight','underline','note'].map((type,i)=>({id:crypto.randomUUID(),type,page:i+1,text:'中文便签测试 / Workbench',rects:[{x:.0625,y:.17,w:.5,h:.06}]}));
 let saved=await docs.save(file.id,opened.hash,items);assert.notEqual(saved.hash,opened.hash);
 opened=await docs.open(file.id);assert.deepEqual(opened.annotations,items);items[2].text='修改后的中文便签';
 await docs.save(file.id,opened.hash,items.slice(1));opened=await docs.open(file.id);assert.deepEqual(opened.annotations,items.slice(1));
 await docs.save(file.id,opened.hash,[]);opened=await docs.open(file.id);assert.equal(opened.annotations.length,0);
 fs.writeFileSync(path.join(__dirname,'..','test-output','powerpoint-result.json'),JSON.stringify({passed:true,directory:output,source:lib.filePath(file.id),checks:['PowerPoint 创建课件','三页静态预览','高亮、下划线和中文原生评论写回','重新打开恢复批注','编辑便签','删除批注','删除后重新打开验证']},null,2));
 console.log('PASS: PowerPoint export, highlight, underline, Unicode native comment, edit/delete/reopen. '+output);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
