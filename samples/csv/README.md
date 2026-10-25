# CSV samples

Fictional supplier data for developing and testing the price-list importer.
All prices are in RUB; no markup has been applied. Files use UTF-8 without BOM.
Headers are on the first record. Keep SKU fields as text to preserve leading zeros.

| File | Products | Separator | Decimal separator | Purpose |
| --- | ---: | --- | --- | --- |
| supplier-basic.csv | 10 | Comma | Dot | Normal import with Russian headers and leading-zero SKUs |
| supplier-semicolon.csv | 8 | Semicolon | Comma | Russian number format and alternative headers |
| supplier-reordered.csv | 6 | Comma | Dot | Russian headers, reordered columns and extra fields |
| supplier-quoted.csv | 5 | Comma | Dot | Quoted commas, escaped quotes, multiline field and empty optional field |
| supplier-invalid.csv | 9 | Comma | Dot | Duplicate SKU and invalid required values |

## Column mapping

- Basic, quoted and invalid: `Код товара` → `Артикул`, `Название` → `Наименование`, `Стоимость` → `Цена`.
- Semicolon: `Артикул` → `Артикул`, `Наименование` → `Наименование`, `Цена закупки` → `Цена`.
- Reordered: `Артикул` → `Артикул`, `Наименование` → `Наименование`, `Цена` → `Цена`.
- Stock, category and notes can be ignored for the initial import.

## Expected checks

- Basic: first SKU remains `001`; price `120.00` becomes `144.00` at 20% markup.
- Semicolon: `149,90` parses as 149.90; first SKU remains `000101`.
- Quoted: five product records despite the multiline note; literal quotes in the second name are preserved.
- Invalid (physical line numbers, including header): line 4 duplicates SKU `001`;
  line 5 has no SKU; line 6 has no name; line 7 has no price; line 8 has a nonnumeric
  price; line 9 has a negative price. With the current first-occurrence duplicate
  rule, three products are valid and six records have issues.

Open these files with the application's CSV/XLSX picker. Select the separator
listed above, UTF-8 encoding and header row 1, then build the preview.
