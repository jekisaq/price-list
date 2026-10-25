import { randomUUID } from 'node:crypto'
import { productFields } from '../../shared/api.ts'
import { mapSourceRow } from '../../shared/mapping.ts'
import type {
  ImportedTable,
  ProcessRequest,
  ProcessResult,
} from '../../shared/api'

// Optional demo source for trying the workflow without a file.
export function demoTable(): ImportedTable {
  return {
    id: randomUUID(),
    name: 'Демонстрационная таблица',
    columns: ['Код товара', 'Название', 'Стоимость'],
    rowNumbers: [2, 3, 4],
    totalRows: 3,
    headerRow: 1,
    warnings: [],
    rows: [
      ['001', 'Блокнот', '120'],
      ['002', 'Ручка', '35'],
      ['003', 'Папка', '80'],
    ],
  }
}

export function processTable(
  table: ImportedTable,
  request: ProcessRequest,
): ProcessResult {
  const result: ProcessResult = { id: randomUUID(), products: [], errors: [] }
  const seen = new Set<string>()

  table.rows.forEach((row, index) => {
    const sourceRow = table.rowNumbers[index] ?? index + table.headerRow + 1
    const mapped = mapSourceRow(row, request.mapping)
    const sku = mapped.sku?.trim() ?? ''
    const name = mapped.name?.trim() ?? ''
    const rawPrice = mapped.price?.trim() ?? ''
    const price = Number(rawPrice.replace(',', '.'))

    if (!sku || !name || !rawPrice || !Number.isFinite(price) || price < 0) {
      result.errors.push(
        `Строка ${sourceRow}: проверьте артикул, название и цену.`,
      )
    } else if (seen.has(sku)) {
      result.errors.push(`Строка ${sourceRow}: повторяющийся артикул ${sku}.`)
    } else {
      seen.add(sku)
      result.products.push({
        sku,
        name,
        price: Math.round(price * (1 + request.markup / 100) * 100) / 100,
      })
    }
  })

  return result
}

export function toCsv(result: ProcessResult): string {
  const cell = (value: string) => {
    const safe = /^\s*[=+@-]/.test(value) ? `'${value}` : value
    return `"${safe.replaceAll('"', '""')}"`
  }
  return (
    '\uFEFF' +
    [
      productFields.map((field) => field.label),
      ...result.products.map((product) =>
        productFields.map(({ key }) =>
          key === 'price' ? product.price.toFixed(2) : product[key],
        ),
      ),
    ]
      .map((row) => row.map(cell).join(';'))
      .join('\r\n')
  )
}
