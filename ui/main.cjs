/**
 * Electron main process for the iso-tile-converter GUI.
 *
 * The CLI script at bin/iso-tile-converter.mjs is still the source of truth
 * for conversion logic — this file just dynamically imports it and drives it
 * from IPC handlers. The GUI is purely additive; CLI usage is unchanged.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')

// The converter is an ES module — import it lazily once Electron is ready.
let converter = null
let presets = null

async function loadModules() {
    if (!converter) {
        const converterUrl = require('url').pathToFileURL(
            path.join(__dirname, '..', 'bin', 'iso-tile-converter.mjs')
        ).href
        converter = await import(converterUrl)
    }
    if (!presets) {
        const presetsUrl = require('url').pathToFileURL(
            path.join(__dirname, 'presets.mjs')
        ).href
        presets = await import(presetsUrl)
    }
    return { converter, presets }
}

let mainWindow = null

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 880,
        height: 720,
        minWidth: 640,
        minHeight: 560,
        title: 'iso-tile-converter',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    })

    mainWindow.removeMenu()
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

    // Open links in the user's default browser, not inside the app.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
        return { action: 'deny' }
    })
}

app.whenReady().then(async () => {
    await loadModules()
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

// ---- IPC handlers --------------------------------------------------------

ipcMain.handle('presets:list', async () => {
    const { presets: p } = await loadModules()
    return p.PRESETS
})

ipcMain.handle('dialog:pick-source', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select a tilemap PNG',
        properties: ['openFile'],
        filters: [{ name: 'PNG images', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
})

ipcMain.handle('dialog:pick-output', async (_evt, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select an output folder',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: defaultPath || undefined
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
})

ipcMain.handle('image:probe', async (_evt, sourcePath) => {
    // Returns the image's width/height so the renderer can suggest cols/rows.
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        return { ok: false, error: `File not found: ${sourcePath}` }
    }
    try {
        const { loadImage } = require('@napi-rs/canvas')
        const img = await loadImage(sourcePath)
        return { ok: true, width: img.width, height: img.height }
    } catch (err) {
        return { ok: false, error: err.message || String(err) }
    }
})

ipcMain.handle('shell:open-path', async (_evt, p) => {
    if (!p) return
    const err = await shell.openPath(p)
    if (err) return { ok: false, error: err }
    return { ok: true }
})

ipcMain.handle('converter:run', async (evt, spec) => {
    const { converter: c } = await loadModules()
    const sender = evt.sender

    const onProgress = (info) => {
        if (!sender.isDestroyed()) sender.send('converter:progress', info)
    }

    try {
        sender.send('converter:log', `[${spec.name}] starting conversion…`)
        // Honor "let the script infer if missing" — the GUI normally provides
        // cols/rows after probing, but be defensive in case it doesn't.
        if (!spec.cols || !spec.rows) {
            const { loadImage } = require('@napi-rs/canvas')
            const img = await loadImage(spec.source)
            if (!spec.cols) spec.cols = img.width / spec.tileSize
            if (!spec.rows) spec.rows = img.height / spec.tileSize
        }

        const result = await c.convertTileset(spec, onProgress)

        if (spec.manifest) c.emitManifest(spec, result)
        if (spec.tsRegistryPath) {
            c.emitTsRegistry([spec], [result], spec.tsRegistryPath)
        }

        sender.send(
            'converter:log',
            `[${spec.name}] wrote ${result.entries.length} tile(s)` +
            (result.skipped ? `, skipped ${result.skipped} transparent` : '')
        )
        return {
            ok: true,
            written: result.entries.length,
            skipped: result.skipped,
            outputDir: spec.outputDir
        }
    } catch (err) {
        const msg = err && err.message ? err.message : String(err)
        sender.send('converter:log', `Error: ${msg}`)
        return { ok: false, error: msg }
    }
})
