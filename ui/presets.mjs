/**
 * Output-size presets surfaced by the GUI. Each preset either pins exact
 * dimensions or derives them from the user's source tile size (factor-based).
 *
 * `canvasH` is the full PNG height — `diamondH` is how much of it the diamond
 * occupies. The remaining strip stays transparent so artists can paint cliff
 * thickness on top, which matches how Phaser/Godot iso assets are usually shipped.
 */

/** @typedef {{ id: string, label: string, group: string, diamondW: number, diamondH: number, canvasH: number, note?: string }} FixedPreset */
/** @typedef {{ id: string, label: string, group: string, factor: number, cliff?: number, note?: string }} SourcePreset */
/** @typedef {FixedPreset | SourcePreset} Preset */

/** @type {Preset[]} */
export const PRESETS = [
    // --- default --------------------------------------------------------
    {
        id: 'default-203',
        label: 'Default 203×101 (canvas 125)',
        group: 'Default',
        diamondW: 203, diamondH: 101, canvasH: 125,
        note: 'Tool default. Includes a 24px transparent strip for 3D thickness.'
    },

    // --- classic 2:1 isometric (no cliff strip) -------------------------
    {
        id: 'classic-32x16',
        label: 'Classic 32×16 (GBA-style)',
        group: 'Classic 2:1 (flat)',
        diamondW: 32, diamondH: 16, canvasH: 16
    },
    {
        id: 'classic-64x32',
        label: 'Classic 64×32 (SNES iso)',
        group: 'Classic 2:1 (flat)',
        diamondW: 64, diamondH: 32, canvasH: 32
    },
    {
        id: 'classic-96x48',
        label: 'Classic 96×48',
        group: 'Classic 2:1 (flat)',
        diamondW: 96, diamondH: 48, canvasH: 48
    },
    {
        id: 'classic-128x64',
        label: 'Classic 128×64 (HD iso)',
        group: 'Classic 2:1 (flat)',
        diamondW: 128, diamondH: 64, canvasH: 64
    },
    {
        id: 'classic-192x96',
        label: 'Classic 192×96',
        group: 'Classic 2:1 (flat)',
        diamondW: 192, diamondH: 96, canvasH: 96
    },
    {
        id: 'classic-256x128',
        label: 'Classic 256×128 (large HD)',
        group: 'Classic 2:1 (flat)',
        diamondW: 256, diamondH: 128, canvasH: 128
    },
    {
        id: 'classic-512x256',
        label: 'Classic 512×256 (extra-large)',
        group: 'Classic 2:1 (flat)',
        diamondW: 512, diamondH: 256, canvasH: 256
    },

    // --- Phaser / Godot friendly (with cliff strip = 50% diamond height) ----
    {
        id: 'cliff-32x16',
        label: 'Phaser/Godot 32×16 + cliff',
        group: 'Phaser / Godot (with cliff strip)',
        diamondW: 32, diamondH: 16, canvasH: 24
    },
    {
        id: 'cliff-64x32',
        label: 'Phaser/Godot 64×32 + cliff',
        group: 'Phaser / Godot (with cliff strip)',
        diamondW: 64, diamondH: 32, canvasH: 48
    },
    {
        id: 'cliff-96x48',
        label: 'Phaser/Godot 96×48 + cliff',
        group: 'Phaser / Godot (with cliff strip)',
        diamondW: 96, diamondH: 48, canvasH: 72
    },
    {
        id: 'cliff-128x64',
        label: 'Phaser/Godot 128×64 + cliff',
        group: 'Phaser / Godot (with cliff strip)',
        diamondW: 128, diamondH: 64, canvasH: 96
    },
    {
        id: 'cliff-192x96',
        label: 'Phaser/Godot 192×96 + cliff',
        group: 'Phaser / Godot (with cliff strip)',
        diamondW: 192, diamondH: 96, canvasH: 144
    },
    {
        id: 'cliff-256x128',
        label: 'Phaser/Godot 256×128 + cliff',
        group: 'Phaser / Godot (with cliff strip)',
        diamondW: 256, diamondH: 128, canvasH: 192
    },
    {
        id: 'cliff-512x256',
        label: 'Phaser/Godot 512×256 + cliff',
        group: 'Phaser / Godot (with cliff strip)',
        diamondW: 512, diamondH: 256, canvasH: 384
    },

    // --- source-derived (T = source tile size) --------------------------
    {
        id: 'src-2x',
        label: 'Source-matched 2× (2T × T, flat)',
        group: 'Source-matched',
        factor: 2, cliff: 0
    },
    {
        id: 'src-4x',
        label: 'Source-matched 4× (4T × 2T, flat)',
        group: 'Source-matched',
        factor: 4, cliff: 0
    },
    {
        id: 'src-4x-cliff',
        label: 'Source-matched 4× + cliff',
        group: 'Source-matched',
        factor: 4, cliff: 0.5
    },
    {
        id: 'src-8x',
        label: 'Source-matched 8× (8T × 4T, flat)',
        group: 'Source-matched',
        factor: 8, cliff: 0
    },
    {
        id: 'src-8x-cliff',
        label: 'Source-matched 8× + cliff',
        group: 'Source-matched',
        factor: 8, cliff: 0.5
    },
    {
        id: 'src-12x',
        label: 'Source-matched 12× (12T × 6T, flat)',
        group: 'Source-matched',
        factor: 12, cliff: 0
    },
    {
        id: 'src-16x',
        label: 'Source-matched 16× (16T × 8T, flat)',
        group: 'Source-matched',
        factor: 16, cliff: 0
    },
    {
        id: 'src-16x-cliff',
        label: 'Source-matched 16× + cliff',
        group: 'Source-matched',
        factor: 16, cliff: 0.5
    }
]

/**
 * Resolve a preset id + source tileSize into concrete diamond dimensions.
 * Returns null for unknown ids (caller should fall back to custom values).
 */
export function resolvePreset(id, tileSize) {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return null
    if ('diamondW' in p) {
        return { diamondW: p.diamondW, diamondH: p.diamondH, canvasH: p.canvasH }
    }
    const diamondW = tileSize * p.factor
    const diamondH = Math.round(diamondW / 2)
    const cliff = p.cliff ?? 0
    return {
        diamondW,
        diamondH,
        canvasH: diamondH + Math.round(diamondH * cliff)
    }
}
