const fs=require('node:fs');const path=require('node:path');
const out=path.join(__dirname,'..','licenses');fs.mkdirSync(out,{recursive:true});
const root=path.join(__dirname,'..','node_modules');
const names=['pdfjs-dist','pdf-lib','@pdf-lib/standard-fonts','@pdf-lib/upng','pako','tslib'];
const lines=['# Third-party notices','', 'Workbench uses the following unmodified open-source packages through their public APIs. License text and copyright notices are reproduced in licenses/. Electron distributes its own LICENSE.electron.txt and LICENSES.chromium.html beside the executable. PDF.js optional Node-only @napi-rs/canvas packages are excluded from the Windows distribution; the reader renders in Chromium.',''];
for(const name of names){const dir=path.join(root,name);const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));const license=fs.readdirSync(dir).filter(f=>/^(license|notice|copying)(\.|$)/i.test(f));for(const file of license)fs.copyFileSync(path.join(dir,file),path.join(out,name.replaceAll('/','_')+'-'+file));lines.push(`- ${name} ${pkg.version} — ${pkg.license}. ${typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url||''}`);}
fs.writeFileSync(path.join(__dirname,'..','THIRD_PARTY_NOTICES.md'),lines.join('\n')+'\n');
