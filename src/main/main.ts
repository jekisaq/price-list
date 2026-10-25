import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const rendererPath = fileURLToPath(
    new URL('../renderer/index.html', import.meta.url)
  )

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await win.loadFile(rendererPath)
  }
}

app.whenReady().then(async () => {
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
}).catch((error: unknown) => {
  console.error('Не удалось запустить приложение:', error)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
