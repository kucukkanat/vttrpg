import { lazy, Suspense, type ComponentType } from 'react'

/** Dev stories live in their module folders (`src/<module>/devStory.tsx`); discovered at build time. */
const modules = import.meta.glob<{ default?: ComponentType; DevStory?: ComponentType }>('../../**/devStory.tsx')
const stories: Record<string, React.LazyExoticComponent<ComponentType>> = {}
for (const [file, load] of Object.entries(modules)) {
  const name = file.replace(/^(\.\.\/)+/, '').replace(/\/devStory\.tsx$/, '').replace(/\//g, '-')
  stories[name] = lazy(async () => {
    const m = await load()
    const C = m.default ?? m.DevStory
    if (!C) throw new Error(`${file} exports no story`)
    return { default: C }
  })
}

/** Short names for stories that live deeper in a module. */
const ALIASES: Record<string, string> = { 'props-bench': 'table-propsBench' }

export function DevStories({ story }: { story: string }) {
  // Anything after `?` is the story's own options (see e.g. table/propsBench).
  const name = story.split('?')[0] ?? story
  const Story = stories[ALIASES[name] ?? name]
  if (!Story) return <div style={{ padding: 24 }}>Unknown story “{story}”. Known: {Object.keys(stories).join(', ') || 'none yet'}</div>
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading story…</div>}>
      <Story />
    </Suspense>
  )
}
