/**
 * Icons only the library uses, drawn like `ui/icons.tsx` (24 grid, the shared stroke) but kept
 * here so they load with the library instead of with every page.
 */
import { ICON_STROKE } from '../icons'

const PATHS = {
  /** A card's menu: three dots. */
  more: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  /** Favourite: a five-pointed star. */
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />,
  /** Eyedropper: pick a model up from the board. */
  dropper: <><path d="M14.5 4.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L17 12l-5-5 2.5-2.5z" /><path d="M12.5 7.5 5 15v4h4l7.5-7.5" /></>,
}

export function LibIcon({ name, size = 20 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg className="icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  )
}
