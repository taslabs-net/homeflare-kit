/** A `Proxmox.StorageDownload` write or observation this provider will not turn into a claim of success. */
export class StorageDownloadRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageDownloadRefusedError';
  }
}
