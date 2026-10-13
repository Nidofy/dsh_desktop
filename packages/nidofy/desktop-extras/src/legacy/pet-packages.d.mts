import type { StorageService } from '../storage.ts'
export function packageCommand(options: { home: string; resources: string; action: string; source?: string; expected?: string; replace?: boolean; resourceId?: string; destination?: string; storage?: StorageService }): Promise<unknown>
