import { beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRulesEngine } from './engine'
import type { LoadedPack } from './index'
import { SheetView } from './SheetView'
import { SEED_A, loadMausritter } from './test-helpers'

let pack: LoadedPack
beforeAll(async () => {
  pack = await loadMausritter()
})

describe('SheetView', () => {
  it('renders every section of the Mausritter sheet for a generated mouse', async () => {
    const character = await engine().generateCharacter(SEED_A, 'Pip')
    const html = renderToStaticMarkup(<SheetView schema={pack.sheet} character={character} onChange={() => {}} onRoll={() => {}} />)
    for (const section of pack.sheet.sections) expect(html).toContain(`<h3>${section.title}</h3>`)
    expect(html).toContain('value="Pip"')
    expect(html).toContain(String(character.data.background))
    expect(html).toContain('Main paw')
    expect(html).toContain('value="Torches"')
    expect(html).toMatch(/class="slot continuation[^"]*"|class="slot[^"]*filled"/)
    expect(html).toContain('>STR save</button>')
    expect((html.match(/class="slot[ "]/g) ?? []).length).toBe(10)
  })

  it('renders read-only numbers and scalar lists', () => {
    const html = renderToStaticMarkup(
      <SheetView
        schema={{
          sections: [
            { title: 'T', fields: [{ kind: 'number', bind: 'level', label: 'Level', readonly: true }] },
            { title: 'C', fields: [{ kind: 'list', bind: 'conditions', label: 'Conditions', item: [{ kind: 'text', bind: '.', label: 'Condition' }] }] },
          ],
        }}
        character={{ id: 'x' as never, name: 'X', data: { level: 3, conditions: ['hungry'] } }}
        onChange={() => {}}
        onRoll={() => {}}
      />,
    )
    expect(html).toContain('<div class="readonly">3</div>')
    expect(html).toContain('value="hungry"')
  })

  function engine() {
    return createRulesEngine(pack)
  }
})
