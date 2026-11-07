/** Runs the game audio hook for the live game and offers the one-time unlock tap iOS needs. */
import { useMemo } from 'react'
import { sharedAudioEngine, useAudioUnlock, useGameAudio } from '@/audio'
import { useSession } from './session'
import { Icon } from '@/ui/icons'

export function AudioBridge() {
  const { controller } = useSession()
  const engine = useMemo(() => (controller ? sharedAudioEngine({ resolve: (ref) => controller.assets.resolve(ref) }) : null), [controller])
  useGameAudio(engine)
  const { unlocked, unlock } = useAudioUnlock(engine)
  if (!engine || unlocked) return null
  return (
    <button className="audio-unlock" onClick={() => void unlock()} aria-label="Enable sound">
      <Icon name="sound" size={18} /> Tap to enable sound
    </button>
  )
}
