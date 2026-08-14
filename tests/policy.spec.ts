/**
 * Direct verification of the three-tier image-format policy, independent of the
 * existing suite. Encodes the policy table the project documents:
 *
 *   Tier 1 原生直发 natively        PNG/JPEG/GIF/WebP/BMP   → send bytes unchanged
 *   Tier 2 自动转码 transcodable    SVG/TIFF/HEIC/PSD/ICO/EXR/JP2/JXL/AVIF → magick→PNG+缩图
 *   Tier 3 明确拒绝 reject          other / missing magick  → "ImageMagick" error
 *
 * @module policy.spec
 */
import { describe, expect, it } from 'vitest'
import { isTranscodable, TRANSCODABLE_EXT } from '../src/transcode.ts'
import { guessMime } from '../src/vision.ts'

/** Tier 1: the exact native formats, all of which must map to a concrete MIME. */
const NATIVE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }

/** Tier 2: the exact transcodable formats the policy lists (plus documented alternates). */
const TRANSCODABLE = ['svg', 'tiff', 'heic', 'psd', 'ico', 'exr', 'jp2', 'jxl', 'avif']

describe('three-tier format policy classification', () => {
  it('Tier-1 native formats are never transcodable and map to a MIME', () => {
    for (const ext of Object.keys(NATIVE)) {
      expect(isTranscodable(`x.${ext}`), `Tier-1 ${ext} should not route to transcode`).toBe(false)
      expect(guessMime(`x.${ext}`), `Tier-1 ${ext} should be native`).toBe(NATIVE[ext])
    }
  })

  it('each Tier-1 native extension must appear in exactly one tier (never both native+transcode)', () => {
    for (const ext of Object.keys(NATIVE)) {
      const native = guessMime(`x.${ext}`) !== undefined
      const transcodable = TRANSCODABLE_EXT.has(`.${ext}`)
      expect(native).toBe(true)
      expect(transcodable).toBe(false)
    }
  })

  it('Tier-2 transcodable formats are transcodable and never native', () => {
    for (const ext of TRANSCODABLE) {
      expect(isTranscodable(`x.${ext}`), `Tier-2 ${ext} should route to transcode`).toBe(true)
      expect(guessMime(`x.${ext}`), `Tier-2 ${ext} must not be treated as native`).toBeUndefined()
    }
  })

  it('case-insensitivity holds for every tier', () => {
    expect(guessMime('a.JPEG')).toBe('image/jpeg')
    expect(guessMime('b.WebP')).toBe('image/webp')
    expect(isTranscodable('C.SVG')).toBe(true)
    expect(isTranscodable('D.TIFF')).toBe(true)
  })

  it('every documented Tier-2 form is present in TRANSCODABLE_EXT (spec completeness)', () => {
    for (const ext of TRANSCODABLE) {
      expect([...TRANSCODABLE_EXT]).toContain(`.${ext}`)
    }
  })

  it('Tier-3: any other extension is neither native nor transcodable (→ will be rejected)', () => {
    for (const ext of ['txt', 'pdf', 'zip', 'mov', 'mp4', 'exe', 'html']) {
      expect(guessMime(`x.${ext}`)).toBeUndefined()
      expect(isTranscodable(`x.${ext}`)).toBe(false)
    }
  })

  it('Tier-3: a path with no extension is neither native nor transcodable', () => {
    expect(guessMime('no-extension')).toBeUndefined()
    expect(isTranscodable('no-extension')).toBe(false)
  })
})
