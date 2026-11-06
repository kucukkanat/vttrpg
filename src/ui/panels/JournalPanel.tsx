/**
 * Journal: GM notes and handouts. Players see what is shared with them (pinned handouts first);
 * the GM writes, shares, pins and deletes. Bodies are Markdown rendered by src/ui/prep/markdown.
 */
import { useEffect, useMemo, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import type { Note } from '@/core/doc'
import type { AssetRef } from '@/core/assets'
import type { NoteId, PlayerPubkey } from '@/core/ids'
import { newId } from '@/core/ids'
import { renderMarkdown } from '../prep/markdown'
import { isUnread, loadRead, markRead } from '../prep/unread'

type Mode = { kind: 'list' } | { kind: 'read'; id: NoteId } | { kind: 'edit'; id: NoteId | null }

export function canSee(note: Note, pubkey: PlayerPubkey, isGm: boolean): boolean {
  if (isGm) return true
  if (note.sharedWith === 'all') return true
  return Array.isArray(note.sharedWith) && note.sharedWith.includes(pubkey)
}

/** Pinned handouts first, then most recently updated. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
}

export function JournalPanel({ controller }: { controller: GameController }) {
  const notes = useGame((s) => s.notes)
  const isGm = controller.connection.isGm
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [read, setRead] = useState(loadRead)

  const visible = useMemo(() => sortNotes(Object.values(notes).filter((n) => canSee(n, controller.pubkey, isGm))), [notes, controller.pubkey, isGm])
  const current = mode.kind === 'read' ? notes[mode.id] : undefined

  // A note deleted (or unshared) while open drops back to the list.
  useEffect(() => {
    if (mode.kind === 'read' && (!current || !canSee(current, controller.pubkey, isGm))) setMode({ kind: 'list' })
  }, [mode, current, controller.pubkey, isGm])
  useEffect(() => { if (current) setRead((m) => markRead(m, current)) }, [current])

  const save = (note: Note) => void controller.dispatch({ type: 'note.upsert', note })
  const share = (note: Note) => {
    const next: Note = note.sharedWith === 'gm' ? { ...note, sharedWith: 'all', updatedAt: Date.now() } : note
    if (next !== note) save(next)
    void controller.dispatch({ type: 'chat.say', text: `GM shared a handout: ${note.title || 'Untitled'}` })
  }

  if (mode.kind === 'edit') {
    const base = mode.id ? notes[mode.id] : undefined
    return (
      <div className="panel">
        <h3>Journal <button className="tiny" onClick={() => setMode(base ? { kind: 'read', id: base.id } : { kind: 'list' })}>Cancel</button></h3>
        <NoteEditor
          controller={controller}
          note={base}
          onSave={(n) => { save(n); setMode({ kind: 'read', id: n.id }) }}
          onCancel={() => setMode(base ? { kind: 'read', id: base.id } : { kind: 'list' })}
        />
      </div>
    )
  }

  if (mode.kind === 'read' && current) {
    return (
      <div className="panel">
        <h3>Journal <button className="tiny" onClick={() => setMode({ kind: 'list' })}>‹ All notes</button></h3>
        <NoteView
          controller={controller}
          note={current}
          isGm={isGm}
          onBack={() => setMode({ kind: 'list' })}
          onEdit={() => setMode({ kind: 'edit', id: current.id })}
          onPin={() => save({ ...current, pinned: !current.pinned, updatedAt: Date.now() })}
          onShare={() => share(current)}
          onDelete={() => { void controller.dispatch({ type: 'note.remove', note: current.id }); setMode({ kind: 'list' }) }}
        />
      </div>
    )
  }

  return (
    <div className="panel">
      <h3>Journal {isGm && <button onClick={() => setMode({ kind: 'edit', id: null })} aria-label="New note">+</button>}</h3>
      {visible.length === 0 && <p className="muted small">{isGm ? 'No notes yet. Tap + to write one.' : 'Nothing shared with you yet.'}</p>}
      <ul className="list">
        {visible.map((n) => (
          <li key={n.id} onClick={() => setMode({ kind: 'read', id: n.id })}>
            <span className="dot" style={{ background: isUnread(read, n) ? 'var(--accent)' : 'transparent', border: isUnread(read, n) ? 'none' : '1px solid var(--border)' }} aria-label={isUnread(read, n) ? 'unread' : undefined} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.pinned && '📌 '}{n.title || 'Untitled'}</span>
            {isGm && <span className="muted small">{shareLabel(n)}</span>}
            {n.image && <span className="muted small" aria-label="has image">🖼</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function shareLabel(n: Note): string {
  if (n.sharedWith === 'gm') return 'private'
  if (n.sharedWith === 'all') return 'everyone'
  return `${n.sharedWith.length} player${n.sharedWith.length === 1 ? '' : 's'}`
}

/** Object URL for an asset; released when the ref changes or the view unmounts. */
function useAssetUrl(controller: GameController, ref: AssetRef | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!ref) { setUrl(null); return }
    let alive = true
    controller.assets.resolve(ref).then((u) => { if (alive) setUrl(u) }, () => { if (alive) setUrl(null) })
    return () => { alive = false; controller.assets.release(ref) }
  }, [controller, ref])
  return url
}

function NoteView({ controller, note, isGm, onBack, onEdit, onPin, onShare, onDelete }: {
  controller: GameController; note: Note; isGm: boolean
  onBack(): void; onEdit(): void; onPin(): void; onShare(): void; onDelete(): void
}) {
  const url = useAssetUrl(controller, note.image)
  const [confirm, setConfirm] = useState(false)
  const html = useMemo(() => renderMarkdown(note.body), [note.body])
  useEffect(() => setConfirm(false), [note.id])
  return (
    <div>
      <div className="row" style={{ marginTop: 0, alignItems: 'center' }}>
        <button className="icon" aria-label="Back to notes" onClick={onBack}>‹</button>
        <strong style={{ flex: 1, fontSize: 'var(--fs-lg)' }}>{note.pinned && '📌 '}{note.title || 'Untitled'}</strong>
      </div>
      {isGm && <p className="muted small" style={{ margin: '0 0 var(--sp-2)' }}>{shareLabel(note)} · updated {new Date(note.updatedAt).toLocaleString()}</p>}
      {url && <img src={url} alt={note.image?.name ?? note.title} style={{ maxWidth: '100%', borderRadius: 'var(--r-sm)', display: 'block', marginBottom: 'var(--sp-2)' }} />}
      {/* Safe: renderMarkdown escapes every character of the source before adding its own tags. */}
      <div className="note-body" style={{ lineHeight: 1.45, overflowWrap: 'anywhere' }} dangerouslySetInnerHTML={{ __html: html }} />
      {isGm && (
        <div className="row">
          <button onClick={onEdit}>Edit</button>
          <button onClick={onPin} aria-pressed={!!note.pinned}>{note.pinned ? 'Unpin' : 'Pin'}</button>
          <button className="primary" onClick={onShare} title="Post a chat line so players notice">{note.sharedWith === 'gm' ? 'Share to everyone' : 'Announce'}</button>
          <span className="spacer" />
          {confirm
            ? <><button className="danger" onClick={onDelete}>Really delete</button><button onClick={() => setConfirm(false)}>Keep</button></>
            : <button className="danger" onClick={() => setConfirm(true)}>Delete</button>}
        </div>
      )}
    </div>
  )
}

type ShareMode = 'gm' | 'all' | 'players'

function NoteEditor({ controller, note, onSave, onCancel }: { controller: GameController; note: Note | undefined; onSave(n: Note): void; onCancel(): void }) {
  const presence = useGame((s) => s.presence)
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [image, setImage] = useState<AssetRef | undefined>(note?.image)
  const [pinned, setPinned] = useState(!!note?.pinned)
  const [shareMode, setShareMode] = useState<ShareMode>(note ? (note.sharedWith === 'gm' ? 'gm' : note.sharedWith === 'all' ? 'all' : 'players') : 'gm')
  const [players, setPlayers] = useState<PlayerPubkey[]>(Array.isArray(note?.sharedWith) ? note.sharedWith : [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = useAssetUrl(controller, image)

  const others = Object.values(presence).filter((p) => p.pubkey !== controller.pubkey && p.pubkey !== controller.connection.gm)
  const offline = players.filter((pk) => !presence[pk])

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError(null)
    try { setImage(await controller.assets.importFile(file)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const toggle = (pk: PlayerPubkey) => setPlayers((ps) => (ps.includes(pk) ? ps.filter((x) => x !== pk) : [...ps, pk]))
  const submit = () => {
    const now = Date.now()
    const sharedWith: Note['sharedWith'] = shareMode === 'gm' ? 'gm' : shareMode === 'all' ? 'all' : players
    onSave({ id: note?.id ?? newId<'NoteId'>(), title: title.trim() || 'Untitled', body, image, sharedWith, pinned, createdAt: note?.createdAt ?? now, updatedAt: now })
  }

  return (
    <div className="props" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Handout title" autoFocus={!note} /></label>
      <label>Body <span className="muted small">(Markdown: # heading, **bold**, *italic*, - list, [link](https://…))</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} style={{ minHeight: 140, resize: 'vertical' }} placeholder="Write the note…" />
      </label>
      <div>
        <span className="muted small">Image</span>
        {preview && <img src={preview} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 160, borderRadius: 'var(--r-sm)', margin: 'var(--sp-1) 0' }} />}
        <div className="row" style={{ marginTop: 'var(--sp-1)' }}>
          <label className="tiny-file" style={{ minHeight: 'var(--control)' }}>
            {busy ? 'Importing…' : image ? 'Replace image' : 'Add image'}
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { void pickImage(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {image && <button className="tiny" style={{ minHeight: 'var(--control)' }} onClick={() => setImage(undefined)}>Remove image</button>}
        </div>
        {error && <p className="error small">{error}</p>}
      </div>
      <label>Share with
        <select value={shareMode} onChange={(e) => setShareMode(e.target.value as ShareMode)}>
          <option value="gm">Only me (private)</option>
          <option value="all">Everyone</option>
          <option value="players">Chosen players</option>
        </select>
      </label>
      {shareMode === 'players' && (
        <div>
          {others.length === 0 && offline.length === 0 && <p className="muted small">No players present. They appear here once they join.</p>}
          {others.map((p) => (
            <label key={p.pubkey} className="check"><input type="checkbox" checked={players.includes(p.pubkey)} onChange={() => toggle(p.pubkey)} /> <span className="dot" style={{ background: p.color }} /> {p.name}</label>
          ))}
          {offline.map((pk) => (
            <label key={pk} className="check"><input type="checkbox" checked onChange={() => toggle(pk)} /> {pk.slice(0, 8)} <span className="muted small">(offline)</span></label>
          ))}
        </div>
      )}
      <label className="check"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin as handout (shows first)</label>
      <div className="row">
        <button className="primary" onClick={submit} disabled={busy}>{note ? 'Save' : 'Create'}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
