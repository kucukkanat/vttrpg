import { describe, expect, it } from 'vitest'
import { cellKey, chunkOf, chunkOfKey, encodeTile, kitIndexFor, levelOfHeight, parseCellKey, parseChunkId, parseTile, type KitPiece } from './kits'
import { anchorFor, cellSlotFor, edgesOfArms, edgesOfEdgePiece, pieceCentre, turn, turnDir, turnedFootprint } from './kitGeometry'

describe('cell keys', () => {
  it('round-trips x, level, z and slot', () => {
    for (const c of [{ x: 0, level: 0, z: 0, slot: 'f' as const }, { x: -17, level: 3, z: 250, slot: 'w' as const }, { x: 8191, level: -4, z: -8191, slot: 'v' as const }]) {
      expect(parseCellKey(cellKey(c))).toEqual(c)
    }
  })
  it('refuses anything that is not one canonical key', () => {
    for (const bad of ['', '1,2,3', '1,2,3,x', '1,2,3,f,4', '01,0,0,f', '-0,0,0,f', '1.5,0,0,f', '0,40,0,f', '0,-5,0,f', '9000,0,0,f', ' 1,0,0,f', 7, null]) {
      expect(parseCellKey(bad), String(bad)).toBeNull()
    }
  })
})

describe('chunks', () => {
  it('are 16×16 columns, floored for negative cells', () => {
    expect(chunkOf(0, 0)).toBe('0,0')
    expect(chunkOf(15, 15)).toBe('0,0')
    expect(chunkOf(16, -1)).toBe('1,-1')
    expect(chunkOf(-16, -17)).toBe('-1,-2')
    expect(chunkOfKey('31,5,-1,n')).toBe('1,-1')
    expect(chunkOfKey('nope')).toBeNull()
    expect(parseChunkId('-3,4')).toEqual({ cx: -3, cz: 4 })
  })
})

describe('tile values', () => {
  it('round-trips and leaves the variant out when it is 0', () => {
    expect(encodeTile({ kit: 1, piece: 12, rot: 3, variant: 0 })).toBe('1:12:3')
    expect(encodeTile({ kit: 0, piece: 4, rot: 0, variant: 1 })).toBe('0:4:0:1')
    expect(parseTile('1:12:3')).toEqual({ kit: 1, piece: 12, rot: 3, variant: 0 })
    expect(parseTile('0:4:0:1')).toEqual({ kit: 0, piece: 4, rot: 0, variant: 1 })
  })
  it('refuses malformed values', () => {
    for (const bad of ['', '1:2', '1:2:4', '1:2:3:', '1:2:3:0', '01:2:3', '64:0:0', '0:4096:0', 'a:b:c', 5, undefined]) expect(parseTile(bad), String(bad)).toBeNull()
  })
})

describe('kit table', () => {
  it('gives built-in kits their own index and others the first free one', () => {
    expect(kitIndexFor([], 'kenney-town')).toEqual({ index: 1, added: true })
    expect(kitIndexFor([null, 'kenney-town'], 'kenney-town')).toEqual({ index: 1, added: false })
    expect(kitIndexFor(['kaykit-dungeon', 'kenney-town'], 'my-kit')).toEqual({ index: 2, added: true })
    // A built-in index already taken: the first free index after the built-ins.
    expect(kitIndexFor(['other'], 'kaykit-dungeon')).toEqual({ index: 2, added: true })
  })
})

describe('placement geometry', () => {
  const floor2x1 = { slot: 'floor', footprint: [2, 1] } as Pick<KitPiece, 'slot' | 'footprint'>
  const wall2 = { slot: 'wall', footprint: [2, 0] } as Pick<KitPiece, 'slot' | 'footprint'>
  const corner = { slot: 'corner', footprint: [0, 0] } as Pick<KitPiece, 'slot' | 'footprint'>

  it('turns like three.js: local +x goes to world -z after a quarter turn', () => {
    expect(turn([1, 0], 1)).toEqual([0, -1])
    expect(turn([0, 1], 1)).toEqual([1, 0])
    expect(turn([1, 2], 4)).toEqual([1, 2])
    expect(turnDir('E', 1)).toBe('N')
    expect(turnDir('S', 3)).toBe('W')
  })
  it('stores edge pieces under n for even turns and w for odd', () => {
    expect(cellSlotFor('wall', 0)).toBe('n')
    expect(cellSlotFor('door', 3)).toBe('w')
    expect(cellSlotFor('pillar', 1)).toBe('v')
    expect(cellSlotFor('roof', 0)).toBe('r')
  })
  it('centres pieces on their footprint, edge or vertex, and finds the anchor back', () => {
    expect(pieceCentre(floor2x1, { x: 3, z: 4 }, 0)).toEqual([3.5, 4])
    expect(turnedFootprint(floor2x1, 1)).toEqual([1, 2])
    expect(pieceCentre(floor2x1, { x: 3, z: 4 }, 1)).toEqual([3, 4.5])
    expect(pieceCentre(wall2, { x: 0, z: 0 }, 0)).toEqual([0.5, -0.5])
    expect(pieceCentre(wall2, { x: 0, z: 0 }, 1)).toEqual([-0.5, 0.5])
    expect(pieceCentre(corner, { x: 2, z: 2 }, 3)).toEqual([1.5, 1.5])
    for (const [p, rot] of [[floor2x1, 0], [floor2x1, 1], [wall2, 0], [wall2, 3], [corner, 2]] as const) {
      expect(anchorFor(p, pieceCentre(p, { x: -5, z: 7 }, rot), rot)).toEqual({ x: -5, z: 7 })
    }
  })
  it('lists the edges a wall or a join covers', () => {
    expect(edgesOfEdgePiece(wall2, { x: 1, z: 2 }, 2)).toEqual([{ x: 1, z: 2, side: 'n' }, { x: 2, z: 2, side: 'n' }])
    expect(edgesOfEdgePiece(wall2, { x: 1, z: 2 }, 1)).toEqual([{ x: 1, z: 2, side: 'w' }, { x: 1, z: 3, side: 'w' }])
    const arms = { arms: [{ dir: 'W' as const, length: 1 }, { dir: 'S' as const, length: 2 }] }
    expect(edgesOfArms(arms, { x: 0, z: 0 }, 0)).toEqual([{ x: -1, z: 0, side: 'n' }, { x: 0, z: 0, side: 'w' }, { x: 0, z: 1, side: 'w' }])
  })
  it('reads levels from heights with a quarter storey of slack', () => {
    expect(levelOfHeight(0, 0, 1.5)).toBe(0)
    expect(levelOfHeight(-0.5, 0, 1.5)).toBe(0)
    expect(levelOfHeight(1.5, 0, 1.5)).toBe(0)
    expect(levelOfHeight(3.12, 0, 1.5)).toBe(1)
    expect(levelOfHeight(6.4, 0.4, 1.5)).toBe(2)
  })
})
