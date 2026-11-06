import { lazy, Suspense, type ComponentType } from 'react'

/** Dev stories live in their module folders (`src/<module>/devStory.tsx`); discovered at build time. */
const modules = import.meta.glob<{ default?: ComponentType; DevStory?: ComponentType }>('../../*/devStory.tsx')
const stories: Record<string, React.LazyExoticComponent<ComponentType>> = {}
for (const [file, load] of Object.entries(modules)) {
  const name = file.split('/').at(-2)!
  stories[name] = lazy(async () => {
    const m = await load()
    const C = m.default ?? m.DevStory
    if (!C) throw new Error(`${file} exports no story`)
    return { default: C }
  })
}

export function DevStories({ story }: { story: string }) {
  const Story = stories[story]
  if (!Story) return <div style={{ padding: 24 }}>Unknown story “{story}”. Known: {Object.keys(stories).join(', ') || 'none yet'}</div>
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading story…</div>}>
      <Story />
    </Suspense>
  )
}
