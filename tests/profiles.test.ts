import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, mock } from 'node:test'
import { ProfileStore } from '../src/main/services/profile-store.ts'
import { restoreProfileMapping } from '../src/shared/profiles.ts'
import type { SupplierProfile } from '../src/shared/api.ts'

const sample = () => ({
  name: 'Поставщик',
  format: 'csv',
  importOptions: {
    delimiter: ';',
    encoding: 'windows-1251',
    sheet: '',
    headerRow: 2,
  },
  columns: ['Описание', 'Тариф', 'Идентификатор'],
  mapping: { sku: 2, name: 0, price: 1 },
  settings: {
    markup: 37,
    roundingMode: 'up',
    roundingStep: 1,
    duplicatePolicy: 'last',
  },
})

async function withDirectory(action: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'price-list-profiles-'))
  try {
    await action(directory)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

test('profile snapshots, current settings and selected profile survive a new store instance', async () => {
  await withDirectory(async (directory) => {
    const store = new ProfileStore(join(directory, 'nested'))
    const defaults = await store.getState()
    assert.equal(defaults.settings.markup, 20)
    assert.equal(defaults.readOnly, false)
    assert.deepEqual(defaults.profiles, [])
    const saved = await store.saveProfile(sample())
    const id = saved.profiles[0]!.id
    await store.saveSettings({
      markup: 11.25,
      roundingMode: 'down',
      roundingStep: 10,
      duplicatePolicy: 'first',
    })
    const restarted = new ProfileStore(join(directory, 'nested'))
    const restored = await restarted.getState()
    assert.equal(restored.activeProfileId, id)
    assert.equal(restored.settings.markup, 11.25)
    assert.deepEqual(restored.profiles[0], { ...sample(), id })
    const selected = await restarted.selectProfile(id)
    assert.deepEqual(selected.settings, sample().settings)
    assert.equal(JSON.parse(await fs.readFile(store.path, 'utf8')).version, 1)
    restored.profiles[0]!.name = 'local mutation'
    assert.equal((await restarted.getState()).profiles[0]?.name, 'Поставщик')
  })
})

test('create, update, rename, select and delete profiles preserve identifiers and enforce unique names', async () => {
  await withDirectory(async (directory) => {
    const store = new ProfileStore(directory)
    const first = (await store.saveProfile(sample())).profiles[0]!
    const secondState = await store.saveProfile({ ...sample(), name: 'Другой' })
    const second = secondState.profiles[1]!
    await assert.rejects(
      async () => store.saveProfile({ ...sample(), name: ' ПОСТАВЩИК ' }),
      /уже существует/,
    )
    await assert.rejects(
      () => store.renameProfile(second.id, first.name),
      /уже существует/,
    )
    const renamed = await store.renameProfile(first.id, '  Новый   поставщик  ')
    assert.equal(renamed.profiles[0]?.name, 'Новый поставщик')
    assert.equal(renamed.activeProfileId, second.id)
    const updated = await store.saveProfile({
      ...first,
      name: 'Обновлён',
      settings: { markup: 5 },
    })
    assert.equal(updated.profiles.length, 2)
    assert.equal(updated.activeProfileId, first.id)
    assert.equal(updated.settings.markup, 5)
    await store.selectProfile(null)
    assert.equal(
      (await new ProfileStore(directory).getState()).activeProfileId,
      null,
    )
    await store.selectProfile(first.id)
    await store.deleteProfile(second.id)
    assert.equal((await store.getState()).activeProfileId, first.id)
    await store.deleteProfile(first.id)
    const remaining = await new ProfileStore(directory).getState()
    assert.equal(remaining.activeProfileId, null)
    assert.equal(remaining.settings.markup, 5)
    assert.deepEqual(remaining.profiles, [])
    await assert.rejects(() => store.selectProfile(first.id), /устарел/)
    await assert.rejects(() => store.deleteProfile(first.id), /устарел/)
    await assert.rejects(() => store.renameProfile(first.id, 'Имя'), /устарел/)
    await assert.rejects(() => store.saveProfile({ ...first }), /устарел/)
  })
})

test('queued writes avoid losing concurrently created profiles and remain usable after a rejected mutation', async () => {
  await withDirectory(async (directory) => {
    const store = new ProfileStore(directory)
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.saveProfile({ ...sample(), name: `Поставщик ${index}` }),
      ),
    )
    assert.equal(
      (await new ProfileStore(directory).getState()).profiles.length,
      8,
    )
    await assert.rejects(() => store.selectProfile(randomUUID()), /устарел/)
    await store.saveSettings({ markup: 17 })
    assert.equal(
      (await new ProfileStore(directory).getState()).settings.markup,
      17,
    )
    assert.deepEqual(await fs.readdir(directory), ['profiles.json'])
  })
})

test('malformed JSON, invalid schema and oversized files are preserved in backups before using defaults', async () => {
  for (const contents of [
    '{bad json',
    JSON.stringify({
      version: 1,
      profiles: [],
      activeProfileId: null,
      settings: { markup: -1 },
    }),
    ' '.repeat(4 * 1024 * 1024 + 1),
  ]) {
    await withDirectory(async (directory) => {
      const store = new ProfileStore(directory)
      await fs.writeFile(store.path, contents)
      const state = await store.getState()
      assert.equal(state.readOnly, false)
      assert.match(state.warning ?? '', /повреждены.*резервная копия/s)
      assert.equal(state.settings.markup, 20)
      const backup = (await fs.readdir(directory)).find((name) =>
        name.startsWith('profiles.corrupt-'),
      )!
      assert.equal(await fs.readFile(join(directory, backup), 'utf8'), contents)
      await store.saveSettings({ markup: 7 })
      assert.equal(
        (await new ProfileStore(directory).getState()).settings.markup,
        7,
      )
      assert.equal(await fs.readFile(join(directory, backup), 'utf8'), contents)
    })
  }
})

test('unsupported versions are never overwritten and keep the application readable with defaults', async () => {
  await withDirectory(async (directory) => {
    const store = new ProfileStore(directory)
    const contents = JSON.stringify({
      version: 99,
      profiles: ['future-format'],
    })
    await fs.writeFile(store.path, contents)
    const state = await store.getState()
    assert.equal(state.readOnly, true)
    assert.match(state.warning ?? '', /Версия настроек 99 не поддерживается/)
    assert.equal(state.settings.markup, 20)
    await assert.rejects(() => store.saveSettings({ markup: 2 }), /отключено/)
    await assert.rejects(() => store.saveProfile(sample()), /отключено/)
    assert.equal(await fs.readFile(store.path, 'utf8'), contents)
    assert.deepEqual(await fs.readdir(directory), ['profiles.json'])
  })
})

test('failed recovery preserves the damaged file and disables writing', async () => {
  await withDirectory(async (directory) => {
    const store = new ProfileStore(directory)
    await fs.writeFile(store.path, 'broken')
    const intercept = mock.method(fs, 'rename', async () => {
      throw Object.assign(new Error('access'), { code: 'EACCES' })
    })
    try {
      const state = await store.getState()
      assert.equal(state.readOnly, true)
      assert.match(state.warning ?? '', /резервную копию не удалось/)
      await assert.rejects(() => store.saveSettings({ markup: 1 }), /отключено/)
    } finally {
      intercept.mock.restore()
    }
    assert.equal(await fs.readFile(store.path, 'utf8'), 'broken')
  })
})

test('read errors cannot be mistaken for a missing file and writing failures preserve last good settings', async () => {
  await withDirectory(async (directory) => {
    const store = new ProfileStore(directory)
    await store.saveProfile(sample())
    const original = await fs.readFile(store.path, 'utf8')
    const read = mock.method(fs, 'readFile', async () => {
      throw Object.assign(new Error('access'), { code: 'EACCES' })
    })
    try {
      const inaccessible = await new ProfileStore(directory).getState()
      assert.equal(inaccessible.readOnly, true)
      assert.match(inaccessible.warning ?? '', /Не удалось прочитать/)
    } finally {
      read.mock.restore()
    }
    const rename = mock.method(fs, 'rename', async () => {
      throw Object.assign(new Error('locked'), { code: 'EBUSY' })
    })
    try {
      await assert.rejects(
        () => store.saveSettings({ markup: 999 }),
        /Не удалось сохранить настройки.*Файл занят/s,
      )
      assert.equal((await store.getState()).settings.markup, 37)
      assert.equal(await fs.readFile(store.path, 'utf8'), original)
      assert.deepEqual(await fs.readdir(directory), ['profiles.json'])
    } finally {
      rename.mock.restore()
    }
    await store.saveSettings({ markup: 2 })
    assert.equal(
      (await new ProfileStore(directory).getState()).settings.markup,
      2,
    )
  })
})

test('profile payload validation rejects invalid names, mappings, settings, options and identifiers', async () => {
  await withDirectory(async (directory) => {
    const store = new ProfileStore(directory)
    for (const change of [
      { name: '' },
      { name: ' '.repeat(10) },
      { name: 'x'.repeat(81) },
      { id: '../file' },
      { format: 'xls' },
      { columns: ['one'] },
      { columns: ['a', 'b', 3] },
      { mapping: { sku: 0, name: 0, price: 1 } },
      { settings: { markup: -1 } },
      { importOptions: { ...sample().importOptions, headerRow: 0 } },
    ]) {
      await assert.rejects(async () =>
        store.saveProfile({ ...sample(), ...change }),
      )
    }
    assert.deepEqual((await store.getState()).profiles, [])
    const saved = await store.saveProfile(sample())
    const doc = JSON.parse(await fs.readFile(store.path, 'utf8'))
    doc.profiles[0].mapping.price = 999
    await fs.writeFile(store.path, JSON.stringify(doc))
    assert.match(
      (await new ProfileStore(directory).getState()).warning ?? '',
      /повреждены/,
    )
    assert.equal(saved.profiles[0]?.mapping.price, 1)
  })
})

test('profile count limit rejects new profiles but still permits updating an existing profile', async () => {
  await withDirectory(async (directory) => {
    const store = new ProfileStore(directory)
    const profiles = Array.from({ length: 100 }, (_, index) => ({
      ...sample(),
      id: randomUUID(),
      name: `Поставщик ${index}`,
    }))
    await fs.writeFile(
      store.path,
      JSON.stringify({
        version: 1,
        profiles,
        activeProfileId: null,
        settings: { markup: 20 },
      }),
    )
    await assert.rejects(() => store.saveProfile(sample()), /100 профилей/)
    await store.saveProfile({ ...profiles[0]!, name: 'Обновлённый' })
    assert.equal((await store.getState()).profiles.length, 100)
  })
})

test('mapping restoration follows unique saved headers across reordered or extra columns', () => {
  const profile = { ...sample(), id: randomUUID() } as SupplierProfile
  assert.deepEqual(
    restoreProfileMapping(profile, ['Описание', 'Тариф', 'Идентификатор'])
      .mapping,
    { sku: 2, name: 0, price: 1 },
  )
  const reordered = restoreProfileMapping(profile, [
    ' ИДЕНТИФИКАТОР ',
    'Лишнее',
    'Тариф',
    'Описание',
  ])
  assert.deepEqual(reordered.mapping, { sku: 0, name: 3, price: 2 })
  assert.match(reordered.warning ?? '', /Порядок колонок изменился/)
  assert.equal(restoreProfileMapping(profile, profile.columns).warning, null)
})

test('missing, renamed and ambiguous headers require manual mapping even when positions are in range', () => {
  const profile = { ...sample(), id: randomUUID() } as SupplierProfile
  const changed = restoreProfileMapping(profile, [
    'Описание',
    'Другая цена',
    'Идентификатор',
  ])
  assert.deepEqual(changed.mapping, { sku: 2, name: 0, price: null })
  assert.match(changed.warning ?? '', /Цена.*вручную/)
  const duplicate = restoreProfileMapping(profile, [
    'Описание',
    'Тариф',
    'Идентификатор',
    'Тариф',
  ])
  assert.equal(duplicate.mapping.price, null)
  assert.match(duplicate.warning ?? '', /неоднозначны/)
  const missing = restoreProfileMapping(profile, ['Тариф'])
  assert.deepEqual(missing.mapping, { sku: null, name: null, price: 0 })
})
