#!/usr/bin/env node
/**
 * iso-tile-converter — convert square pixel-art tilemaps into
 * isometric diamond floor-tile PNGs.
 *
 * CLI usage:
 *   iso-tile-converter <source.png> [options]
 *   iso-tile-converter --config <path/to/tilesets.json>
 *
 * Run with --help for the full option list.
 *
 * Programmatic usage:
 *   import { convertTileset } from 'iso-tile-converter'
 *   await convertTileset({ source, tileSize, cols, rows, outputDir, ... })
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const HELP = `iso-tile-converter — convert square pixel-art tilemaps into isometric diamond tiles.

USAGE
  iso-tile-converter <source.png> [options]
  iso-tile-converter --config <path/to/tilesets.json>

OPTIONS
  --tile-size <px>          Source tile size in pixels (square). Default: 16
  --cols <n>                Source grid columns. Default: inferred (width / tile-size)
  --rows <n>                Source grid rows. Default: inferred (height / tile-size)
  --out <dir>               Output directory. Default: ./out/<source-basename>
  --name <s>                Tileset name (used in manifest + registry). Default: source basename
  --prefix <s>              Texture-key prefix. Default: <name>
  --diamond-width <px>      Output diamond width. Default: 203
  --diamond-height <px>     Output diamond height. Default: 101
  --canvas-height <px>      Output PNG height (>= diamond-height; extra is transparent). Default: 125
  --upscale <n>             Nearest-neighbor upscale factor before affine. Default: 8
  --skip-transparent        Skip fully-transparent source tiles
  --manifest                Also emit <out>/manifest.json describing every tile
  --ts-registry <path>      Also emit a TypeScript static-import registry at <path>
                              (useful for Parcel/webpack/Vite projects)
  --help, -h                Show this help and exit

CONFIG FILE
  When --config is supplied, every other CLI flag is ignored. The config has:
    {
      "diamond":       { "width": 203, "height": 101, "canvasHeight": 125 },
      "upscaleFactor": 8,
      "registryPath":  "out/iso-tilesets.gen.ts",  // optional
      "tilesets": [
        {
          "name":             "myTileset",
          "source":           "path/to/source.png",
          "tileSize":         16,
          "cols":             8,
          "rows":             4,
          "outputDir":        "out/myTileset",
          "textureKeyPrefix": "isoMyTileset",
          "skipTransparent":  true,
          "manifest":         false
        }
      ]
    }
  Per-tileset fields override top-level defaults.

EXAMPLES
  iso-tile-converter floor.png --tile-size 16 --skip-transparent --manifest
  iso-tile-converter --config examples/tilesets.config.json
`

// ---- arg parsing ---------------------------------------------------------

function parseArgs(argv) {
    const out = { _: [], opts: {} }
    const booleans = new Set(['help', 'h', 'skip-transparent', 'manifest'])
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '-h' || a === '--help') {
            out.opts.help = true
            continue
        }
        if (a.startsWith('--')) {
            const key = a.slice(2)
            if (booleans.has(key)) {
                out.opts[key] = true
                continue
            }
            const next = argv[i + 1]
            if (next === undefined || next.startsWith('--')) {
                out.opts[key] = true
            } else {
                out.opts[key] = next
                i++
            }
        } else {
            out._.push(a)
        }
    }
    return out
}

const intOr = (v, d) => (v === undefined ? d : parseInt(v, 10))
const sanitizeIdent = (s) => s.replace(/[^a-zA-Z0-9_]/g, '_')

function writeFileWithRetry(filePath, buf) {
    try {
        fs.writeFileSync(filePath, buf)
    } catch (err) {
        if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err
        const until = Date.now() + 80
        while (Date.now() < until) { /* short spin */ }
        fs.writeFileSync(filePath, buf)
    }
}

function isTileTransparent(ctx, x, y, size) {
    const data = ctx.getImageData(x, y, size, size).data
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) return false
    }
    return true
}

// ---- core conversion -----------------------------------------------------

/**
 * Convert one tileset.
 * @param {object} spec
 * @param {string} spec.source            Absolute or CWD-relative PNG path.
 * @param {number} spec.tileSize          Source tile size (square).
 * @param {number} spec.cols              Source grid columns.
 * @param {number} spec.rows              Source grid rows.
 * @param {string} spec.outputDir         Absolute or CWD-relative output dir.
 * @param {string} [spec.name]            Tileset name (for logs only).
 * @param {string} [spec.textureKeyPrefix] Used by manifest + TS registry keys.
 * @param {number} [spec.diamondWidth=203]
 * @param {number} [spec.diamondHeight=101]
 * @param {number} [spec.canvasHeight=125]
 * @param {number} [spec.upscaleFactor=8]
 * @param {boolean} [spec.skipTransparent=false]
 * @param {(p:{processed:number,total:number,written:number,skipped:number,row:number,col:number}) => void} [onProgress]
 *   Optional callback fired after each tile is processed. Used by the GUI to drive a progress bar.
 *   Not called by the CLI path, so existing programmatic callers are unaffected.
 * @returns {Promise<{entries: Array<{row:number,col:number,fileName:string}>, skipped:number}>}
 */
export async function convertTileset(spec, onProgress) {
    const {
        source, tileSize, cols, rows, outputDir,
        diamondWidth = 203, diamondHeight = 101, canvasHeight = 125,
        upscaleFactor = 8, skipTransparent = false
    } = spec

    if (!fs.existsSync(source)) throw new Error(`Source not found: ${source}`)
    fs.mkdirSync(outputDir, { recursive: true })

    const srcImg = await loadImage(source)
    const expectedW = cols * tileSize
    const expectedH = rows * tileSize
    if (srcImg.width !== expectedW || srcImg.height !== expectedH) {
        throw new Error(
            `${path.basename(source)} is ${srcImg.width}x${srcImg.height}, ` +
            `expected ${expectedW}x${expectedH} (${cols}x${rows} of ${tileSize}px)`
        )
    }

    // Draw whole source so we can read pixels per-tile.
    const srcCanvas = createCanvas(srcImg.width, srcImg.height)
    const srcCtx = srcCanvas.getContext('2d')
    srcCtx.imageSmoothingEnabled = false
    srcCtx.drawImage(srcImg, 0, 0)

    const T = tileSize
    const upT = T * upscaleFactor
    const upCanvas = createCanvas(upT, upT)
    const upCtx = upCanvas.getContext('2d')
    upCtx.imageSmoothingEnabled = false

    const W = diamondWidth
    const H = diamondHeight

    const entries = []
    let skipped = 0
    const total = rows * cols
    let processed = 0

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const sx = col * T
            const sy = row * T
            if (skipTransparent && isTileTransparent(srcCtx, sx, sy, T)) {
                skipped++
                processed++
                if (onProgress) {
                    onProgress({ processed, total, written: entries.length, skipped, row, col })
                    if (processed % 16 === 0) await new Promise((r) => setImmediate(r))
                }
                continue
            }

            // 1) Nearest-neighbor upscale this sub-tile.
            upCtx.clearRect(0, 0, upT, upT)
            upCtx.drawImage(srcCanvas, sx, sy, T, T, 0, 0, upT, upT)

            // 2) Apply the diamond affine onto a (W x canvasHeight) canvas.
            //    Source corners (0,0)(T,0)(T,T)(0,T) map to diamond corners:
            //      (0,0) -> (W/2, 0)      top
            //      (T,0) -> (W,   H/2)    right
            //      (T,T) -> (W/2, H)      bottom
            //      (0,T) -> (0,   H/2)    left
            //    canvas setTransform(a,b,c,d,e,f) yields
            //      out_x = a*x + c*y + e
            //      out_y = b*x + d*y + f
            //    matrix scaled to consume the upscaled source (upT instead of T).
            const dst = createCanvas(W, canvasHeight)
            const dctx = dst.getContext('2d')
            dctx.imageSmoothingEnabled = false
            dctx.clearRect(0, 0, W, canvasHeight)
            dctx.setTransform(
                W / (2 * upT),  H / (2 * upT),
                -W / (2 * upT), H / (2 * upT),
                W / 2,          0
            )
            dctx.drawImage(upCanvas, 0, 0)

            const fileName = `tile_${row}_${col}.png`
            writeFileWithRetry(path.join(outputDir, fileName), dst.encodeSync('png'))
            entries.push({ row, col, fileName })
            processed++
            if (onProgress) {
                onProgress({ processed, total, written: entries.length, skipped, row, col })
                if (processed % 16 === 0) await new Promise((r) => setImmediate(r))
            }
        }
    }

    return { entries, skipped }
}

// ---- side outputs --------------------------------------------------------

export function emitManifest(spec, result) {
    const manifest = {
        name: spec.name,
        textureKeyPrefix: spec.textureKeyPrefix,
        tileSize: spec.tileSize,
        cols: spec.cols,
        rows: spec.rows,
        diamond: {
            width:  spec.diamondWidth  ?? 203,
            height: spec.diamondHeight ?? 101,
            canvasHeight: spec.canvasHeight ?? 125
        },
        tiles: result.entries.map((e) => ({
            key: spec.textureKeyPrefix ? `${spec.textureKeyPrefix}_${e.row}_${e.col}` : undefined,
            file: e.fileName,
            row: e.row,
            col: e.col
        }))
    }
    fs.writeFileSync(
        path.join(spec.outputDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
    )
}

/**
 * Emit a TypeScript module with static imports + a registry array. Useful for
 * bundlers (Parcel/webpack/Vite) that resolve image imports at build time.
 */
export function emitTsRegistry(specs, results, registryPath) {
    const dir = path.dirname(registryPath)
    fs.mkdirSync(dir, { recursive: true })

    const imports = []
    const groups = []

    for (let i = 0; i < specs.length; i++) {
        const spec = specs[i]
        const result = results[i]
        const prefix = spec.textureKeyPrefix || sanitizeIdent(spec.name || `tileset${i}`)
        const textures = []
        for (const { row, col, fileName } of result.entries) {
            const varName = sanitizeIdent(`${spec.name || `tileset${i}`}_${row}_${col}`)
            const abs = path.resolve(spec.outputDir, fileName)
            const rel = path.relative(dir, abs).replace(/\\/g, '/')
            const importPath = rel.startsWith('.') ? rel : `./${rel}`
            imports.push(`import ${varName} from '${importPath}'`)
            const key = `${prefix}_${row}_${col}`
            textures.push(`        { key: '${key}', url: ${varName}, col: ${col}, row: ${row} }`)
        }
        groups.push(
            `    {\n` +
            `        name: ${JSON.stringify(spec.name || `tileset${i}`)},\n` +
            `        cols: ${spec.cols},\n` +
            `        rows: ${spec.rows},\n` +
            `        tileSize: ${spec.tileSize},\n` +
            `        textures: [\n${textures.join(',\n')}\n        ]\n` +
            `    }`
        )
    }

    const out =
        `/**\n * Generated by iso-tile-converter — do not edit by hand.\n */\n\n` +
        imports.join('\n') + '\n\n' +
        `export interface IsoTilesetEntry { key: string; url: string; col: number; row: number }\n` +
        `export interface IsoTilesetGroup {\n` +
        `    name: string\n` +
        `    cols: number\n` +
        `    rows: number\n` +
        `    tileSize: number\n` +
        `    textures: IsoTilesetEntry[]\n` +
        `}\n\n` +
        `export const ISO_TILESETS: IsoTilesetGroup[] = [\n${groups.join(',\n')}\n]\n`

    fs.writeFileSync(registryPath, out, 'utf8')
}

// ---- CLI entrypoint ------------------------------------------------------

function specFromCli(opts, positional) {
    if (positional.length === 0) throw new Error('No source PNG provided. See --help.')
    const source = path.resolve(positional[0])
    const base = path.basename(source, path.extname(source))
    const name = opts.name || sanitizeIdent(base)
    const tileSize = intOr(opts['tile-size'], 16)
    const cols = opts.cols !== undefined ? parseInt(opts.cols, 10) : null
    const rows = opts.rows !== undefined ? parseInt(opts.rows, 10) : null
    return {
        source,
        name,
        tileSize,
        cols, // null = infer after image loads
        rows,
        outputDir: path.resolve(opts.out || path.join('out', base)),
        textureKeyPrefix: opts.prefix || name,
        diamondWidth: intOr(opts['diamond-width'], 203),
        diamondHeight: intOr(opts['diamond-height'], 101),
        canvasHeight: intOr(opts['canvas-height'], 125),
        upscaleFactor: intOr(opts.upscale, 8),
        skipTransparent: !!opts['skip-transparent'],
        manifest: !!opts.manifest
    }
}

function specsFromConfig(configPath) {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const configDir = path.dirname(path.resolve(configPath))
    const diamond = cfg.diamond || {}
    const specs = (cfg.tilesets || []).map((ts) => {
        const name = ts.name || sanitizeIdent(path.basename(ts.source, path.extname(ts.source)))
        return {
            source: path.resolve(configDir, ts.source),
            name,
            tileSize: ts.tileSize,
            cols: ts.cols,
            rows: ts.rows,
            outputDir: path.resolve(configDir, ts.outputDir || path.join('out', name)),
            textureKeyPrefix: ts.textureKeyPrefix || name,
            diamondWidth: ts.diamondWidth ?? diamond.width ?? 203,
            diamondHeight: ts.diamondHeight ?? diamond.height ?? 101,
            canvasHeight: ts.canvasHeight ?? diamond.canvasHeight ?? 125,
            upscaleFactor: ts.upscaleFactor ?? cfg.upscaleFactor ?? 8,
            skipTransparent: ts.skipTransparent ?? false,
            manifest: ts.manifest ?? false
        }
    })
    const registryPath = cfg.registryPath ? path.resolve(configDir, cfg.registryPath) : null
    return { specs, registryPath }
}

async function inferDimsIfMissing(spec) {
    if (spec.cols && spec.rows) return spec
    const img = await loadImage(spec.source)
    if (!spec.cols) spec.cols = img.width / spec.tileSize
    if (!spec.rows) spec.rows = img.height / spec.tileSize
    if (!Number.isInteger(spec.cols) || !Number.isInteger(spec.rows)) {
        throw new Error(
            `Cannot infer grid: ${path.basename(spec.source)} is ${img.width}x${img.height} ` +
            `which is not a whole multiple of tileSize=${spec.tileSize}. Pass --cols/--rows.`
        )
    }
    return spec
}

async function main() {
    const { _: positional, opts } = parseArgs(process.argv.slice(2))

    if (opts.help || (positional.length === 0 && !opts.config)) {
        console.log(HELP)
        process.exit(opts.help ? 0 : 1)
    }

    let specs
    let registryPath = null

    if (opts.config) {
        const configPath = path.resolve(opts.config)
        const r = specsFromConfig(configPath)
        specs = r.specs
        registryPath = r.registryPath
    } else {
        specs = [specFromCli(opts, positional)]
        if (opts['ts-registry']) registryPath = path.resolve(opts['ts-registry'])
    }

    const results = []
    for (const spec of specs) {
        await inferDimsIfMissing(spec)
        const result = await convertTileset(spec)
        results.push(result)
        if (spec.manifest) emitManifest(spec, result)
        console.log(
            `[${spec.name}] wrote ${result.entries.length} tile(s)` +
            (result.skipped ? `, skipped ${result.skipped} transparent` : '') +
            ` -> ${path.relative(process.cwd(), spec.outputDir) || spec.outputDir}`
        )
    }

    if (registryPath) {
        emitTsRegistry(specs, results, registryPath)
        console.log(`Wrote registry ${path.relative(process.cwd(), registryPath) || registryPath}`)
    }
}

// Only run the CLI when this file is the process entry point. When the module
// is loaded via `import` (e.g. from the Electron GUI or another Node script),
// importers should be able to use the named exports without triggering main().
function isCliEntry() {
    if (!process.argv[1]) return false
    try {
        return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    } catch {
        return false
    }
}

if (isCliEntry()) {
    main().catch((err) => {
        console.error('iso-tile-converter:', err.message)
        process.exit(1)
    })
}
