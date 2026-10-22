const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Library, atomicJSON } = require('./library.cjs');
const { Documents } = require('./documents.cjs');
if (process.env.WORKBENCH_TEST_HOME && !app.isPackaged) app.setPath('userData', process.env.WORKBENCH_TEST_HOME);
let win, library, documents, watcher, refreshTimer, chain = Promise.resolve();
const uiFile = path.join(__dirname, '..', 'renderer', 'index.html');
const uiURL = pathToFileURL(uiFile).href;
const dropGrants = new Map();
function scriptPath() { return path.join(__dirname, '..', 'scripts', 'powerpoint.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep); }
function configPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function attach(root) {
  const next = new Library(root, file => shell.trashItem(file));
  watcher?.close(); library = next;
  documents = new Documents(library, path.join(app.getPath('userData'), 'preview-cache'), scriptPath());
  watcher = fs.watch(root, { recursive: true }, (_event, file) => {
    if (!file || file.split(/[\\/]/).some(x => x.startsWith('.') || x.startsWith('~$'))) return;
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => win?.webContents.send('wb:changed'), 450);
  });
  watcher.on('error', e => { console.error('资料库监视失败', e.message); });
  atomicJSON(configPath(), { root });
}
function required() { if (!library) throw Error('请先选择资料库'); }
const handlers = {
  state: () => library ? library.scan() : { root: null, courses: [], files: [], folders: [], warnings: [] },
  chooseRoot: async () => {
    const choice = await dialog.showOpenDialog(win, { title: '选择 Workbench 资料库文件夹', properties: ['openDirectory', 'createDirectory'] });
    if (!choice.canceled) attach(choice.filePaths[0]);
    return handlers.state();
  },
  addCourse: (name, color) => { library.addCourse(name, color); return library.scan(); },
  editCourse: (...args) => library.editCourse(...args),
  removeCourse: (...args) => library.removeCourse(...args),
  newFolder: (...args) => library.newFolder(...args),
  rename: (...args) => library.rename(...args),
  move: (...args) => library.move(...args),
  remove: (...args) => library.remove(...args),
  importDialog: async (course, category, sub, folders) => {
    const result = await dialog.showOpenDialog(win, { title: '导入后文件将移动到资料库（保留一份）', properties: folders ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'] });
    return result.canceled ? library.scan() : library.import(result.filePaths, course, category, sub);
  },
  prepareDrop: paths => {
    if (!Array.isArray(paths) || !paths.length || paths.length > 500 || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw Error('拖入文件无效');
    for (const [key, value] of dropGrants) if (value.expires < Date.now()) dropGrants.delete(key);
    if (dropGrants.size > 100) throw Error('待处理的导入过多');
    const token = require('node:crypto').randomUUID();
    dropGrants.set(token, { paths, expires: Date.now() + 300000 });
    return { token, count: paths.length };
  },
  importDrop: (token, ...args) => {
    const grant = dropGrants.get(token); dropGrants.delete(token);
    if (!grant || grant.expires < Date.now()) throw Error('拖入授权已过期，请重新拖入文件');
    return library.import(grant.paths, ...args);
  },
  open: id => documents.open(id),
  saveAnnotations: (...args) => documents.save(...args),
  progress: (...args) => library.progress(...args),
  external: async id => {
    const file = library.filePath(id);
    // Do not launch scripts, executables, shortcuts, HTML or arbitrary protocols.
    if (!['.pdf', '.ppt', '.pptx', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mp3', '.zip'].includes(path.extname(file).toLowerCase())) throw Error('此类型不允许直接运行，请在资源管理器中查看');
    const result = await shell.openPath(file); if (result) throw Error(result);
  },
  reveal: rel => { shell.showItemInFolder(library.resolve(rel)); },
  setReaderFullscreen: enabled => {
    if (typeof enabled !== 'boolean') throw Error('全屏状态无效');
    win.setFullScreen(enabled);
    return win.isFullScreen();
  },
};
for (const [name, handler] of Object.entries(handlers)) ipcMain.handle('wb:' + name, (event, ...args) => {
  const execute = async () => {
    try {
      if (!win || event.sender !== win.webContents || event.senderFrame?.url !== uiURL) throw Error('不受信任的调用来源');
      if (JSON.stringify(args).length > 4 * 1024 * 1024) throw Error('请求过大');
      if (!['state', 'chooseRoot'].includes(name)) required();
      return { ok: true, value: await handler(...args) };
    } catch (e) { return { ok: false, error: e.message }; }
  };
  const result = chain.then(execute); chain = result.catch(() => {}); return result;
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    let startupError;
    try { if (fs.existsSync(configPath())) attach(JSON.parse(fs.readFileSync(configPath(), 'utf8')).root); } catch (e) { startupError = e.message; }
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('blob:') && !details.url.startsWith('data:') && details.url !== 'devtools://devtools/bundled/inspector.html' }));
    win = new BrowserWindow({ show: !process.env.WORKBENCH_TEST_HOME || app.isPackaged, icon: path.join(__dirname, '..', 'assets', 'workbench.ico'), width: 1440, height: 940, minWidth: 1080, minHeight: 720, title: 'Workbench', backgroundColor: '#f7f8f5', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.on('will-attach-webview', e => e.preventDefault());
    win.on('enter-full-screen', () => win.webContents.send('wb:fullscreen', true));
    win.on('leave-full-screen', () => win.webContents.send('wb:fullscreen', false));
    win.webContents.on('will-prevent-unload', e => {
      const choice = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['返回保存', '放弃未保存的批注并退出'], defaultId: 0, cancelId: 0, message: '还有批注没有写回原文件', detail: '请先重试保存；退出后未保存的批注会丢失。' });
      if (choice === 1) e.preventDefault();
    });
    win.loadFile(uiFile);
    if (startupError) win.webContents.once('did-finish-load', () => dialog.showMessageBox(win, { type: 'warning', message: '原资料库暂时无法打开', detail: startupError }));
  });
  app.on('window-all-closed', () => { watcher?.close(); clearTimeout(refreshTimer); app.quit(); });
}
