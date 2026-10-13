import type { StorageService } from '../storage.ts'
export class MeasurementStore {
  close(): Promise<void>
  constructor(home: string, options?: { maxFiles?: number; maxBytes?: number; storage?: Pick<StorageService, 'write'> })
  list(): Promise<unknown>
  read(id: string): Promise<Record<string, unknown>>
  save(report: unknown): Promise<unknown>
}
