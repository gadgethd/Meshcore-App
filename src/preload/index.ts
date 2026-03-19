import { contextBridge, ipcRenderer } from 'electron';
import type { MeshcoreAPI, MeshcorePushEvent } from '@shared/meshcore';
import { IPC_CHANNELS } from '@shared/meshcore';

const api: MeshcoreAPI = {
  listPorts: () => ipcRenderer.invoke(IPC_CHANNELS.listPorts),
  connect: (portPath) => ipcRenderer.invoke(IPC_CHANNELS.connect, portPath),
  disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.disconnect),
  syncTime: () => ipcRenderer.invoke(IPC_CHANNELS.syncTime),
  getSelfInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getSelfInfo),
  getDeviceSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getDeviceSettings),
  getContacts: () => ipcRenderer.invoke(IPC_CHANNELS.getContacts),
  getChannels: () => ipcRenderer.invoke(IPC_CHANNELS.getChannels),
  getWaitingMessages: () => ipcRenderer.invoke(IPC_CHANNELS.getWaitingMessages),
  getBattery: () => ipcRenderer.invoke(IPC_CHANNELS.getBattery),
  updateDeviceSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.updateDeviceSettings, input),
  createHashtagChannel: (input) => ipcRenderer.invoke(IPC_CHANNELS.createHashtagChannel, input),
  sendDirectMessage: (input) => ipcRenderer.invoke(IPC_CHANNELS.sendDirectMessage, input),
  sendChannelMessage: (input) => ipcRenderer.invoke(IPC_CHANNELS.sendChannelMessage, input),
  getDeviceInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getDeviceInfo),
  reboot: () => ipcRenderer.invoke(IPC_CHANNELS.reboot),
  sendAdvert: (type) => ipcRenderer.invoke(IPC_CHANNELS.sendAdvert, type),
  onPush: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: MeshcorePushEvent) => {
      listener(payload);
    };

    ipcRenderer.on(IPC_CHANNELS.push, handler);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.push, handler);
    };
  }
};

contextBridge.exposeInMainWorld('meshcoreAPI', api);
