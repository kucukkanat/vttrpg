/**
 * The Edit pencil (editMode.ts): on the Library rail and in the Library dock's header. Pressed
 * means props, walls, doors and lights can be selected and moved.
 */
import { useEditMode } from './editMode'
import { Icon } from '../icons'

export function EditToggle({ className = '' }: { className?: string }) {
  const on = useEditMode((s) => s.on)
  const toggle = useEditMode((s) => s.toggle)
  return (
    <button type="button" className={`edit-toggle${on ? ' on' : ''} ${className}`.trim()} aria-pressed={on} onClick={toggle}
      aria-label={on ? 'Editing on: props, walls, doors and lights can be moved' : 'Editing off: props, walls, doors and lights stay put'}
      title={on ? 'Editing on: click to lock the props, walls, doors and lights again' : 'Editing off: click to select and move props, walls, doors and lights'}>
      <Icon name="pencil" size={16} />
    </button>
  )
}
