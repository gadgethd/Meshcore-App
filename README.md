# MeshCore Desktop

Cross-platform desktop app for working with MeshCore companion radios over USB serial and Bluetooth LE.

## Current Status

`0.0.1-alpha`

The app is usable for early testing and companion-radio workflows. USB is the most reliable transport today. BLE support is implemented, but behavior still depends on the host Bluetooth stack and device firmware.

## Features

- Auto-discover and connect to MeshCore companion radios over USB
- Bluetooth LE companion connection flow in Electron
- Direct messages and channel messages
- Unread counts with per-node read tracking
- Local 14-day message archive for desktop history
- Dark network map with live and archived nodes
- Companion radio settings editor
- Hashtag channel creation and channel ordering

## Stack

- Electron
- React + TypeScript
- Zustand
- Tailwind CSS
- Leaflet
- `@liamcottle/meshcore.js` sourced from the official MeshCore JS repo

## Development

Requirements:

- Node.js 20+
- npm

Install dependencies:

```bash
npm install
```

Run the app in development:

```bash
npm run dev
```

Type-check:

```bash
npm run typecheck
```

Build production bundles:

```bash
npm run build
```

Package the app:

```bash
npm run package -- --linux AppImage
```

## Project Layout

```text
src/
  main/        Electron main process and MeshCore serial manager
  preload/     Typed context bridge
  renderer/    React UI
  shared/      Shared protocol and app types
```

## Notes

- Linux serial access may require membership in the `dialout` group.
- BLE support relies on Electron Web Bluetooth support and OS Bluetooth stability.
- This repository intentionally excludes local workflow files and machine-specific state.
