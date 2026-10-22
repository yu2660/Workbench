const { contextBridge, ipcRenderer, webUtils } = require('electron');
const allowed = ['state', 'chooseRoot', 'addCourse', 'editCourse', 'removeCourse', 'newFolder', 'rename', 'move', 'remove', 'importDialog', 'importDrop', 'open', 'saveAnnotations', 'progress', 'external', 'reveal', 'setReaderFullscreen'];
const api = Object.fromEntries(allowed.map(name => [name, (...args) => ipcRenderer.invoke('wb:' + name, ...args).then(result => { if (!result.ok) throw Error(result.error); return result.value; })]));
// Only real dropped File objects can grant import access; never expose a method
// accepting arbitrary filesystem paths to the document renderer.
api.prepareDrop = files => {
  const paths = Array.from(files, f => webUtils.getPathForFile(f)).filter(Boolean);
  return ipcRenderer.invoke('wb:prepareDrop', paths).then(result => { if (!result.ok) throw Error(result.error); return result.value; });
};
api.onChange = callback => { const listener = () => callback(); ipcRenderer.on('wb:changed', listener); return () => ipcRenderer.removeListener('wb:changed', listener); };
api.onFullscreenChange = callback => { const listener = (_event, enabled) => callback(enabled); ipcRenderer.on('wb:fullscreen', listener); return () => ipcRenderer.removeListener('wb:fullscreen', listener); };
contextBridge.exposeInMainWorld('workbench', api);
