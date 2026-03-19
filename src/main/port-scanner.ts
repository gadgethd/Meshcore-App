import { SerialPort } from 'serialport';
import type { SerialPortInfo } from '@shared/meshcore';

const MANUFACTURER_HINTS = [
  'heltec',
  'silicon laboratories',
  'wch.cn',
  'ftdi',
  'espressif'
];

const DESCRIPTION_HINTS = ['cp210', 'cp210x', 'ch340', 'usb serial', 'heltec', 'wireless tracker'];

function isLikelyRadioPort(port: {
  path: string;
  manufacturer?: string | null;
  friendlyName?: string | null;
  pnpId?: string | null;
  vendorId?: string | null;
  productId?: string | null;
}): boolean {
  const path = port.path.toLowerCase();
  const manufacturer = port.manufacturer?.toLowerCase() ?? '';
  const friendlyName = port.friendlyName?.toLowerCase() ?? '';
  const pnpId = port.pnpId?.toLowerCase() ?? '';

  if (
    path.startsWith('/dev/ttyacm') ||
    path.startsWith('/dev/ttyusb') ||
    path.startsWith('/dev/rfcomm') ||
    path.startsWith('/dev/cu.usb') ||
    path.startsWith('/dev/cu.') ||
    /^com\d+$/i.test(port.path)
  ) {
    return true;
  }

  return Boolean(
    manufacturer ||
      friendlyName.includes('usb') ||
      friendlyName.includes('serial') ||
      pnpId.includes('usb') ||
      port.vendorId ||
      port.productId
  );
}

function scorePort(port: SerialPortInfo): number {
  const manufacturer = port.manufacturer?.toLowerCase() ?? '';
  const friendlyName = port.friendlyName.toLowerCase();
  const path = port.path.toLowerCase();
  let score = 0;

  if (MANUFACTURER_HINTS.some((hint) => manufacturer.includes(hint))) {
    score += 10;
  }

  if (DESCRIPTION_HINTS.some((hint) => friendlyName.includes(hint))) {
    score += 5;
  }

  if (friendlyName.includes('cdc') || friendlyName.includes('acm')) {
    score += 4;
  }

  if (friendlyName.includes('meshcore')) {
    score += 15;
  }

  if (friendlyName.includes('seeed') || friendlyName.includes('t1000')) {
    score += 20;
  }

  if (friendlyName.includes('heltec') || manufacturer.includes('heltec')) {
    score += 18;
  }

  if (friendlyName.includes('boot')) {
    score -= 8;
  }

  if (path.startsWith('/dev/ttyacm') || path.startsWith('/dev/ttyusb') || path.startsWith('/dev/cu.usb')) {
    score += 12;
  }

  if (path.startsWith('/dev/rfcomm')) {
    score += 8;
  }

  return score;
}

function fallbackPorts(): SerialPortInfo[] {
  if (process.platform === 'win32') {
    return [{ path: 'COM3', friendlyName: 'COM3 (fallback)' }];
  }

  if (process.platform === 'darwin') {
    return [{ path: '/dev/cu.usbmodem101', friendlyName: '/dev/cu.usbmodem101 (fallback)' }];
  }

  return [{ path: '/dev/ttyUSB0', friendlyName: '/dev/ttyUSB0 (fallback)' }];
}

export async function listCandidatePorts(): Promise<SerialPortInfo[]> {
  try {
    const ports = await SerialPort.list();
    const mappedPorts = ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer ?? undefined,
      serialNumber: port.serialNumber ?? undefined,
      friendlyName: [port.friendlyName, port.path].filter(Boolean).join(' - ') || port.path
    }));
    const likelyPorts = mappedPorts.filter(isLikelyRadioPort);

    return (likelyPorts.length > 0 ? likelyPorts : mappedPorts)
      .sort((left, right) => scorePort(right) - scorePort(left));
  } catch {
    return fallbackPorts();
  }
}
