# Price List

Приложение для подготовки прайс-листов на Electron, React и TypeScript.

## Разработка

Нужен Node.js 22.12+ (рекомендуется актуальный LTS) и npm.

```sh
npm ci
npm run dev
```

`dev` запускает Electron и сервер Vite: изменения React обновляются через HMR,
изменения main/preload отслеживаются electron-vite.

Если PowerShell сообщает об отсутствующем `npm-cli.js` при вызове `npm`,
используйте `npm.cmd` вместо `npm` (например, `npm.cmd run dev`).

## Команды

| Команда | Назначение |
| --- | --- |
| `npm run dev` | Запуск разработки |
| `npm run typecheck` | Строгая проверка TypeScript |
| `npm run build` | Проверка типов и production-сборка в `out/` |
| `npm start` | Сборка и запуск production-версии в Electron |
| `npm run pack` | Сборка приложения без установщика в `release/` |
| `npm run dist` | Сборка Windows x64 NSIS-установщика в `release/` |

Windows-установщик следует собирать на Windows. Первая упаковка может скачивать
Electron и инструменты electron-builder. Подпись релиза и собственная иконка
пока не настроены.

## Структура

- `src/main/main.ts` — главный процесс и создание окна.
- `src/preload/index.ts` — точка входа preload; собирается в CommonJS для sandbox.
- `src/renderer/` — HTML и React-интерфейс.
- `electron.vite.config.ts` — сборка трёх частей приложения.
- `electron-builder.yml` — настройки упаковки и установщика.

TypeScript проверяет исходники с `strict: true` и `target: ESNext`;
JavaScript выпускает Vite с целями, подходящими для Electron.
`out/` и `release/` генерируются автоматически и не хранятся в Git.
