import type { StorageService, QuotaLease } from '@nidofy/dsh-desktop-extras/storage'
export function installStorageAdmission(storage: StorageService): () => void
export const storageAdmission: {
  acquire(path: string, bytes: number, options?: { signal?: AbortSignal; terminalBytes?: number }): Promise<QuotaLease>
  write<T>(path: string, bytes: number, work: () => Promise<T>): Promise<T>
}
