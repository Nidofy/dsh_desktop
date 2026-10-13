import type {ServerResponse} from 'node:http'
export class DesktopArtifacts {
  constructor(home: string)
  register(path: string, file: string): Promise<unknown>
  list(path: string): Promise<unknown[]>
  describe(path: string,file: string,metadata?: Record<string,unknown>): Promise<Record<string,unknown>>
  observeRun(workspace: string,path: string): Promise<{path: string; observation: 'observed-after-run' | 'missing' | 'unknown'; digest: string | null; bytes: number | null}>
  resolveLease(id: string): Promise<{target: string; path: string; fingerprint: string}>
  download(id: string,response: ServerResponse,signal?: AbortSignal): Promise<void>
}
