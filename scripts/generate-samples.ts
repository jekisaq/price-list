import { mkdir, open } from 'node:fs/promises'
import { resolve } from 'node:path'
import ExcelJS from 'exceljs'

await mkdir(resolve('samples/xlsx'), { recursive: true })
await mkdir(resolve('samples/generated'), { recursive: true })
const headers = ['Артикул', 'Наименование', 'Цена']
const cases: Record<string, (string | number)[][]> = {
  'supplier-basic': [
    ['000001', 'Блокнот А5', 120],
    ['000002', 'Ручка синяя', 35.5],
    ['Я-003', 'Папка «Документы»', 149.9],
  ],
  'supplier-invalid': [
    ['001', 'Первый товар', 10],
    ['001', 'Повторный артикул', 20],
    ['', 'Нет артикула', 30],
    ['004', '', 40],
    ['005', 'Нет цены', ''],
    ['006', 'Неверная цена', 'не число'],
    ['007', 'Отрицательная цена', -1],
  ],
  'supplier-duplicates': [
    ['001', 'Первая поставка', 10],
    ['001', 'Последняя поставка', 20],
    ['002', 'Другой товар', 30],
  ],
}
for (const [name, rows] of Object.entries(cases)) {
  const book = new ExcelJS.Workbook()
  // Fixed metadata makes fixture regeneration predictable.
  book.created = new Date('2026-01-01T00:00:00Z')
  book.modified = book.created
  const sheet = book.addWorksheet('Товары')
  sheet.addRow(headers)
  sheet.addRows(rows)
  sheet.getColumn(1).numFmt = '@'
  sheet.getColumn(3).numFmt = '0.00'
  sheet.columns.forEach((column) => {
    column.width = 28
  })
  await book.xlsx.writeFile(resolve('samples/xlsx', `${name}.xlsx`))
}

for (const count of [100000, 400000]) {
  const file = await open(
    resolve('samples/generated', `prices-${count}.csv`),
    'w',
  )
  try {
    await file.writeFile('\uFEFF' + headers.join(',') + '\r\n')
    for (let offset = 0; offset < count; offset += 1000) {
      await file.writeFile(
        Array.from(
          { length: Math.min(1000, count - offset) },
          (_, index) =>
            `${String(offset + index + 1).padStart(8, '0')},Товар ${offset + index + 1},10.25`,
        ).join('\r\n') + '\r\n',
      )
    }
  } finally {
    await file.close()
  }
}
const book = new ExcelJS.stream.xlsx.WorkbookWriter({
  filename: resolve('samples/generated/prices-25000.xlsx'),
  useStyles: true,
  useSharedStrings: false,
})
const sheet = book.addWorksheet('Товары')
sheet.addRow(headers).commit()
sheet.getColumn(1).numFmt = '@'
sheet.getColumn(3).numFmt = '0.00'
for (let index = 1; index <= 25000; index++) {
  sheet
    .addRow([String(index).padStart(8, '0'), `Товар ${index}`, 10.25])
    .commit()
}
await book.commit()
console.log(
  'Samples: samples/xlsx/ and samples/generated/ (CSV 100k/400k, XLSX 25k).',
)
