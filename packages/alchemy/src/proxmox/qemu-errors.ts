/** A QEMU write or observation this provider will not turn into a create or a delete. */
export class QemuRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QemuRefusedError';
  }
}
