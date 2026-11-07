/**
 * The skill form: identity, costs, target shape, effect rows and the VFX timeline. Controlled by
 * the panel; every change goes through `onChange(nextForm)` and errors come back keyed by path
 * (see `validateForm`). Works in a narrow bottom sheet: one column, fields wrap, 44px targets.
 */
import type { ReactNode } from 'react'
import type { LoadedPack } from '@/rules'
import {
  EFFECT_KINDS,
  TARGET_KINDS,
  VFX_ANCHORS,
  VFX_PRESETS,
  emptyEffect,
  emptyVfx,
  slugify,
  type EffectForm,
  type EffectKind,
  type FormErrors,
  type SkillForm,
  type VfxAnchor,
  type VfxForm,
  type VfxPreset,
} from './model'
import { Chips, Field, ResourcePicker, RowCard, Select, Stepper, TextField, twoCol } from './fields'

const PRESET_HELP: Record<VfxPreset, string> = {
  hit: 'sparks burst at the anchor',
  projectile: 'bolt flies from → to, then bursts',
  ring: 'expanding ground ring',
  aura: 'particles orbit the anchor',
  beam: 'bright beam from → to',
  shake: 'camera shake',
  rain: 'local shower around the anchor',
  sound: 'play an audio asset',
}

const EFFECT_HELP: Record<EffectKind, string> = {
  roll: 'Roll once (or once per target when "vs" is set). Later rows read rolls.<label>.total, last.total, save.success.',
  damage: 'Per target: reduce a resource by the formula, floored at 0.',
  heal: 'Per target: raise a resource by the formula, capped at its max.',
  condition: 'Add or remove conditions on each target (or the caster when none).',
  move: 'Reported as a message; the table applies movement.',
  message: 'Chat line. {expr} placeholders are evaluated; mention target to emit one per target.',
}

function move<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (j < 0 || j >= list.length) return list
  const next = list.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'var(--sp-2)' }}>
        <h4 style={{ margin: 0, fontSize: 'var(--fs-sm)', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>{title}</h4>
        {action}
      </div>
      {children}
    </section>
  )
}

export interface SkillFormProps {
  form: SkillForm
  errors: FormErrors
  pack: LoadedPack | null
  /** Pack skill ids: saving under one of them overrides that pack skill. */
  packSkillIds: Set<string>
  /** Custom skill ids already in the game, minus the one being edited: saving replaces it. */
  customSkillIds: Set<string>
  onChange: (next: SkillForm) => void
}

export function SkillFormView({ form, errors, pack, packSkillIds, customSkillIds, onChange }: SkillFormProps) {
  const set = <K extends keyof SkillForm>(key: K, value: SkillForm[K]) => onChange({ ...form, [key]: value })
  const conditionIds = (pack?.conditions ?? []).map((c) => c.id)
  const conditionName = (id: string) => pack?.conditions.find((c) => c.id === id)?.name ?? id

  const setName = (name: string) => {
    const next = { ...form, name }
    if (form.idFollowsName) next.id = slugify(name)
    onChange(next)
  }
  const setId = (id: string) => onChange({ ...form, id, idFollowsName: id.trim() === '' })

  const setEffect = (i: number, e: EffectForm) => set('effects', form.effects.map((x, k) => (k === i ? e : x)))
  const setVfx = (i: number, c: VfxForm) => set('vfx', form.vfx.map((x, k) => (k === i ? c : x)))

  const id = form.id.trim()
  const idHint = id === '' ? undefined
    : packSkillIds.has(id) ? 'overrides the pack skill with this id'
    : customSkillIds.has(id) ? 'replaces the custom skill with this id'
    : form.idFollowsName ? 'follows the name until edited' : undefined

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <TextField label="Name" value={form.name} onChange={setName} error={errors.name} placeholder="Fireball" />
      <div style={twoCol}>
        <TextField label="Id" value={form.id} onChange={setId} error={errors.id} mono placeholder="fireball" hint={idHint} />
        <TextField label="Icon" value={form.icon} onChange={(v) => set('icon', v)} error={errors.icon} placeholder="🔥 or a name" />
      </div>
      <TextField label="Description" value={form.description} onChange={(v) => set('description', v)} error={errors.description} multiline placeholder="What it does, in the players' words." />

      <Section
        title="Cost"
        action={<button type="button" className="tiny" onClick={() => set('cost', [...form.cost, { resource: pack?.resources[0]?.id ?? '', amount: '1' }])}>+ Add cost</button>}
      >
        {form.cost.length === 0 && <p className="muted small" style={{ margin: 0 }}>Free to use.</p>}
        {form.cost.map((c, i) => (
          <RowCard key={i} title={`Cost ${i + 1}`} index={i} count={form.cost.length} onMove={(d) => set('cost', move(form.cost, i, d))} onDelete={() => set('cost', form.cost.filter((_, k) => k !== i))}>
            <div style={twoCol}>
              <ResourcePicker label="Resource" value={c.resource} pack={pack} error={errors[`cost.${i}.resource`]} onChange={(resource) => set('cost', form.cost.map((x, k) => (k === i ? { ...x, resource } : x)))} />
              <TextField label="Amount" value={c.amount} mono inputMode="numeric" error={errors[`cost.${i}.amount`]} hint="expression, e.g. 1 or level" onChange={(amount) => set('cost', form.cost.map((x, k) => (k === i ? { ...x, amount } : x)))} />
            </div>
          </RowCard>
        ))}
      </Section>

      <Section title="Target">
        <Select label="Shape" value={form.target.kind} options={TARGET_KINDS} onChange={(kind) => set('target', { ...form.target, kind })} />
        <div style={twoCol}>
          {form.target.kind !== 'self' && <Stepper label="Range" unit="cells" value={form.target.range} min={0} error={errors['target.range']} onChange={(range) => set('target', { ...form.target, range })} />}
          {form.target.kind === 'radius' && <Stepper label="Radius" unit="cells" value={form.target.radius} min={0} error={errors['target.radius']} onChange={(radius) => set('target', { ...form.target, radius })} />}
          {form.target.kind === 'cone' && <Stepper label="Angle" unit="°" value={form.target.angle} step={15} min={1} error={errors['target.angle']} onChange={(angle) => set('target', { ...form.target, angle })} />}
          {form.target.kind === 'line' && <Stepper label="Width" unit="cells" value={form.target.width} min={0} error={errors['target.width']} onChange={(width) => set('target', { ...form.target, width })} />}
        </div>
      </Section>

      <Section title="Effects" action={<AddMenu label="+ Add effect" options={EFFECT_KINDS} onPick={(k) => set('effects', [...form.effects, emptyEffect(k)])} />}>
        {form.effects.length === 0 && <p className="muted small" style={{ margin: 0 }}>No effects yet; the skill only plays its VFX.</p>}
        {form.effects.map((e, i) => (
          <RowCard key={i} title={<span>{i + 1}. {e.kind}</span>} index={i} count={form.effects.length} onMove={(d) => set('effects', move(form.effects, i, d))} onDelete={() => set('effects', form.effects.filter((_, k) => k !== i))}>
            <p className="muted small" style={{ margin: 0 }}>{EFFECT_HELP[e.kind]}</p>
            <EffectFields e={e} i={i} errors={errors} pack={pack} conditionIds={conditionIds} conditionName={conditionName} onChange={(next) => setEffect(i, next)} />
          </RowCard>
        ))}
      </Section>

      <Section title="VFX timeline" action={<AddMenu label="+ Add cue" options={VFX_PRESETS} onPick={(p) => set('vfx', [...form.vfx, emptyVfx(p)])} />}>
        {form.vfx.length === 0 && <p className="muted small" style={{ margin: 0 }}>No visuals.</p>}
        {form.vfx.map((c, i) => (
          <RowCard key={i} title={<span>{c.at || 0} ms · {c.preset}</span>} index={i} count={form.vfx.length} onMove={(d) => set('vfx', move(form.vfx, i, d))} onDelete={() => set('vfx', form.vfx.filter((_, k) => k !== i))}>
            <div style={twoCol}>
              <Select label="Preset" value={c.preset} options={VFX_PRESETS} onChange={(preset) => setVfx(i, { ...c, preset })} labelOf={(p) => `${p} — ${PRESET_HELP[p]}`} />
              <Stepper label="At" unit="ms" value={c.at} step={100} min={0} error={errors[`vfx.${i}.at`]} onChange={(at) => setVfx(i, { ...c, at })} />
            </div>
            <div style={twoCol}>
              <AnchorSelect label="From" value={c.from} onChange={(from) => setVfx(i, { ...c, from })} />
              <AnchorSelect label="To" value={c.to} onChange={(to) => setVfx(i, { ...c, to })} />
            </div>
            <div style={twoCol}>
              <Field label="Colour" error={errors[`vfx.${i}.color`]}>
                <div style={{ display: 'grid', gridTemplateColumns: 'var(--control) 1fr', gap: 4 }}>
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#ffffff'} onChange={(e) => setVfx(i, { ...c, color: e.target.value })} aria-label="Pick colour" style={{ padding: 2, width: 'var(--control)' }} />
                  <input type="text" value={c.color} placeholder="preset default" onChange={(e) => setVfx(i, { ...c, color: e.target.value })} autoCapitalize="off" spellCheck={false} />
                </div>
              </Field>
              <Stepper label="Duration" unit="ms" value={c.duration} step={100} min={0} error={errors[`vfx.${i}.duration`]} onChange={(duration) => setVfx(i, { ...c, duration })} />
            </div>
            {c.preset === 'sound' && <TextField label="Asset" value={c.asset} onChange={(asset) => setVfx(i, { ...c, asset })} error={errors[`vfx.${i}.asset`]} mono placeholder="sha256 or library name" />}
          </RowCard>
        ))}
      </Section>
    </div>
  )
}

function AnchorSelect({ label, value, onChange }: { label: string; value: VfxAnchor | ''; onChange: (v: VfxAnchor | '') => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as VfxAnchor | '')}>
        <option value="">preset default</option>
        {VFX_ANCHORS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
    </Field>
  )
}

/** A select that acts as an "add" button: picking an option fires once and resets. */
function AddMenu<T extends string>({ label, options, onPick }: { label: string; options: readonly T[]; onPick: (v: T) => void }) {
  return (
    <select
      value=""
      onChange={(e) => { if (e.target.value) onPick(e.target.value as T) }}
      aria-label={label}
      style={{ width: 'auto', minWidth: 0, maxWidth: '100%', background: 'var(--btn)', fontSize: 'var(--fs-sm)' }}
    >
      <option value="">{label}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function EffectFields({ e, i, errors, pack, conditionIds, conditionName, onChange }: {
  e: EffectForm
  i: number
  errors: FormErrors
  pack: LoadedPack | null
  conditionIds: string[]
  conditionName: (id: string) => string
  onChange: (next: EffectForm) => void
}) {
  const k = `effects.${i}`
  switch (e.kind) {
    case 'roll':
      return (
        <>
          <TextField label="Formula" value={e.formula} mono error={errors[`${k}.formula`]} placeholder="d20 or 2d6 + str" onChange={(formula) => onChange({ ...e, formula })} />
          <div style={twoCol}>
            <TextField label="Vs (optional)" value={e.vs} mono error={errors[`${k}.vs`]} placeholder="target.dex" hint="per-target save when set" onChange={(vs) => onChange({ ...e, vs })} />
            <TextField label="Label" value={e.label} error={errors[`${k}.label`]} placeholder="power" hint="read later as rolls.<label>" onChange={(label) => onChange({ ...e, label })} />
          </div>
        </>
      )
    case 'damage':
    case 'heal':
      return (
        <div style={twoCol}>
          <TextField label="Formula" value={e.formula} mono error={errors[`${k}.formula`]} placeholder="rolls.power.total" onChange={(formula) => onChange({ ...e, formula })} />
          <ResourcePicker label="Resource" value={e.resource} pack={pack} error={errors[`${k}.resource`]} onChange={(resource) => onChange({ ...e, resource })} />
        </div>
      )
    case 'condition':
      return (
        <>
          <Field label="Add" error={errors[`${k}.add`]}>
            <Chips options={conditionIds} value={e.add} labelOf={conditionName} onChange={(add) => onChange({ ...e, add })} />
          </Field>
          <Field label="Remove" error={errors[`${k}.remove`]}>
            <Chips options={conditionIds} value={e.remove} labelOf={conditionName} onChange={(remove) => onChange({ ...e, remove })} />
          </Field>
        </>
      )
    case 'move':
      return <Stepper label="Cells" value={e.cells} error={errors[`${k}.cells`]} onChange={(cells) => onChange({ ...e, cells })} />
    case 'message':
      return <TextField label="Text" value={e.text} multiline error={errors[`${k}.text`]} hint="{source.name}, {target.name}, {rolls.power.total}, {save.success ? 'a' : 'b'}" onChange={(text) => onChange({ ...e, text })} />
  }
}
