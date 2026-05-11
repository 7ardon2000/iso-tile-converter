/**
 * Preload bridge — exposes a narrow `window.api` surface to the renderer.
 * No Node globals leak; everything the UI can do goes through IPC.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
    listPresets:    ()              => ipcRenderer.invoke('presets:list'),
    pickSource:     ()              => ipcRenderer.invoke('dialog:pick-source'),
    pickOutputDir:  (defaultPath)   => ipcRenderer.invoke('dialog:pick-output', defaultPath),
    probeImage:     (sourcePath)    => ipcRenderer.invoke('image:probe', sourcePath),
    openPath:       (p)             => ipcRenderer.invoke('shell:open-path', p),
    runConversion:  (spec)          => ipcRenderer.invoke('converter:run', spec),

    onProgress: (cb) => {
        const listener = (_evt, info) => cb(info)
        ipcRenderer.on('converter:progress', listener)
        return () => ipcRenderer.removeListener('converter:progress', listener)
    },
    onLog: (cb) => {
        const listener = (_evt, msg) => cb(msg)
        ipcRenderer.on('converter:log', listener)
        return () => ipcRenderer.removeListener('converter:log', listener)
    }
})
