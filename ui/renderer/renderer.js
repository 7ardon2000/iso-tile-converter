/* global window, document */

// ---- DOM refs -----------------------------------------------------------
const els = {
    pickSource:      document.getElementById('btn-pick-source'),
    sourcePath:      document.getElementById('source-path'),
    sourceInfo:      document.getElementById('source-info'),

    tileSize:        document.getElementById('tile-size'),
    upscale:         document.getElementById('upscale'),
    cols:            document.getElementById('cols'),
    rows:            document.getElementById('rows'),

    preset:          document.getElementById('preset'),
    diamondW:        document.getElementById('diamond-w'),
    diamondH:        document.getElementById('diamond-h'),
    canvasH:         document.getElementById('canvas-h'),
    presetNote:      document.getElementById('preset-note'),

    skipTransparent: document.getElementById('skip-transparent'),
    emitManifest:    document.getElementById('emit-manifest'),
    emitRegistry:    document.getElementById('emit-registry'),

    pickOutput:      document.getElementById('btn-pick-output'),
    outputPath:      document.getElementById('output-path'),

    convert:         document.getElementById('btn-convert'),
    openOutput:      document.getElementById('btn-open-output'),

    progress:        document.getElementById('progress'),
    progressText:    document.getElementById('progress-text'),
    log:             document.getElementById('log')
}

// ---- state --------------------------------------------------------------
const state = {
    sourcePath: null,
    sourceWidth: 0,
    sourceHeight: 0,
    /** User-overridden output dir, or null = auto. */
    outputDirOverride: null,
    /** Last output dir used (for "Open output folder"). */
    lastOutputDir: null,
    /** Full preset list as returned from main. */
    presets: [],
    /** Whether the user manually edited the diamond/canvas inputs. */
    customSizeMode: false
}

// ---- helpers ------------------------------------------------------------
function appendLog(msg, level) {
    const ts = new Date().toLocaleTimeString()
    els.log.textContent += `[${ts}] ${msg}\n`
    els.log.scrollTop = els.log.scrollHeight
    if (level === 'error') els.log.classList.add('has-error')
    if (level === 'success') els.log.classList.add('has-success')
}

function sanitizeIdent(s) {
    return s.replace(/[^a-zA-Z0-9_]/g, '_')
}

function basenameNoExt(p) {
    const base = p.replace(/\\/g, '/').split('/').pop() || p
    return base.replace(/\.[^.]+$/, '')
}

function dirnameOf(p) {
    const parts = p.replace(/\\/g, '/').split('/')
    parts.pop()
    return parts.join('/')
}

function joinPath(a, b) {
    if (!a) return b
    return a.replace(/[\\/]$/, '') + '/' + b
}

function autoOutputDir() {
    if (!state.sourcePath) return null
    const name = sanitizeIdent(basenameNoExt(state.sourcePath))
    return joinPath(dirnameOf(state.sourcePath), name + '_iso')
}

function effectiveOutputDir() {
    return state.outputDirOverride || autoOutputDir()
}

function refreshOutputPathDisplay() {
    if (state.outputDirOverride) {
        els.outputPath.textContent = state.outputDirOverride
        els.outputPath.classList.remove('muted')
    } else {
        const auto = autoOutputDir()
        els.outputPath.textContent = auto ? `(auto) ${auto}` : '(auto: next to source)'
        els.outputPath.classList.add('muted')
    }
}

function refreshConvertButton() {
    const tileSize = parseInt(els.tileSize.value, 10)
    const ok =
        state.sourcePath &&
        Number.isFinite(tileSize) && tileSize >= 1 &&
        Number.isFinite(parseInt(els.diamondW.value, 10)) &&
        Number.isFinite(parseInt(els.diamondH.value, 10)) &&
        Number.isFinite(parseInt(els.canvasH.value, 10))
    els.convert.disabled = !ok
}

// ---- presets ------------------------------------------------------------
function resolvePresetLocally(id, tileSize) {
    const p = state.presets.find((x) => x.id === id)
    if (!p) return null
    if (p.diamondW !== undefined) {
        return { diamondW: p.diamondW, diamondH: p.diamondH, canvasH: p.canvasH }
    }
    const diamondW = tileSize * p.factor
    const diamondH = Math.round(diamondW / 2)
    const cliff = p.cliff != null ? p.cliff : 0
    return { diamondW, diamondH, canvasH: diamondH + Math.round(diamondH * cliff) }
}

function populatePresets(presets) {
    state.presets = presets
    els.preset.innerHTML = ''
    // Group by `group` field, preserving order of first occurrence.
    const groups = new Map()
    for (const p of presets) {
        if (!groups.has(p.group)) groups.set(p.group, [])
        groups.get(p.group).push(p)
    }
    for (const [groupName, items] of groups) {
        const og = document.createElement('optgroup')
        og.label = groupName
        for (const p of items) {
            const opt = document.createElement('option')
            opt.value = p.id
            opt.textContent = p.label
            og.appendChild(opt)
        }
        els.preset.appendChild(og)
    }
    // Plus an explicit "custom" option at the end.
    const customOg = document.createElement('optgroup')
    customOg.label = 'Custom'
    const customOpt = document.createElement('option')
    customOpt.value = '__custom__'
    customOpt.textContent = 'Custom (enter values below)'
    customOg.appendChild(customOpt)
    els.preset.appendChild(customOg)

    // Default selection: the tool's existing default.
    els.preset.value = 'default-203'
    applyPreset()
}

function applyPreset() {
    const id = els.preset.value
    if (id === '__custom__') {
        els.presetNote.textContent = 'Custom size — edit the three fields below.'
        state.customSizeMode = true
        return
    }
    const tileSize = parseInt(els.tileSize.value, 10) || 16
    const resolved = resolvePresetLocally(id, tileSize)
    if (!resolved) return
    els.diamondW.value = resolved.diamondW
    els.diamondH.value = resolved.diamondH
    els.canvasH.value  = resolved.canvasH
    state.customSizeMode = false

    const p = state.presets.find((x) => x.id === id)
    if (p && p.factor != null) {
        els.presetNote.textContent =
            `Derived from tile size ${tileSize}px × ${p.factor} → ${resolved.diamondW}×${resolved.diamondH}` +
            (resolved.canvasH > resolved.diamondH ? ` (canvas ${resolved.canvasH})` : '')
    } else if (p && p.note) {
        els.presetNote.textContent = p.note
    } else {
        els.presetNote.textContent =
            `${resolved.diamondW}×${resolved.diamondH}` +
            (resolved.canvasH > resolved.diamondH ? ` with ${resolved.canvasH - resolved.diamondH}px cliff strip` : '')
    }
    refreshConvertButton()
}

// ---- handlers -----------------------------------------------------------
async function onPickSource() {
    const p = await window.api.pickSource()
    if (!p) return
    state.sourcePath = p
    els.sourcePath.textContent = p
    els.sourcePath.classList.remove('muted')

    const info = await window.api.probeImage(p)
    if (!info.ok) {
        els.sourceInfo.textContent = `Error: ${info.error}`
        appendLog(`Probe failed: ${info.error}`, 'error')
        refreshConvertButton()
        return
    }
    state.sourceWidth = info.width
    state.sourceHeight = info.height

    // Auto-fill cols/rows from tile size when they line up cleanly.
    autoFillGridDims()
    refreshOutputPathDisplay()
    refreshConvertButton()
}

function autoFillGridDims() {
    if (!state.sourceWidth) return
    const T = parseInt(els.tileSize.value, 10)
    if (!Number.isFinite(T) || T < 1) return
    const cols = state.sourceWidth / T
    const rows = state.sourceHeight / T
    const fits = Number.isInteger(cols) && Number.isInteger(rows)
    if (fits) {
        els.cols.value = cols
        els.rows.value = rows
        els.sourceInfo.textContent =
            `${state.sourceWidth}×${state.sourceHeight} → ${cols} cols × ${rows} rows of ${T}px (${cols * rows} tiles)`
        els.sourceInfo.classList.remove('has-error')
    } else {
        els.cols.value = ''
        els.rows.value = ''
        els.sourceInfo.textContent =
            `${state.sourceWidth}×${state.sourceHeight} doesn't divide evenly by ${T}px — set cols/rows manually.`
    }
}

async function onPickOutput() {
    const def = state.outputDirOverride || autoOutputDir() || undefined
    const p = await window.api.pickOutputDir(def)
    if (!p) return
    state.outputDirOverride = p
    refreshOutputPathDisplay()
}

async function onConvert() {
    if (!state.sourcePath) return

    const tileSize = parseInt(els.tileSize.value, 10)
    const upscale = parseInt(els.upscale.value, 10) || 8
    const colsVal = parseInt(els.cols.value, 10)
    const rowsVal = parseInt(els.rows.value, 10)
    const diamondW = parseInt(els.diamondW.value, 10)
    const diamondH = parseInt(els.diamondH.value, 10)
    const canvasH  = parseInt(els.canvasH.value, 10)

    if (canvasH < diamondH) {
        appendLog('Canvas height must be ≥ diamond height.', 'error')
        return
    }

    const outputDir = effectiveOutputDir()
    if (!outputDir) {
        appendLog('No output dir resolved — pick one explicitly.', 'error')
        return
    }
    const name = sanitizeIdent(basenameNoExt(state.sourcePath))

    const spec = {
        source: state.sourcePath,
        name,
        tileSize,
        cols: Number.isFinite(colsVal) ? colsVal : null,
        rows: Number.isFinite(rowsVal) ? rowsVal : null,
        outputDir,
        textureKeyPrefix: name,
        diamondWidth: diamondW,
        diamondHeight: diamondH,
        canvasHeight: canvasH,
        upscaleFactor: upscale,
        skipTransparent: els.skipTransparent.checked,
        manifest: els.emitManifest.checked,
        tsRegistryPath: els.emitRegistry.checked ? joinPath(outputDir, 'iso-tilesets.gen.ts') : null
    }

    // Lock UI during conversion.
    setBusy(true)
    els.progress.value = 0
    els.progress.max = (spec.cols && spec.rows) ? (spec.cols * spec.rows) : 1
    els.progressText.textContent = 'Starting…'
    els.log.classList.remove('has-error', 'has-success')

    const result = await window.api.runConversion(spec)

    setBusy(false)
    if (result.ok) {
        els.progress.value = els.progress.max
        els.progressText.textContent =
            `Done — ${result.written} tile(s) written` +
            (result.skipped ? `, ${result.skipped} skipped` : '')
        appendLog(`Output: ${result.outputDir}`, 'success')
        state.lastOutputDir = result.outputDir
        els.openOutput.disabled = false
    } else {
        els.progressText.textContent = 'Failed'
        appendLog(result.error || 'Unknown error', 'error')
    }
}

function setBusy(busy) {
    els.convert.disabled = busy
    els.pickSource.disabled = busy
    els.pickOutput.disabled = busy
    els.preset.disabled = busy
    els.tileSize.disabled = busy
    els.cols.disabled = busy
    els.rows.disabled = busy
    els.upscale.disabled = busy
    els.diamondW.disabled = busy
    els.diamondH.disabled = busy
    els.canvasH.disabled = busy
    els.skipTransparent.disabled = busy
    els.emitManifest.disabled = busy
    els.emitRegistry.disabled = busy
    if (!busy) refreshConvertButton()
}

async function onOpenOutput() {
    if (!state.lastOutputDir) return
    await window.api.openPath(state.lastOutputDir)
}

// ---- progress stream ----------------------------------------------------
window.api.onProgress((info) => {
    els.progress.max = info.total
    els.progress.value = info.processed
    els.progressText.textContent =
        `${info.processed} / ${info.total}` +
        ` (written ${info.written}` +
        (info.skipped ? `, skipped ${info.skipped}` : '') +
        ')'
})

window.api.onLog((msg) => {
    appendLog(msg)
})

// ---- wire-up ------------------------------------------------------------
els.pickSource.addEventListener('click', onPickSource)
els.pickOutput.addEventListener('click', onPickOutput)
els.convert.addEventListener('click', onConvert)
els.openOutput.addEventListener('click', onOpenOutput)

els.preset.addEventListener('change', applyPreset)
els.tileSize.addEventListener('input', () => {
    autoFillGridDims()
    // Re-resolve source-matched presets when tile size changes.
    if (!state.customSizeMode) applyPreset()
    refreshConvertButton()
})

for (const el of [els.diamondW, els.diamondH, els.canvasH]) {
    el.addEventListener('input', () => {
        els.preset.value = '__custom__'
        state.customSizeMode = true
        els.presetNote.textContent = 'Custom size.'
        refreshConvertButton()
    })
}

// Initial load.
;(async () => {
    try {
        const presets = await window.api.listPresets()
        populatePresets(presets)
        appendLog('Ready. Pick a tilemap to begin.')
    } catch (err) {
        appendLog(`Failed to initialize: ${err && err.message ? err.message : err}`, 'error')
    }
})()
