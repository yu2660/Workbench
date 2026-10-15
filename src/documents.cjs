const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { PDFDocument, PDFName, PDFArray, PDFString, PDFHexString, PDFDict } = require('pdf-lib');
const { fingerprint, noLinks } = require('./library.cjs');
function validateAnnotations(items, total) {
  if (!Array.isArray(items) || items.length > 3000) throw Error('批注数量无效');
  const seen = new Set();
  return items.map(a => {
    if (!a || typeof a.id !== 'string' || !/^[a-f0-9-]{36}$/.test(a.id) || seen.has(a.id)) throw Error('批注标识无效');
    seen.add(a.id);
    if (!['highlight', 'underline', 'note'].includes(a.type) || !Number.isInteger(a.page) || a.page < 1 || a.page > total || typeof a.text !== 'string' || a.text.length > 4000 || !Array.isArray(a.rects) || !a.rects.length || a.rects.length > 200) throw Error('批注内容无效');
    const rects = a.rects.map(r => {
      if (!r || !['x', 'y', 'w', 'h'].every(k => Number.isFinite(r[k])) || r.x < 0 || r.y < 0 || r.w <= 0 || r.h <= 0 || r.x + r.w > 1.002 || r.y + r.h > 1.002) throw Error('批注坐标无效');
      return { x: r.x, y: r.y, w: r.w, h: r.h };
    });
    return { id: a.id, type: a.type, page: a.page, text: a.text, rects };
  });
}
function psJob(script, jobPath) {
  return new Promise((resolve, reject) => {
    execFile('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-JobPath', jobPath], { windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(Error('PowerPoint 处理失败：' + (stderr || err.message).slice(0, 1200)));
      try { resolve(JSON.parse(stdout.trim())); } catch { reject(Error('PowerPoint 返回的数据无效：' + stdout.slice(0, 300))); }
    });
  });
}
async function pdfAnnotations(bytes) {
  const doc = await PDFDocument.load(bytes);
  const annotations = [];
  for (const page of doc.getPages()) {
    const arr = page.node.Annots(); if (!arr) continue;
    for (let i = 0; i < arr.size(); i++) {
      const dict = doc.context.lookup(arr.get(i));
      if (!(dict instanceof PDFDict)) continue;
      const data = dict.get(PDFName.of('WBData'));
      if (data instanceof PDFHexString || data instanceof PDFString) {
        try { const a = JSON.parse(data.decodeText()); if (!annotations.some(x => x.id === a.id)) annotations.push(a); } catch { /* malformed custom metadata is ignored */ }
      }
    }
  }
  return { total: doc.getPageCount(), annotations: validateAnnotations(annotations, doc.getPageCount()) };
}
async function writePDF(bytes, annotations) {
  const doc = await PDFDocument.load(bytes);
  const items = validateAnnotations(annotations, doc.getPageCount());
  for (const [index, page] of doc.getPages().entries()) {
    const original = page.node.Annots(), kept = [];
    if (original) for (let i = 0; i < original.size(); i++) {
      const entry = original.get(i), dict = doc.context.lookup(entry);
      if (!(dict instanceof PDFDict) || !dict.has(PDFName.of('WBData'))) kept.push(entry);
    }
    const annots = doc.context.obj(kept);
    const { x: ox, y: oy, width, height } = page.getCropBox();
    for (const a of items.filter(a => a.page === index + 1)) {
      for (const r of a.rects) {
        const rotation = ((page.getRotation().angle % 360) + 360) % 360;
        const vw = rotation % 180 ? height : width, vh = rotation % 180 ? width : height;
        const map = (u, v) => {
          if (rotation === 90) return [ox + v, oy + u];
          if (rotation === 180) return [ox + width - u, oy + v];
          if (rotation === 270) return [ox + width - v, oy + height - u];
          return [ox + u, oy + height - v];
        };
        const tl = map(r.x * vw, r.y * vh), tr = map((r.x + r.w) * vw, r.y * vh), bl = map(r.x * vw, (r.y + r.h) * vh), br = map((r.x + r.w) * vw, (r.y + r.h) * vh);
        const xs = [tl[0], tr[0], bl[0], br[0]], ys = [tl[1], tr[1], bl[1], br[1]];
        const dict = doc.context.obj({
          Type: 'Annot', Subtype: a.type === 'note' ? 'Text' : a.type === 'underline' ? 'Underline' : 'Highlight',
          Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
          C: a.type === 'underline' ? [0.2, 0.4, 0.55] : [1, 0.86, 0.3], CA: a.type === 'highlight' ? 0.4 : 1,
          F: 4, T: PDFHexString.fromText('Workbench'), Contents: PDFHexString.fromText(a.text),
          NM: PDFString.of('Workbench:' + a.id), WBData: PDFHexString.fromText(JSON.stringify(a)),
          M: PDFString.fromDate(new Date()),
        });
        if (a.type !== 'note') dict.set(PDFName.of('QuadPoints'), doc.context.obj([...tl, ...tr, ...bl, ...br]));
        else dict.set(PDFName.of('Name'), PDFName.of('Comment'));
        annots.push(doc.context.register(dict));
      }
    }
    page.node.set(PDFName.of('Annots'), annots);
  }
  return doc.save();
}
class Documents {
  constructor(library, cache, script) { this.library = library; this.cache = cache; this.script = script; this.sessions = new Map(); fs.mkdirSync(cache, { recursive: true }); }
  async run(job) {
    const jobFile = path.join(this.cache, crypto.randomUUID() + '.json'); fs.writeFileSync(jobFile, JSON.stringify(job), { flag: 'wx' });
    try { return await psJob(this.script, jobFile); } finally { fs.rmSync(jobFile, { force: true }); }
  }
  async open(id) {
    const source = this.library.filePath(id), ext = path.extname(source).toLowerCase();
    const stat = fs.statSync(source); if (stat.size > 512 * 1024 * 1024) throw Error('第一版仅支持阅读 512 MB 以内的文件');
    const hash = fingerprint(source);
    let bytes, info;
    if (ext === '.pdf') { bytes = fs.readFileSync(source); info = await pdfAnnotations(bytes); }
    else if (ext === '.pptx' || ext === '.ppt') {
      const output = path.join(this.cache, hash + '.pdf'), metadata = output + '.json';
      if (fs.existsSync(output) && fs.existsSync(metadata)) info = JSON.parse(fs.readFileSync(metadata, 'utf8'));
      else { info = await this.run({ action: 'export', source, output }); fs.writeFileSync(metadata, JSON.stringify(info)); }
      bytes = fs.readFileSync(output);
    } else throw Error('此格式请使用外部软件打开');
    if (!Number.isInteger(info.total) || info.total < 1 || info.total > 100000) throw Error('文档页数无效');
    info.annotations = validateAnnotations(info.annotations || [], info.total);
    if (fingerprint(source) !== hash) throw Error('文件在打开期间被修改，请重试');
    if (ext === '.pdf') bytes = Buffer.from(await writePDF(bytes, []));
    this.sessions.set(id, { hash, total: info.total, ext });
    this.library.progress(id, Math.min(this.library.file(id).page, info.total), info.total);
    return { bytes, annotations: info.annotations || [], total: info.total, kind: ext === '.pdf' ? 'pdf' : 'ppt', hash, page: this.library.file(id).page };
  }
  async save(id, hash, annotations) {
    const session = this.sessions.get(id);
    if (!session || session.hash !== hash) throw Error('阅读会话已变化，请重新打开文件');
    const source = this.library.filePath(id);
    if (fingerprint(source) !== hash) throw Error('原文件已被其他程序修改，请重新打开后再批注，避免覆盖外部更改');
    const validated = validateAnnotations(annotations, session.total);
    const temp = path.join(path.dirname(source), '.wb-' + crypto.randomUUID() + path.extname(source));
    try {
      if (session.ext === '.pdf') fs.writeFileSync(temp, await writePDF(fs.readFileSync(source), validated), { flag: 'wx' });
      else {
        if (session.ext !== '.pptx') throw Error('旧版 .ppt 支持阅读；请先用 PowerPoint 另存为 .pptx 后再批注');
        fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
        await this.run({ action: 'annotate', source: temp, annotations: validated });
      }
      noLinks(source);
      if (fingerprint(source) !== hash) throw Error('保存期间原文件发生变化，未覆盖原文件');
      fs.renameSync(temp, source);
      const next = fingerprint(source); session.hash = next;
      // Refresh the identity after atomic replacement, retaining the stable file id.
      this.library.scan(); return { hash: next };
    } finally { fs.rmSync(temp, { force: true }); }
  }
}
module.exports = { Documents, validateAnnotations, pdfAnnotations, writePDF, psJob };
