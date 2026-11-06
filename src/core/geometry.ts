export interface Vec3 { x: number; y: number; z: number }
export interface Vec2 { x: number; y: number }

/** Grid cell coordinates. For hex grids these are axial (q, r). */
export interface Cell { q: number; r: number }

export type GridType = 'square' | 'hex' | 'none'

export interface GridSpec {
  type: GridType
  /** World units per cell (meters). */
  cellSize: number
  /** World-space origin of cell (0,0). */
  origin: Vec3
}

export type TargetShape =
  | { kind: 'self' }
  | { kind: 'single'; range: number }
  | { kind: 'radius'; range: number; radius: number }
  | { kind: 'cone'; range: number; angle: number }
  | { kind: 'line'; range: number; width: number }
