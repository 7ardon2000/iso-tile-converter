# iso-tile-converter

Convert square pixel-art tilemaps (top-down view) into isometric diamond floor-tile PNGs. Drop in any square-tile source, get back a folder of crisply-skewed diamond tiles ready for a 2:1 isometric game.

Built for pixel-art workflows — the converter upscales source tiles with nearest-neighbor before applying the diamond affine, so output edges stay sharp instead of fringing.

## What it does

Given a source like this (8 × 4 grid of 16×16 tiles):

![source tilemap, top-down view, 128x64](examples/Floor%20tilemap.png)

It produces one isometric diamond PNG per source tile:

```
out/floorTilemap1/
├── tile_0_0.png    (203×125, transparent background)
├── tile_0_1.png
├── ...
└── tile_3_7.png
```
<img width="724" height="365" alt="image" src="https://github.com/user-attachments/assets/0b1fbd72-563e-4152-8c83-74b33377e8e0" />

Output dimensions, diamond shape, upscale factor, and (optional) bundler-friendly TypeScript registry are all configurable.

## Download

Prebuilt portable Windows .exe (no install, just double-click) is published on the [Releases page](https://github.com/TajRizek/iso-tile-converter/releases). Pick the latest `iso-tile-converter-<version>-portable.exe`.

If you want the CLI or to hack on the code, install from source instead — see below.

## Install

```bash
npm install
```

Requires Node 18+ and `@napi-rs/canvas` (installed automatically — ships prebuilt binaries, no Python / node-gyp).

## Quick start

### Desktop UI (Electron)

For a point-and-click flow:

```bash
npm install
npm run ui
```

This opens a small Electron window where you can pick a tilemap, set the tile size, choose an output-size preset (classic 2:1 — 64×32, 128×64, 256×128; Phaser/Godot variants with a cliff strip; source-matched ratios; or fully custom), and convert with a live progress bar. The UI calls straight into [bin/iso-tile-converter.mjs](bin/iso-tile-converter.mjs) — no logic is duplicated, so the CLI remains the source of truth.

UI sources live in [ui/](ui/): Electron main + preload at the top level, renderer (HTML/CSS/JS) under `ui/renderer/`, and the preset catalog in [ui/presets.mjs](ui/presets.mjs).

### CLI

```bash
# One-off conversion via CLI
node bin/iso-tile-converter.mjs "examples/Floor tilemap.png" \
    --tile-size 16 \
    --skip-transparent \
    --manifest \
    --out out/floorTilemap1

# Or run the bundled example via npm script
npm run example:cli
```

Or use a config file when you have many tilemaps:

```bash
node bin/iso-tile-converter.mjs --config examples/tilesets.config.json
# shortcut: npm run example
```

After install you can also use it as a binary:

```bash
npx iso-tile-converter floor.png --tile-size 16 --skip-transparent
```

## CLI options

```
USAGE
  iso-tile-converter <source.png> [options]
  iso-tile-converter --config <path/to/tilesets.json>

OPTIONS
  --tile-size <px>          Source tile size in pixels (square). Default: 16
  --cols <n>                Source grid columns. Default: inferred (width / tile-size)
  --rows <n>                Source grid rows. Default: inferred (height / tile-size)
  --out <dir>               Output directory. Default: ./out/<source-basename>
  --name <s>                Tileset name. Default: source basename
  --prefix <s>              Texture-key prefix. Default: <name>
  --diamond-width <px>      Output diamond width. Default: 203
  --diamond-height <px>     Output diamond height. Default: 101
  --canvas-height <px>      Output PNG height (>= diamond-height; extra is transparent). Default: 125
  --upscale <n>             Nearest-neighbor upscale factor before affine. Default: 8
  --skip-transparent        Skip fully-transparent source tiles
  --manifest                Also emit <out>/manifest.json describing every tile
  --ts-registry <path>      Also emit a TypeScript static-import registry at <path>
  --help, -h                Show help and exit
```

## Config file

Pass `--config path/to/tilesets.json` to batch-convert many tilemaps in one run. The config has a top-level `diamond` / `upscaleFactor` / optional `registryPath`, plus a `tilesets` array where each entry can override per-tileset:

```json
{
    "diamond": { "width": 203, "height": 101, "canvasHeight": 125 },
    "upscaleFactor": 8,
    "registryPath": "out/iso-tilesets.gen.ts",
    "tilesets": [
        {
            "name": "floorTilemap1",
            "source": "Floor tilemap.png",
            "tileSize": 16,
            "cols": 8,
            "rows": 4,
            "outputDir": "out/floorTilemap1",
            "textureKeyPrefix": "isoFloorTilemap1",
            "skipTransparent": true,
            "manifest": true
        }
    ]
}
```

All `source` and `outputDir` paths in the config are resolved relative to the config file's directory (not CWD), so configs are portable.

A worked example lives in [`examples/tilesets.config.json`](examples/tilesets.config.json).

## Output

### PNGs

For every source tile that wasn't skipped, the tool writes `tile_<row>_<col>.png` to the tileset's `outputDir`. Each PNG is `diamond-width × canvas-height` pixels (default 203×125) with a transparent background. The diamond itself occupies the top `diamond-height` pixels; the rest of the canvas stays transparent so output dimensions match common floor-tile formats that include 3D thickness.

### Manifest (optional, `--manifest` or per-tileset `"manifest": true`)

`manifest.json` in each output dir describes every tile:

```json
{
    "name": "floorTilemap1",
    "textureKeyPrefix": "isoFloorTilemap1",
    "tileSize": 16,
    "cols": 8,
    "rows": 4,
    "diamond": { "width": 203, "height": 101, "canvasHeight": 125 },
    "tiles": [
        { "key": "isoFloorTilemap1_0_0", "file": "tile_0_0.png", "row": 0, "col": 0 }
    ]
}
```

Use this to drive runtime loaders that scan the output directory.

### TypeScript registry (optional, `--ts-registry <path>` or top-level `registryPath`)

For bundler projects (Parcel, webpack, Vite, esbuild) that resolve image imports at build time, the tool can emit a `.ts` module with static imports and a typed registry:

```ts
import floorTilemap1_0_0 from '../out/floorTilemap1/tile_0_0.png'
// ...

export interface IsoTilesetEntry { key: string; url: string; col: number; row: number }
export interface IsoTilesetGroup {
    name: string
    cols: number
    rows: number
    tileSize: number
    textures: IsoTilesetEntry[]
}

export const ISO_TILESETS: IsoTilesetGroup[] = [
    {
        name: 'floorTilemap1',
        cols: 8, rows: 4, tileSize: 16,
        textures: [
            { key: 'isoFloorTilemap1_0_0', url: floorTilemap1_0_0, col: 0, row: 0 }
        ]
    }
]
```

Import this from your game and loop over `ISO_TILESETS` to register textures — see [Using with Phaser](#using-with-phaser) below.

## Programmatic API

The tool exports its core functions for use from other Node scripts:

```js
import { convertTileset, emitManifest, emitTsRegistry } from 'iso-tile-converter'

const spec = {
    source: 'floor.png',
    name: 'floor',
    tileSize: 16,
    cols: 8,
    rows: 4,
    outputDir: 'out/floor',
    textureKeyPrefix: 'floor',
    diamondWidth: 203,
    diamondHeight: 101,
    canvasHeight: 125,
    upscaleFactor: 8,
    skipTransparent: true
}

const result = await convertTileset(spec)
emitManifest(spec, result)
console.log(`wrote ${result.entries.length} tiles, skipped ${result.skipped}`)
```

## How the transform works

Each pixel `(x, y)` in a `T × T` source tile is projected into a diamond of width `W` and height `H` via this affine:

```
out = M · (x, y) + (W/2, 0)

M = [[ W/(2T), -W/(2T) ],
     [ H/(2T),  H/(2T) ]]
```

Source corners map to the four diamond corners:

| Source     | Output         | Diamond corner |
|------------|----------------|----------------|
| `(0, 0)`   | `(W/2, 0)`     | top |
| `(T, 0)`   | `(W,   H/2)`   | right |
| `(T, T)`   | `(W/2, H)`     | bottom |
| `(0, T)`   | `(0,   H/2)`   | left |

With the default `W=203, H=101` the output diamond has the canonical 2:1 isometric ratio. The output canvas is taller than the diamond by default (`canvas-height=125`) — the extra 24 px at the bottom stays transparent so generated tiles drop into game engines whose tile assets already include 3D cliff thickness.

### Pixel-art crispness

Drawing a tiny 16×16 source into a 203×125 canvas under an affine transform fringes the diamond edges, because the affine has to interpolate sub-pixel sample positions. The fix is to upscale the source first with nearest-neighbor (default 8× → 128×128), then apply the affine. Each source pixel becomes a 128×128 block which the affine slices into clean parallelogram-shaped runs — no fringing, no anti-aliasing artifacts.

`imageSmoothingEnabled = false` is set on every canvas context throughout.

## Using with Phaser

The tool is engine-agnostic — it just writes PNGs. To wire the output into a Phaser project that uses Parcel/webpack/Vite, emit a TS registry, then in your loading scene:

```ts
// LoadingScene.ts
import { ISO_TILESETS } from './generated/iso-tilesets.gen'

preload(): void {
    for (const group of ISO_TILESETS) {
        for (const tex of group.textures) {
            this.load.image(tex.key, tex.url)
        }
    }
}
```

For an isometric floor at grid `(gx, gy)`, place a sprite with origin `(0.5, 0.02)` so the diamond's top vertex sits at the grid cell's anchor:

```ts
const key = `isoFloorTilemap1_${row}_${col}`
const tile = this.add.image(screenX, screenY, key)
tile.setOrigin(0.5, 0.02)
tile.setDepth(screenY - 10000)  // keep floors below entities
```

For Phaser projects without a bundler, load the PNGs directly by URL — the manifest's `file` field tells you each filename.

## Limitations and notes

- **Square source tiles only.** Source must be a regular grid of `tileSize × tileSize` cells, no margins, no padding between tiles.
- **Flat diamonds.** The tool doesn't synthesize 3D cliff thickness — output is the diamond top face only. If your game needs the cliff effect, paint it on by hand in the bottom transparent strip of the canvas, or post-process the PNGs.
- **Whole-tile transparency only.** `--skip-transparent` skips tiles where every alpha pixel is 0. A tile with even one non-transparent pixel is kept.
- **`@napi-rs/canvas` platform support.** Prebuilt binaries cover x64/arm64 Windows, macOS, and Linux. Exotic platforms may need to swap to [`sharp`](https://sharp.pixelplumbing.com/) — the affine API differs but the math is the same.
- **OneDrive / Dropbox on Windows.** Sync clients sometimes hold output files open; the tool retries `EBUSY` / `EPERM` once before giving up. Pause sync if writes still fail.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `Source is AxB, expected CxD` | Source PNG dimensions don't match `cols × tileSize` by `rows × tileSize`. Recrop or fix flags. |
| Output looks blurry / fringed | Source isn't true pixel art (has anti-aliased edges), or `--upscale` is too low. Try `--upscale 16`. |
| All tiles transparent | Source file failed to decode. Confirm it's a valid PNG. |
| Registry imports break the bundler | Make sure the `.ts` registry's relative paths still resolve — moving the registry file requires regenerating. |

## Development

```bash
npm install
npm run example          # runs the config-file example
npm run example:cli      # runs the same conversion via CLI flags
```

There are no tests yet. Contributions welcome — open an issue first if you're adding non-trivial features.

## License

MIT — see [LICENSE](LICENSE).
