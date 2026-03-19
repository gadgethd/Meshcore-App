import { create } from 'zustand';
import type { MeshcoreChannel } from '@shared/meshcore';

interface ChannelsState {
  channels: MeshcoreChannel[];
  replaceChannels: (channels: MeshcoreChannel[]) => void;
}

export const useChannelsStore = create<ChannelsState>((set) => ({
  channels: [],
  replaceChannels: (channels) => set({ channels })
}));
