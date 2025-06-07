export type SortArg = string | string[] | undefined

import type { FlattenedField } from 'payload'

function getByPath(doc: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((val, segment) => {
    if (val === undefined || val === null) {
      return undefined
    }
    return (val as Record<string, unknown>)[segment]
  }, doc)
}

export function manualSort({
  docs,
  fields,
  sort,
}: {
  docs: Record<string, unknown>[]
  fields: FlattenedField[]
  sort: SortArg
}): void {
  if (!sort) {return}

  const fieldMap = new Map<string, string>()
  for (const field of fields) {
    if ('virtual' in field && typeof field.virtual === 'string') {
      fieldMap.set(field.virtual, field.name)
    }
  }

  const sortArray = Array.isArray(sort) ? sort : [sort]
  const sortItems = sortArray.map((item) => {
    let direction: 'asc' | 'desc' = 'asc'
    let prop = item
    if (item.startsWith('-')) {
      direction = 'desc'
      prop = item.substring(1)
    }
    const path = fieldMap.get(prop) || prop
    return { direction, path }
  })

  docs.sort((a, b) => {
    for (const { direction, path } of sortItems) {
      const av = getByPath(a, path) as number | string
      const bv = getByPath(b, path) as number | string
      if (av === bv) {continue}
      if (av === undefined || av === null) {return direction === 'asc' ? -1 : 1}
      if (bv === undefined || bv === null) {return direction === 'asc' ? 1 : -1}
      if (av > bv) {return direction === 'asc' ? 1 : -1}
      if (av < bv) {return direction === 'asc' ? -1 : 1}
    }
    return 0
  })
}
