const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const CATEGORIES = ['课程资料', '作业', '其他资料'];
const COLORS = ['#698b78', '#718bb3', '#b98b65', '#9683b4', '#ba7d86', '#6f9b9c'];
function validName(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 100 || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) || /^\./.test(value) || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i.test(value)) throw Error('名称无效：请勿使用路径、保留名称或特殊字符');
  return value;
}
function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function noLinks(target) {
  let current = path.resolve(target);
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('不支持符号链接或目录联接');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function atomicJSON(file, data) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { flag: 'wx' });
  try { fs.renameSync(tmp, file); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}
function fingerprint(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
class Library {
  constructor(root, trash) {
    this.root = path.resolve(root); noLinks(this.root);
    fs.mkdirSync(this.root, { recursive: true });
    this.meta = path.join(this.root, '.workbench');
    noLinks(this.meta); fs.mkdirSync(this.meta, { recursive: true });
    this.stateFile = path.join(this.meta, 'library.json');
    noLinks(this.stateFile);
    this.trash = trash;
    this.db = fs.existsSync(this.stateFile) ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) : { version: 1, courses: [], files: {} };
    if (this.db.version !== 1 || !Array.isArray(this.db.courses) || !this.db.files) throw Error('资料库索引格式不受支持');
    for (const c of this.db.courses) {
      validName(c.name);
      if (!COLORS.includes(c.color) || typeof c.id !== 'string' || !/^[a-f0-9-]{36}$/.test(c.id)) throw Error('课程索引内容无效');
    }
    this.scan();
  }
  save() { noLinks(this.meta); noLinks(this.stateFile); atomicJSON(this.stateFile, this.db); }
  course(id) { const c = this.db.courses.find(c => c.id === id); if (!c) throw Error('课程不存在'); validName(c.name); return c; }
  resolve(rel = '') {
    if (typeof rel !== 'string' || path.isAbsolute(rel)) throw Error('路径无效');
    const target = path.resolve(this.root, rel);
    if (!inside(this.root, target) || inside(this.meta, target)) throw Error('禁止访问资料库以外或内部索引');
    noLinks(target); return target;
  }
  directory(courseId, category, sub = '') {
    const c = this.course(courseId);
    if (!CATEGORIES.includes(category)) throw Error('栏目不存在');
    const base = this.resolve(path.join(c.name, category));
    const dest = this.resolve(path.join(c.name, category, sub));
    if (!inside(base, dest)) throw Error('路径越界');
    if (!fs.statSync(dest).isDirectory()) throw Error('目标不是文件夹');
    return dest;
  }
  addCourse(name, color = COLORS[0]) {
    validName(name); if (!COLORS.includes(color)) throw Error('封面颜色无效');
    const dir = this.resolve(name);
    if (this.db.courses.some(c => c.name.toLowerCase() === name.toLowerCase())) throw Error('同名课程已经存在');
    if (fs.existsSync(dir)) {
      if (!fs.statSync(dir).isDirectory() || !CATEGORIES.every(cat => {
        const folder = path.join(dir, cat); noLinks(folder);
        return fs.existsSync(folder) && fs.statSync(folder).isDirectory();
      })) throw Error('同名文件夹已存在，且不是包含三个栏目的课程目录');
    } else {
      fs.mkdirSync(dir);
      for (const cat of CATEGORIES) fs.mkdirSync(path.join(dir, cat));
    }
    const c = { id: crypto.randomUUID(), name, color, createdAt: Date.now() };
    this.db.courses.push(c); this.save(); return c;
  }
  editCourse(id, name, color) {
    const c = this.course(id); validName(name); if (!COLORS.includes(color)) throw Error('封面颜色无效');
    if (c.name !== name) this.renamePath(c.name, name);
    c.name = name; c.color = color; this.save(); return this.scan();
  }
  async removeCourse(id, deleteFiles) {
    const c = this.course(id);
    if (deleteFiles) { if (!this.trash) throw Error('回收站服务不可用'); await this.trash(this.resolve(c.name)); }
    this.db.courses = this.db.courses.filter(c => c.id !== id);
    for (const [id, f] of Object.entries(this.db.files)) if (f.courseId === c.id) delete this.db.files[id];
    this.save(); return this.scan();
  }
  scan() {
    const previous = Object.values(this.db.files), next = {}, folders = [], warnings = [];
    const byPath = new Map(previous.map(f => [f.rel.toLowerCase(), f]));
    const byIdentity = new Map(previous.filter(f => f.identity).map(f => [f.identity, f]));
    for (const c of this.db.courses) {
      let courseDir; try { courseDir = this.resolve(this.course(c.id).name); } catch (e) { warnings.push(c.name + '：' + e.message); continue; }
      if (!fs.existsSync(courseDir)) { warnings.push('课程文件夹不在原位置：' + c.name); continue; }
      for (const category of CATEGORIES) {
        const base = path.join(courseDir, category);
        if (!fs.existsSync(base)) { warnings.push(c.name + ' 缺少栏目文件夹：' + category); continue; }
        const walk = (dir, depth = 0) => {
          if (depth > 40) { warnings.push('文件夹层级过深，已跳过'); return; }
          try { noLinks(dir); } catch { warnings.push('已跳过链接：' + path.relative(this.root, dir)); return; }
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.name.startsWith('.') || ent.name.startsWith('~$')) continue;
            const full = path.join(dir, ent.name), rel = path.relative(this.root, full);
            if (ent.isSymbolicLink()) { warnings.push('已跳过链接：' + rel); continue; }
            if (ent.isDirectory()) { folders.push({ rel, name: ent.name, courseId: c.id, category, sub: path.relative(base, full), parent: path.relative(base, dir) }); walk(full, depth + 1); }
            else if (ent.isFile()) {
              const stat = fs.statSync(full), identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
              const old = byPath.get(rel.toLowerCase()) || byIdentity.get(identity);
              const id = old?.id || crypto.randomUUID();
              next[id] = { ...old, id, rel, name: ent.name, courseId: c.id, category, parent: path.relative(base, dir), size: stat.size, modifiedAt: stat.mtimeMs, addedAt: old?.addedAt || Date.now(), identity, page: old?.page || 1, total: old?.total || 0, lastOpened: old?.lastOpened || 0 };
            }
          }
        };
        walk(base);
      }
    }
    this.db.files = next; this.save();
    return { root: this.root, courses: this.db.courses, files: Object.values(next), folders, warnings };
  }
  file(id) { const f = this.db.files[id]; if (!f) throw Error('文件不存在或已移动'); this.resolve(f.rel); return f; }
  filePath(id) { return this.resolve(this.file(id).rel); }
  newFolder(courseId, category, sub, name) { validName(name); const dest = path.join(this.directory(courseId, category, sub), name); fs.mkdirSync(dest); return this.scan(); }
  remap(from, to) {
    for (const f of Object.values(this.db.files)) {
      if (inside(from, f.rel)) f.rel = path.join(to, path.relative(from, f.rel));
    }
  }
  renamePath(rel, newName) {
    validName(newName); const source = this.resolve(rel), dest = path.join(path.dirname(source), newName);
    if (source === dest) return;
    if (fs.existsSync(dest)) throw Error('目标名称已存在');
    fs.renameSync(source, dest); this.remap(rel, path.relative(this.root, dest));
  }
  managed(rel) {
    this.resolve(rel);
    const parts = rel.split(/[\\/]/);
    if (parts.length < 3 || !this.db.courses.some(c => c.name === parts[0]) || !CATEGORIES.includes(parts[1])) throw Error('只能操作栏目内的文件或子文件夹');
  }
  rename(rel, name) { this.managed(rel); this.renamePath(rel, name); return this.scan(); }
  move(rel, courseId, category, sub) {
    this.managed(rel); const source = this.resolve(rel), dest = path.join(this.directory(courseId, category, sub), path.basename(source));
    if (inside(source, dest)) throw Error('不能移入自身或子文件夹');
    if (fs.existsSync(dest)) throw Error('目标已存在同名文件');
    fs.renameSync(source, dest); this.remap(rel, path.relative(this.root, dest)); return this.scan();
  }
  async remove(rel) { this.managed(rel); if (!this.trash) throw Error('回收站服务不可用'); await this.trash(this.resolve(rel)); return this.scan(); }
  import(paths, courseId, category, sub) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 500) throw Error('请选择 1–500 个文件或文件夹');
    const dir = this.directory(courseId, category, sub);
    const planned = [], seen = new Set();
    for (const source of paths) {
      if (typeof source !== 'string' || !path.isAbsolute(source)) throw Error('导入路径无效');
      noLinks(source); const resolved = path.resolve(source); const name = validName(path.basename(resolved));
      if (inside(this.root, resolved) || inside(resolved, this.root)) throw Error('资料库中的文件请使用移动功能');
      const dest = path.join(dir, name);
      if (fs.existsSync(dest) || seen.has(dest.toLowerCase())) throw Error('同名文件已存在：' + name);
      for (const p of planned) if (inside(p.source, resolved) || inside(resolved, p.source)) throw Error('不能同时导入文件夹和它的子项');
      const inspect = full => {
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw Error('不能导入链接或特殊文件');
        if (stat.isDirectory()) for (const item of fs.readdirSync(full)) inspect(path.join(full, item));
      };
      inspect(resolved); planned.push({ source: resolved, dest }); seen.add(dest.toLowerCase());
    }
    const done = [];
    try {
      for (const p of planned) { this.transfer(p.source, p.dest); done.push(p); }
    } catch (e) {
      for (const p of done.reverse()) { try { this.transfer(p.dest, p.source); } catch { /* Report failure; never remove surviving copy. */ } }
      throw Error('导入未完成，已尽量恢复原位置：' + e.message);
    }
    return this.scan();
  }
  transfer(source, dest) {
    try { fs.renameSync(source, dest); } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      fs.cpSync(source, dest, { recursive: true, errorOnExist: true, force: false, dereference: false });
      const verify = (a, b) => {
        if (fs.statSync(a).isDirectory()) for (const name of fs.readdirSync(a)) verify(path.join(a, name), path.join(b, name));
        else if (fingerprint(a) !== fingerprint(b)) throw Error('跨磁盘复制校验失败；原文件已保留');
      };
      verify(source, dest);
      fs.rmSync(source, { recursive: true });
    }
  }
  progress(id, page, total) {
    if (!Number.isInteger(page) || !Number.isInteger(total) || page < 1 || total < page || total > 100000) throw Error('页码无效');
    const f = this.file(id); Object.assign(f, { page, total, lastOpened: Date.now() }); this.save(); return f;
  }
}
module.exports = { Library, CATEGORIES, COLORS, validName, inside, noLinks, atomicJSON, fingerprint };
