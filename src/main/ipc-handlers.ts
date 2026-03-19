import { ipcMain } from 'electron';
import type { AppUpdateManager } from '@main/app-update-manager';
import type { MeshcoreManager } from '@main/meshcore-manager';
import { IPC_CHANNELS } from '@shared/meshcore';

export function registerIpcHandlers(meshcoreManager: MeshcoreManager, appUpdateManager: AppUpdateManager): void {
  ipcMain.handle(IPC_CHANNELS.listPorts, async () => {
    const { listCandidatePorts } = await import('@main/port-scanner');
    return listCandidatePorts();
  });

  ipcMain.handle(IPC_CHANNELS.connect, (_event, portPath: string) => meshcoreManager.connect(portPath));
  ipcMain.handle(IPC_CHANNELS.disconnect, () => meshcoreManager.disconnect());
  ipcMain.handle(IPC_CHANNELS.syncTime, () => meshcoreManager.syncTime());
  ipcMain.handle(IPC_CHANNELS.getSelfInfo, () => meshcoreManager.getSelfInfo());
  ipcMain.handle(IPC_CHANNELS.getDeviceSettings, () => meshcoreManager.getDeviceSettings());
  ipcMain.handle(IPC_CHANNELS.getAppUpdateState, () => appUpdateManager.getState());
  ipcMain.handle(IPC_CHANNELS.checkForAppUpdates, () => appUpdateManager.checkForUpdates());
  ipcMain.handle(IPC_CHANNELS.downloadAppUpdate, () => appUpdateManager.downloadUpdate());
  ipcMain.handle(IPC_CHANNELS.installAppUpdate, () => appUpdateManager.installUpdate());
  ipcMain.handle(IPC_CHANNELS.showDesktopNotification, (_event, input) => appUpdateManager.showDesktopNotification(input));
  ipcMain.handle(IPC_CHANNELS.getContacts, () => meshcoreManager.getContacts());
  ipcMain.handle(IPC_CHANNELS.getChannels, () => meshcoreManager.getChannels());
  ipcMain.handle(IPC_CHANNELS.getWaitingMessages, () => meshcoreManager.getWaitingMessages());
  ipcMain.handle(IPC_CHANNELS.getBattery, () => meshcoreManager.getBattery());
  ipcMain.handle(IPC_CHANNELS.updateDeviceSettings, (_event, input) => meshcoreManager.updateDeviceSettings(input));
  ipcMain.handle(IPC_CHANNELS.createHashtagChannel, (_event, input) => meshcoreManager.createHashtagChannel(input));
  ipcMain.handle(IPC_CHANNELS.sendDirectMessage, (_event, input) => meshcoreManager.sendDirectMessage(input));
  ipcMain.handle(IPC_CHANNELS.sendChannelMessage, (_event, input) => meshcoreManager.sendChannelMessage(input));
  ipcMain.handle(IPC_CHANNELS.getDeviceInfo, () => meshcoreManager.getDeviceInfo());
  ipcMain.handle(IPC_CHANNELS.reboot, () => meshcoreManager.reboot());
  ipcMain.handle(IPC_CHANNELS.sendAdvert, (_event, type: 'flood' | 'zero-hop') => meshcoreManager.sendAdvert(type));
}
