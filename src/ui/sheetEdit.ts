/** Applying `SheetView` edits (`onChange(path, value)`) to a character's data without mutating it. */

/** Copy of `obj` with the dotted `path` set; arrays on the way stay arrays (list fields bind `list.2.name`). */
export function setDataPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split('.')
  const next = rest.length ? setDataPath(((obj[head] as Record<string, unknown>) ?? {}), rest.join('.'), value) : value
  if (Array.isArray(obj)) {
    const copy = obj.slice()
    copy[Number(head)] = next
    return copy as unknown as Record<string, unknown>
  }
  return { ...obj, [head]: next }
}
