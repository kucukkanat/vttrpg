/** Picks the weather system for a scene's `weather` setting. Remounts when the kind changes. */
import { Embers } from './Embers'
import { Fog } from './Fog'
import { Rain } from './Rain'
import { Snow } from './Snow'
import type { WeatherBounds } from './bounds'

/** Weather presets a scene can enable (`scene.weather`). */
export type WeatherKind = 'none' | 'rain' | 'snow' | 'fog' | 'embers'

export interface WeatherLayerProps {
  kind: WeatherKind
  /** Volume the weather fills; the scene's bounds with some headroom. */
  bounds: WeatherBounds
  /** 0..1 particle budget multiplier (lower on weak devices). */
  density?: number
}

export function WeatherLayer({ kind, bounds, density }: WeatherLayerProps) {
  switch (kind) {
    case 'rain': return <Rain key="rain" bounds={bounds} density={density} />
    case 'snow': return <Snow key="snow" bounds={bounds} density={density} />
    case 'embers': return <Embers key="embers" bounds={bounds} density={density} />
    case 'fog': return <Fog key="fog" bounds={bounds} density={density} />
    default: return null
  }
}
