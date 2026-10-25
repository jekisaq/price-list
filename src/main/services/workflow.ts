import { randomUUID } from 'node:crypto'
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
    const sku = row[request.mapping.sku]?.trim() ?? ''
    const name = row[request.mapping.name]?.trim() ?? ''
    const rawPrice = row[request.mapping.price]?.trim() ?? ''
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
      ['Артикул', 'Наименование', 'Цена'],
      ...result.products.map((product) => [
        product.sku,
        product.name,
        product.price.toFixed(2),
      ]),
    ]
      .map((row) => row.map(cell).join(';'))
      .join('\r\n')
  )
}
