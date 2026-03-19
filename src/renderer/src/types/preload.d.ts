import type { MeshcoreAPI } from '@shared/meshcore';

declare global {
  interface Window {
    meshcoreAPI: MeshcoreAPI;
  }
}

export {};
