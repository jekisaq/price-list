import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import type { ProfilesState, Settings, SupplierProfile } from '../../shared/api'
import {
  identifier,
  importOptions,
  object,
  settings,
  exportFormat,
} from '../validation.ts'
import { validateMapping } from '../../shared/mapping.ts'
import { saveFile, writeErrorMessage } from './export-file.ts'

const MAX_BYTES = 4 * 1024 * 1024
const MAX_PROFILES = 100
interface Document {
  version: 1
  settings: Settings
  profiles: SupplierProfile[]
  activeProfileId: string | null
}
const defaults = (): Document => ({
  version: 1,
  settings: settings({ markup: 20 }),
  profiles: [],
  activeProfileId: null,
})

export function profileName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80)
    throw new Error('Название профиля должно содержать от 1 до 80 символов.')

  return value.trim().replace(/\s+/gu, ' ')
}
const nameKey = (value: string) => value.toLowerCase()

function profile(value: unknown): SupplierProfile {
  const data = object(value)
  if (
    !Array.isArray(data.columns) ||
    data.columns.length < 3 ||
    data.columns.length > 256 ||
    !data.columns.every(
      (column: unknown) =>
        typeof column === 'string' && column.trim() && column.length <= 1000,
    )
  )
    throw new Error(
      'Не удалось сохранить заголовки колонок профиля: допустимо от 3 до 256 заголовков длиной до 1000 символов.',
    )

  const mapping = validateMapping(data.mapping, data.columns.length)
  if (!mapping.valid)
    throw new Error(Object.values(mapping.errors).join(' '))

  return {
    id: identifier(data.id),
    name: profileName(data.name),
    format: exportFormat(data),
    importOptions: importOptions(data.importOptions),
    columns: [...data.columns] as string[],
    mapping: mapping.mapping,
    settings: settings(data.settings),
  }
}

function document(value: unknown): Document {
  const data = object(value)
  if (
    data.version !== 1 ||
    !Array.isArray(data.profiles) ||
    data.profiles.length > MAX_PROFILES
  )
    throw new Error('Некорректный формат настроек.')

  const profiles = data.profiles.map(profile)
  if (
    new Set(profiles.map((entry) => entry.id)).size !== profiles.length ||
    new Set(profiles.map((entry) => nameKey(entry.name))).size !==
      profiles.length
  )
    throw new Error('В настройках найдены повторяющиеся профили.')

  const activeProfileId =
    data.activeProfileId === null ? null : identifier(data.activeProfileId)
  if (
    activeProfileId !== null &&
    !profiles.some((entry) => entry.id === activeProfileId)
  )
    throw new Error('Выбранный профиль не найден.')

  return {
    version: 1,
    profiles,
    activeProfileId,
    settings: settings(data.settings),
  }
}

export class ProfileStore {
  private data = defaults()
  private warning: string | null = null
  private readOnly = false
  private loading: Promise<void> | undefined
  private pending: Promise<void> = Promise.resolve()
  readonly path: string
  private directory: string

  constructor(directory: string) {
    this.directory = directory
    this.path = join(directory, 'profiles.json')
  }

  private async load(): Promise<void> {
    let contents: string
    try {
      const stat = await fs.stat(this.path)
      if (!stat.isFile())
        throw new Error('Настройки не являются файлом.')

      if (stat.size > MAX_BYTES) {
        await this.recover()
        return
      }
      contents = await fs.readFile(this.path, 'utf8')
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return

      this.readOnly = true
      this.warning =
        'Не удалось прочитать настройки. Используются настройки по умолчанию; сохранение отключено, чтобы не повредить существующий файл. Проверьте доступ к пользовательской папке и перезапустите приложение.'
      return
    }
    let value: unknown
    try {
      value = JSON.parse(contents)
    } catch {
      await this.recover()
      return
    }
    if (
      value &&
      typeof value === 'object' &&
      'version' in value &&
      typeof value.version === 'number' &&
      value.version !== 1
    ) {
      this.readOnly = true
      this.warning = `Версия настроек ${value.version} не поддерживается. Файл оставлен без изменений. Используются настройки по умолчанию; сохранение отключено.`
      return
    }
    try {
      this.data = document(value)
    } catch {
      await this.recover()
    }
  }

  private async recover(): Promise<void> {
    const backup = join(this.directory, `profiles.corrupt-${randomUUID()}.json`)
    try {
      await fs.rename(this.path, backup)
      this.warning = `Настройки повреждены. Сохранена резервная копия: ${backup}. Используются настройки по умолчанию.`
    } catch {
      this.readOnly = true
      this.warning =
        'Настройки повреждены, но создать резервную копию не удалось. Файл оставлен без изменений; сохранение отключено. Проверьте доступ к пользовательской папке и перезапустите приложение.'
    }
  }

  async getState(): Promise<ProfilesState> {
    this.loading ??= this.load()
    await this.loading
    return structuredClone({
      settings: this.data.settings,
      profiles: this.data.profiles,
      activeProfileId: this.data.activeProfileId,
      warning: this.warning,
      readOnly: this.readOnly,
    })
  }

  private mutate(change: (next: Document) => void): Promise<ProfilesState> {
    const operation = this.pending.then(async () => {
      await this.getState()
      if (this.readOnly)
        throw new Error(
          'Сохранение настроек отключено. Проверьте файл настроек и перезапустите приложение.',
        )

      const next = structuredClone(this.data)
      change(next)
      const contents = JSON.stringify(next, null, 2)
      if (Buffer.byteLength(contents) > MAX_BYTES)
        throw new Error(
          'Настройки превышают лимит 4 МиБ. Удалите ненужные профили или сократите заголовки.',
        )

      try {
        await fs.mkdir(this.directory, { recursive: true })
        await saveFile(this.path, contents)
      } catch (error) {
        const message =
          error instanceof Error && !('code' in error)
            ? error.message
            : writeErrorMessage(error)
        throw new Error(`Не удалось сохранить настройки. ${message}`)
      }
      this.data = next
      return this.getState()
    })
    this.pending = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  async saveSettings(value: unknown): Promise<Settings> {
    const next = settings(value)
    return (
      await this.mutate((data) => {
        data.settings = next
      })
    ).settings
  }

  saveProfile(value: unknown): Promise<ProfilesState> {
    const input = object(value)
    const updating = input.id !== undefined
    const next = profile({
      ...input,
      id: updating ? identifier(input.id) : randomUUID(),
    })
    return this.mutate((data) => {
      const index = data.profiles.findIndex((entry) => entry.id === next.id)
      if (updating && index === -1)
        throw new Error('Профиль устарел. Выберите его снова.')

      if (
        data.profiles.some(
          (entry) =>
            entry.id !== next.id && nameKey(entry.name) === nameKey(next.name),
        )
      )
        throw new Error('Профиль с таким названием уже существует.')

      if (index === -1) {
        if (data.profiles.length >= MAX_PROFILES)
          throw new Error('Можно сохранить не более 100 профилей.')

        data.profiles.push(next)
      } else {
        data.profiles[index] = next
      }
      data.activeProfileId = next.id
      data.settings = next.settings
    })
  }

  selectProfile(value: unknown): Promise<ProfilesState> {
    const id = value === null ? null : identifier(value)
    return this.mutate((data) => {
      const selected = data.profiles.find((entry) => entry.id === id)
      if (id !== null && !selected)
        throw new Error('Профиль устарел. Выберите его снова.')

      data.activeProfileId = id
      if (selected)
        data.settings = selected.settings

    })
  }

  renameProfile(id: unknown, value: unknown): Promise<ProfilesState> {
    const profileId = identifier(id)
    const name = profileName(value)
    return this.mutate((data) => {
      const selected = data.profiles.find((entry) => entry.id === profileId)
      if (!selected)
        throw new Error('Профиль устарел. Выберите его снова.')

      if (
        data.profiles.some(
          (entry) =>
            entry.id !== profileId && nameKey(entry.name) === nameKey(name),
        )
      )
        throw new Error('Профиль с таким названием уже существует.')

      selected.name = name
    })
  }

  deleteProfile(id: unknown): Promise<ProfilesState> {
    const profileId = identifier(id)
    return this.mutate((data) => {
      if (!data.profiles.some((entry) => entry.id === profileId))
        throw new Error('Профиль устарел. Выберите его снова.')

      data.profiles = data.profiles.filter((entry) => entry.id !== profileId)
      if (data.activeProfileId === profileId)
        data.activeProfileId = null

    })
  }
}
