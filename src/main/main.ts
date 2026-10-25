import { app, BrowserWindow } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerIpc } from './ipc'

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 760,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const rendererPath = fileURLToPath(
    new URL('../renderer/index.html', import.meta.url),
  )

  const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  const rendererUrl = devUrl
    ? new URL(devUrl).href
    : pathToFileURL(rendererPath).href
  registerIpc(win, rendererUrl)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl)
      event.preventDefault()
  })

  if (devUrl) {
    await win.loadURL(devUrl)
  } else {
    await win.loadFile(rendererPath)
  }
}

app
  .whenReady()
  .then(async () => {
    await createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow()
      }
    })
  })
  .catch((error: unknown) => {
    console.error('Не удалось запустить приложение:', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin')
    app.quit()
})
