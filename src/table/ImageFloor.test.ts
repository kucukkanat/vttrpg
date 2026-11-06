import { describe, expect, it, vi } from 'vitest'
import { LinearSRGBColorSpace, SRGBColorSpace, Texture } from 'three'
import type { AssetRef } from '@/core/assets'
import type { AssetHash } from '@/core/ids'
import { loadMapTexture, mapImageName, type MapTextureLoader } from './ImageFloor'

const asset: AssetRef = {
  sha256: 'a'.repeat(64) as AssetHash,
  kind: 'image',
  mime: 'image/png',
  size: 1039,
  name: 'checker.png',
  sources: [],
}

function fakeImage(width: number, height: number): Texture {
  const t = new Texture()
  t.image = { width, height }
  t.colorSpace = LinearSRGBColorSpace
  return t
}

describe('loadMapTexture', () => {
  it('resolves the asset to a URL, loads it and tags the texture sRGB with anisotropy', async () => {
    const resolve = vi.fn(async () => 'blob:http://localhost/abc')
    const loader: MapTextureLoader = { loadAsync: vi.fn(async () => fakeImage(1024, 768)) }
    const t = await loadMapTexture(resolve, asset, { loader, maxAnisotropy: 16 })
    expect(resolve).toHaveBeenCalledWith(asset)
    expect(loader.loadAsync).toHaveBeenCalledWith('blob:http://localhost/abc')
    expect(t.colorSpace).toBe(SRGBColorSpace)
    expect(t.anisotropy).toBe(8)
    expect(t.image).toEqual({ width: 1024, height: 768 })
  })

  it('keeps anisotropy within what the GPU offers', async () => {
    const loader: MapTextureLoader = { loadAsync: async () => fakeImage(4, 4) }
    expect((await loadMapTexture(async () => 'u', asset, { loader, maxAnisotropy: 2 })).anisotropy).toBe(2)
    expect((await loadMapTexture(async () => 'u', asset, { loader, maxAnisotropy: 0 })).anisotropy).toBe(1)
    expect((await loadMapTexture(async () => 'u', asset, { loader })).anisotropy).toBe(1)
  })

  it('names the file when the asset cannot be resolved', async () => {
    const loader: MapTextureLoader = { loadAsync: vi.fn() }
    await expect(
      loadMapTexture(async () => { throw new Error('could not resolve: no sources') }, asset, { loader }),
    ).rejects.toThrow('checker.png: could not resolve: no sources')
    expect(loader.loadAsync).not.toHaveBeenCalled()
  })

  it('names the file when the bytes are not an image (the image loader rejects with a bare event)', async () => {
    const loader: MapTextureLoader = { loadAsync: async () => { throw { type: 'error' } } }
    await expect(loadMapTexture(async () => 'blob:x', asset, { loader })).rejects.toThrow('checker.png: not a readable image')
  })

  it('retries from the resolver: a second call resolves and loads again', async () => {
    let attempt = 0
    const resolve = vi.fn(async () => { attempt++; if (attempt === 1) throw new Error('offline'); return 'blob:ok' })
    const loader: MapTextureLoader = { loadAsync: vi.fn(async () => fakeImage(8, 8)) }
    await expect(loadMapTexture(resolve, asset, { loader })).rejects.toThrow('offline')
    await expect(loadMapTexture(resolve, asset, { loader })).resolves.toBeInstanceOf(Texture)
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(loader.loadAsync).toHaveBeenCalledTimes(1)
  })
})

describe('mapImageName', () => {
  it('uses the file name, falling back to the hash prefix', () => {
    expect(mapImageName(asset)).toBe('checker.png')
    expect(mapImageName({ ...asset, name: undefined })).toBe('aaaaaaaaaaaa…')
  })
})
