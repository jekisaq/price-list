import { useEffect, useState } from 'react'
import type {
  Field,
  ImportedTable,
  Mapping,
  ProcessResult,
  Result,
} from '../../shared/api'

const steps = ['Загрузка', 'Сопоставление', 'Проверка', 'Экспорт']
const fields: { key: Field; label: string }[] = [
  { key: 'sku', label: 'Артикул' },
  { key: 'name', label: 'Наименование' },
  { key: 'price', label: 'Цена' },
]

function unwrap<T>(result: Result<T>): T {
  if (!result.ok)
    throw new Error(result.error)

  return result.value
}

export function App() {
  const [step, setStep] = useState(0)
  const [table, setTable] = useState<ImportedTable>()
  const [mapping, setMapping] = useState<Mapping>({ sku: 0, name: 1, price: 2 })
  const [markup, setMarkup] = useState('20')
  const [result, setResult] = useState<ProcessResult>()
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    window.api
      .getSettings()
      .then((response) => {
        const settings = unwrap(response)
        
        if (active) {
          setMarkup(String(settings.markup))
          setReady(true)
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Не удалось загрузить настройки.',
          )
      })
    return () => {
      active = false
    }
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Не удалось выполнить операцию.',
      )
    } finally {
      setBusy(false)
    }
  }

  const validMapping = new Set(Object.values(mapping)).size === 3
  const validMarkup =
    markup.trim() !== '' &&
    Number.isFinite(Number(markup)) &&
    Number(markup) >= 0 &&
    Number(markup) <= 1000

  return (
    <main>
      <header>
        <span className="eyebrow">PRICE LIST</span>
        <h1>Подготовка прайс-листа</h1>
        <p>От таблицы поставщика до единого формата магазина.</p>
      </header>
      <aside className="banner">
        Демонстрационный сценарий. Загрузка CSV/XLSX появится на следующем
        этапе. Настройки пока действуют только в текущем окне приложения.
      </aside>
      <nav aria-label="Этапы подготовки">
        <ol className="steps">
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={step === index ? 'step' : undefined}
              className={step === index ? 'active' : ''}
            >
              <span>{index + 1}</span> {label}
            </li>
          ))}
        </ol>
      </nav>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <section className="card" aria-busy={busy}>
        <h2>{steps[step]}</h2>
        {step === 0 && (
          <>
            <p>
              Проверьте весь путь на примере трёх товаров: блокнота, ручки и
              папки.
            </p>
            <button
              disabled={busy || !ready}
              onClick={() =>
                void run(async () => {
                  const imported = unwrap(
                    await window.api.importTable({ source: 'demo' }),
                  )
                  setTable(imported)
                  setResult(undefined)
                  setMapping({ sku: 0, name: 1, price: 2 })
                  setStep(1)
                })
              }
            >
              Загрузить демонстрационную таблицу
            </button>
          </>
        )}
        {step === 1 && table && (
          <>
            <p>
              {table.name} · {table.rows.length} строки
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {table.columns.map((column, index) => (
                      <th key={index}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={index}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <fieldset disabled={busy}>
              <legend>Колонки результата</legend>
              <div className="fields">
                {fields.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <select
                      value={mapping[field.key]}
                      onChange={(event) => {
                        setMapping({
                          ...mapping,
                          [field.key]: Number(event.target.value),
                        })
                        setResult(undefined)
                      }}
                    >
                      {table.columns.map((column, index) => (
                        <option value={index} key={index}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label>
                  Наценка, %
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    step="0.1"
                    value={markup}
                    onChange={(event) => {
                      setMarkup(event.target.value)
                      setResult(undefined)
                    }}
                  />
                </label>
              </div>
            </fieldset>
            {!validMapping && (
              <p className="error">
                Для каждого поля выберите отдельную колонку.
              </p>
            )}
            {!validMarkup && (
              <p className="error">Введите наценку от 0 до 1000%.</p>
            )}
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setStep(0)
                  setNotice('')
                  setError('')
                }}
              >
                Назад
              </button>
              <button
                disabled={busy || !validMapping || !validMarkup}
                onClick={() =>
                  void run(async () => {
                    setResult(undefined)
                    unwrap(
                      await window.api.saveSettings({ markup: Number(markup) }),
                    )
                    setResult(
                      unwrap(
                        await window.api.processTable({
                          importId: table.id,
                          mapping,
                          markup: Number(markup),
                        }),
                      ),
                    )
                    setStep(2)
                  })
                }
              >
                Проверить и рассчитать
              </button>
            </div>
          </>
        )}
        {step === 2 && result && (
          <>
            <p>
              Готово товаров: {result.products.length}. Ошибок:{' '}
              {result.errors.length}.
            </p>
            {result.errors.length > 0 && (
              <ul className="error">
                {result.errors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Артикул</th>
                    <th>Наименование</th>
                    <th>Цена с наценкой</th>
                  </tr>
                </thead>
                <tbody>
                  {result.products.map((product) => (
                    <tr key={product.sku}>
                      <td>{product.sku}</td>
                      <td>{product.name}</td>
                      <td>{product.price.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button className="secondary" onClick={() => setStep(1)}>
                Изменить сопоставление
              </button>
              <button
                disabled={
                  result.errors.length > 0 || result.products.length === 0
                }
                onClick={() => setStep(3)}
              >
                Перейти к экспорту
              </button>
            </div>
          </>
        )}
        {step === 3 && result && (
          <>
            <p>
              Сохраните {result.products.length} товара в CSV: артикул,
              наименование и цена с наценкой.
            </p>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setStep(2)
                  setNotice('')
                  setError('')
                }}
              >
                Назад
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const exported = unwrap(
                      await window.api.exportTable({ resultId: result.id }),
                    )
                    setNotice(
                      exported.canceled
                        ? 'Сохранение отменено. Можно попробовать снова.'
                        : `Файл сохранён: ${exported.path}`,
                    )
                  })
                }
              >
                Сохранить CSV…
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setStep(0)
                  setTable(undefined)
                  setResult(undefined)
                  setNotice('')
                  setError('')
                }}
              >
                Новый импорт
              </button>
            </div>
          </>
        )}
        {busy && <p role="status">Выполняется операция…</p>}
      </section>
    </main>
  )
}
