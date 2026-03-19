import { app } from 'electron';
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo
} from 'electron-updater';
import type { AppUpdateState } from '@shared/meshcore';

function normalizeReleaseNotes(value: UpdateInfo['releaseNotes'] | UpdateDownloadedEvent['releaseNotes']): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return value
    .map((entry) => `${entry.version}: ${entry.note}`)
    .join('\n\n');
}

function formatUpdateError(error: Error | null): string {
  if (!error) {
    return 'App update failed.';
  }

  const message = error.message || String(error);

  if (message.includes('latest-linux.yml') && message.includes('404')) {
    return 'The latest published GitHub release does not include updater metadata yet. Publish 0.0.2-alpha or later with latest-linux.yml before using in-app updates.';
  }

  if (message.includes('latest-mac.yml') && message.includes('404')) {
    return 'The latest published GitHub release does not include macOS updater metadata yet. Publish a newer release with the generated update files.';
  }

  if (message.includes('latest.yml') && message.includes('404')) {
    return 'The latest published GitHub release does not include updater metadata yet. Publish a newer release with the generated update files.';
  }

  return message;
}

function createInitialState(): AppUpdateState {
  return {
    status: app.isPackaged ? 'idle' : 'unsupported',
    currentVersion: app.getVersion(),
    availableVersion: null,
    downloadedVersion: null,
    releaseName: null,
    releaseNotes: null,
    progressPercent: null,
    bytesPerSecond: null,
    transferredBytes: null,
    totalBytes: null,
    lastCheckedAt: null,
    message: app.isPackaged ? null : 'Updates are only available in packaged builds.'
  };
}

export class AppUpdateManager {
  private readonly autoUpdater: AppUpdater;
  private state: AppUpdateState = createInitialState();
  private readonly listeners = new Set<(state: AppUpdateState) => void>();

  constructor() {
    const { autoUpdater } = electronUpdater;
    this.autoUpdater = autoUpdater;

    if (!app.isPackaged) {
      return;
    }

    const prereleaseChannel = app.getVersion().split('-')[1]?.split('.')[0];
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;
    this.autoUpdater.allowPrerelease = Boolean(prereleaseChannel);

    if (prereleaseChannel) {
      this.autoUpdater.channel = prereleaseChannel;
    }

    this.autoUpdater.on('checking-for-update', () => {
      this.setState({
        status: 'checking',
        availableVersion: null,
        downloadedVersion: null,
        releaseName: null,
        releaseNotes: null,
        progressPercent: null,
        bytesPerSecond: null,
        transferredBytes: null,
        totalBytes: null,
        lastCheckedAt: new Date().toISOString(),
        message: 'Checking GitHub Releases for an update.'
      });
    });

    this.autoUpdater.on('update-available', (info) => {
      this.setState({
        status: 'available',
        availableVersion: info.version,
        downloadedVersion: null,
        releaseName: info.releaseName ?? null,
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        progressPercent: null,
        bytesPerSecond: null,
        transferredBytes: null,
        totalBytes: null,
        message: `Version ${info.version} is available.`
      });
    });

    this.autoUpdater.on('update-not-available', (info) => {
      this.setState({
        status: 'not-available',
        availableVersion: null,
        downloadedVersion: null,
        releaseName: info.releaseName ?? null,
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        progressPercent: null,
        bytesPerSecond: null,
        transferredBytes: null,
        totalBytes: null,
        message: `You are up to date on ${this.state.currentVersion}.`
      });
    });

    this.autoUpdater.on('download-progress', (progress) => {
      this.applyProgress(progress);
    });

    this.autoUpdater.on('update-downloaded', (info) => {
      this.setState({
        status: 'downloaded',
        downloadedVersion: info.version,
        availableVersion: info.version,
        releaseName: info.releaseName ?? null,
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        progressPercent: 100,
        transferredBytes: this.state.totalBytes,
        message: `Version ${info.version} is ready to install.`
      });
    });

    this.autoUpdater.on('error', (error) => {
      this.setState({
        status: 'error',
        message: formatUpdateError(error)
      });
    });
  }

  getState(): AppUpdateState {
    return this.state;
  }

  onStateChange(listener: (state: AppUpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async checkForUpdates(): Promise<AppUpdateState> {
    if (!app.isPackaged) {
      this.setState({
        status: 'unsupported',
        message: 'Updates are only available in packaged builds.'
      });
      return this.state;
    }

    await this.autoUpdater.checkForUpdates();
    return this.state;
  }

  async downloadUpdate(): Promise<AppUpdateState> {
    if (!app.isPackaged) {
      this.setState({
        status: 'unsupported',
        message: 'Updates are only available in packaged builds.'
      });
      return this.state;
    }

    if (this.state.status !== 'available' && this.state.status !== 'downloading') {
      throw new Error('No downloaded update is available to fetch yet.');
    }

    this.setState({
      status: 'downloading',
      progressPercent: 0,
      bytesPerSecond: null,
      transferredBytes: 0,
      totalBytes: null,
      message: `Downloading ${this.state.availableVersion ?? 'the update'}.`
    });

    await this.autoUpdater.downloadUpdate();
    return this.state;
  }

  installUpdate(): void {
    if (!app.isPackaged) {
      throw new Error('Updates are only available in packaged builds.');
    }

    if (this.state.status !== 'downloaded') {
      throw new Error('No downloaded update is ready to install.');
    }

    this.autoUpdater.quitAndInstall();
  }

  private applyProgress(progress: ProgressInfo): void {
    this.setState({
      status: 'downloading',
      progressPercent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferredBytes: progress.transferred,
      totalBytes: progress.total,
      message: `Downloading ${this.state.availableVersion ?? 'update'} (${Math.round(progress.percent)}%).`
    });
  }

  private setState(patch: Partial<AppUpdateState>): void {
    this.state = {
      ...this.state,
      ...patch
    };

    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
