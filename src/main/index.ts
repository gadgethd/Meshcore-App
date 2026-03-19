import { app, BrowserWindow, Menu, dialog, shell } from 'electron';

// Required on Linux for Web Bluetooth GATT operations to work via BlueZ
app.commandLine.appendSwitch('enable-features', 'WebBluetooth');
import { join } from 'node:path';
import { AppUpdateManager } from '@main/app-update-manager';
import { MeshcoreManager } from '@main/meshcore-manager';
import { registerIpcHandlers } from '@main/ipc-handlers';
import { IPC_CHANNELS } from '@shared/meshcore';

const meshcoreManager = new MeshcoreManager();
const appUpdateManager = new AppUpdateManager();
let pendingBluetoothSelection:
  | {
      callback: (deviceId: string) => void;
      timeout: NodeJS.Timeout;
    }
  | null = null;

function clearPendingBluetoothSelection(selectedDeviceId = ''): void {
  if (!pendingBluetoothSelection) {
    return;
  }

  clearTimeout(pendingBluetoothSelection.timeout);
  pendingBluetoothSelection.callback(selectedDeviceId);
  pendingBluetoothSelection = null;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0f172a',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableBlinkFeatures: 'WebBluetooth'
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();

    if (pendingBluetoothSelection) {
      clearTimeout(pendingBluetoothSelection.timeout);
    }

    const preferredDevice =
      deviceList.find((device) => (device.deviceName ?? '').toLowerCase().includes('meshcore')) ??
      deviceList[0];

    if (preferredDevice) {
      callback(preferredDevice.deviceId);
      pendingBluetoothSelection = null;
      return;
    }

    pendingBluetoothSelection = {
      callback,
      timeout: setTimeout(() => {
        clearPendingBluetoothSelection('');
      }, 10000)
    };
  });

  window.webContents.session.setBluetoothPairingHandler(async (details, callback) => {
    if (details.pairingKind === 'providePin') {
      dialog.showErrorBox('Bluetooth PIN Required', `This Bluetooth device requires a PIN. Pair ${details.deviceId} in the operating system first, then try connecting again.`);
      callback({ confirmed: false });
      return;
    }

    if (details.pairingKind === 'confirm' || details.pairingKind === 'confirmPin') {
      const { response } = await dialog.showMessageBox(window, {
        type: 'question',
        buttons: ['Pair', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: 'Bluetooth Pairing',
        message:
          details.pairingKind === 'confirmPin'
            ? `Confirm that the PIN ${details.pin ?? ''} matches the MeshCore node.`
            : `Allow Bluetooth pairing with ${details.deviceId}?`
      });

      callback({ confirmed: response === 0 });
      return;
    }

    callback({ confirmed: false });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers(meshcoreManager, appUpdateManager);

  meshcoreManager.onPush((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.push, event);
      }
    }
  });

  appUpdateManager.onStateChange((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.appUpdate, state);
      }
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  clearPendingBluetoothSelection('');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
