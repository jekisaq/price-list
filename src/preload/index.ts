import { contextBridge, ipcRenderer } from 'electron'
import { channels } from '../shared/api'
import type { PriceListApi } from '../shared/api'

const api: PriceListApi = {
  openFile: () => ipcRenderer.invoke(channels.openFile),
  importTable: (request) => ipcRenderer.invoke(channels.import, request),
  processTable: (request) => ipcRenderer.invoke(channels.process, request),
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
