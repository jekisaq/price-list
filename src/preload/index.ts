import { contextBridge, ipcRenderer } from 'electron'
import { channels } from '../shared/api'
import type { PriceListApi } from '../shared/api'

const api: PriceListApi = {
  openFile: () => ipcRenderer.invoke(channels.openFile),
  importTable: (request) => ipcRenderer.invoke(channels.import, request),
  processTable: (request) => ipcRenderer.invoke(channels.process, request),
  importPage: (request) => ipcRenderer.invoke(channels.importPage, request),
  reportPage: (request) => ipcRenderer.invoke(channels.reportPage, request),
  cancelOperation: (request) =>
    ipcRenderer.invoke(channels.cancelOperation, request),
  onOperation: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof listener>[0],
    ) => listener(progress)
    ipcRenderer.on(channels.operation, handler)
    return () => {
      ipcRenderer.removeListener(channels.operation, handler)
    }
  },
  exportTable: (request) => ipcRenderer.invoke(channels.export, request),
  exportReport: (request) => ipcRenderer.invoke(channels.exportReport, request),
  getSettings: () => ipcRenderer.invoke(channels.getSettings),
  saveSettings: (request) => ipcRenderer.invoke(channels.saveSettings, request),
  getProfiles: () => ipcRenderer.invoke(channels.getProfiles),
  saveProfile: (request) => ipcRenderer.invoke(channels.saveProfile, request),
  selectProfile: (request) =>
    ipcRenderer.invoke(channels.selectProfile, request),
  renameProfile: (request) =>
    ipcRenderer.invoke(channels.renameProfile, request),
  deleteProfile: (request) =>
    ipcRenderer.invoke(channels.deleteProfile, request),
}

contextBridge.exposeInMainWorld('api', api)
