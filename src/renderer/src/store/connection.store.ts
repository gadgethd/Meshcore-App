import { create } from 'zustand';
import type { ConnectionStatus, ConnectionTransport, MeshcoreDeviceSettings, SerialPortInfo } from '@shared/meshcore';

interface ConnectionState {
  status: ConnectionStatus;
  transport: ConnectionTransport | null;
  portPath: string | null;
  nodeName: string | null;
  connectionDetail: string | null;
  deviceSettings: MeshcoreDeviceSettings | null;
  batteryMillivolts: number | null;
  error: string | null;
  ports: SerialPortInfo[];
  setStatus: (status: ConnectionStatus) => void;
  setTransport: (transport: ConnectionTransport | null) => void;
  setPortPath: (portPath: string | null) => void;
  setNodeName: (nodeName: string | null) => void;
  setConnectionDetail: (connectionDetail: string | null) => void;
  setDeviceSettings: (deviceSettings: MeshcoreDeviceSettings | null) => void;
  setBattery: (batteryMillivolts: number | null) => void;
  setError: (error: string | null) => void;
  setPorts: (ports: SerialPortInfo[]) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'disconnected',
  transport: null,
  portPath: null,
  nodeName: null,
  connectionDetail: null,
  deviceSettings: null,
  batteryMillivolts: null,
  error: null,
  ports: [],
  setStatus: (status) => set({ status }),
  setTransport: (transport) => set({ transport }),
  setPortPath: (portPath) => set({ portPath }),
  setNodeName: (nodeName) => set({ nodeName }),
  setConnectionDetail: (connectionDetail) => set({ connectionDetail }),
  setDeviceSettings: (deviceSettings) => set({ deviceSettings }),
  setBattery: (batteryMillivolts) => set({ batteryMillivolts }),
  setError: (error) => set({ error }),
  setPorts: (ports) => set({ ports })
}));
