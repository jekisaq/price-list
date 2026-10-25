import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
  })

  const rendererPath = fileURLToPath(
    new URL('../renderer/index.html', import.meta.url)
  )

  await win.loadFile(rendererPath)
}

app.whenReady().then(() => {
  createWindow()
})