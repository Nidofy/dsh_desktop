/** Exact DACL and mandatory-label snapshots; owner, group and audit ACEs are never written. */
import { parse, resolve, sep } from 'node:path'
import { allocPtrSlot, copyNativeBytes, decodePtr, decodeUint16At, isInvalidHandle, isNullPtr, ptrAddress, throwLastError, throwWin32 } from './ffi.ts'
import type { NativePtr, Win32Bindings } from './ffi.ts'
import * as abi from './win32-abi.ts'

/** Persisted security information owned by the write grant. */
export interface SecurityState {
  dacl: string | null
  label: string | null
  control: number
}

/** Identity-checked filesystem handle; security reads and writes use this same object. */
export interface SecurityObject {
  handle: NativePtr
  identity: string
  directory: boolean
  writable: boolean
}

/** Open each path component without following reparse points and retain the target identity.
 * @param api - Win32 calls.
 * @param path - absolute filesystem path.
 * @param action - operation using the final handle.
 * @param accessMode - read snapshots need no security mutation rights.
 * @returns the operation's result.
 */
export function withSecurityObject<T>(api: Win32Bindings, path: string, action: (object: SecurityObject) => T, accessMode: 'read' | 'write' = 'write'): T {
  const absolute = resolve(path)
  const volume = parse(absolute).root
  const parts = absolute.slice(volume.length).split(sep).filter(Boolean)
  const handles: NativePtr[] = []
  let current = volume
  let object: SecurityObject | undefined
  let primary: unknown
  let failed = false
  try {
    for (const part of ['', ...parts]) {
      if (part !== '') current = current.endsWith(sep) ? current + part : current + sep + part
      const access = current === absolute ? (accessMode === 'read' ? 0x20080 : 0xE0080) : 0x80
      let handle: NativePtr
      if (part === '') {
        handle = api.createFileW(volume, access, abi.FILE_SHARE_READ | abi.FILE_SHARE_WRITE, null, 3, 0x02200000, null)
      } else {
        // Resolve one name relative to the already-open parent. POSIX rename can
        // bypass delete sharing, so reopening absolute descendant paths is unsafe.
        const name = Buffer.from(`${part}\0`, 'utf16le')
        const unicode = Buffer.alloc(16)
        unicode.writeUInt16LE(name.length - 2, 0)
        unicode.writeUInt16LE(name.length, 2)
        unicode.writeBigUInt64LE(ptrAddress(name), 8)
        const attributes = Buffer.alloc(48)
        attributes.writeUInt32LE(48, 0)
        const parent = handles[handles.length - 1]
        if (parent === undefined) throw new Error(`Missing fixed parent handle: ${current}`)
        attributes.writeBigUInt64LE(ptrAddress(parent), 8)
        attributes.writeBigUInt64LE(ptrAddress(unicode), 16)
        attributes.writeUInt32LE(0x40, 24)
        const slot = allocPtrSlot()
        const status = api.ntOpenFile(slot, access, attributes, Buffer.alloc(16), abi.FILE_SHARE_READ | abi.FILE_SHARE_WRITE, 0x00204000)
        if (status < 0) throwWin32(api, 'NtOpenFile', api.rtlNtStatusToDosError(status), current)
        const opened = decodePtr(slot)
        if (opened === null) throw new Error(`NtOpenFile returned no object: ${current}`)
        handle = opened
      }
      if (isInvalidHandle(handle)) throwLastError(api, 'CreateFileW', current)
      handles.push(handle)
      const info = Buffer.alloc(52)
      if (api.getFileInformationByHandle(handle, info) === 0) throwLastError(api, 'GetFileInformationByHandle', current)
      if ((info.readUInt32LE(0) & 0x400) !== 0) throw new Error(`Windows ACL recovery refuses a reparse path: ${current}`)
      object = { handle, writable: accessMode === 'write', directory: (info.readUInt32LE(0) & 0x10) !== 0,
        identity: `${info.readUInt32LE(28)}:${info.readUInt32LE(44)}:${info.readUInt32LE(48)}:${info.readBigUInt64LE(4)}` }
    }
    if (object === undefined) throw new Error(`No filesystem object: ${path}`)
    return action(object)
  } catch (error) {
    primary = error
    failed = true
    throw error
  } finally {
    const failures: unknown[] = []
    for (const handle of handles.reverse()) {
      try {
        if (api.closeHandle(handle) === 0) throwLastError(api, 'CloseHandle', path)
      } catch (error) { failures.push(error) }
    }
    if (failures.length > 0) throw new AggregateError(failed ? [primary, ...failures] : failures, `Windows security handle cleanup failed: ${path}`)
  }
}

const INHERITED = 0x10
// SACL_PRESENT/DEFAULTED describe the entire audit ACL, which LABEL_SECURITY_INFORMATION
// neither reads nor owns. Windows can retain an empty SACL after its last label is removed.
const CONTROL = 0x3F0C
const LOW_SID = Buffer.from('010100000000001000100000', 'hex')
const WORLD_SID = Buffer.from('010100000000000100000000', 'hex')

function entries(encoded: string | null): Buffer[] {
  if (encoded === null) return []
  const acl = Buffer.from(encoded, 'base64')
  if (acl.length < 8 || acl.readUInt16LE(2) !== acl.length) throw new Error('Invalid recovery ACL length')
  const result: Buffer[] = []
  let offset = 8
  for (let index = 0; index < acl.readUInt16LE(4); index++) {
    if (offset + 4 > acl.length) throw new Error('Truncated recovery ACE')
    const size = acl.readUInt16LE(offset + 2)
    if (size < 4 || offset + size > acl.length) throw new Error('Invalid recovery ACE length')
    result.push(acl.subarray(offset, offset + size))
    offset += size
  }
  return result
}

function pack(aces: readonly Buffer[], original: string | null = null): string {
  const size = 8 + aces.reduce((sum, ace) => sum + ace.length, 0)
  if (size > 65_535) throw new Error('Recovery ACL exceeds the Windows ACL size limit')
  const header = Buffer.alloc(8)
  header[0] = original === null ? 2 : Buffer.from(original, 'base64').readUInt8(0)
  header.writeUInt16LE(size, 2)
  header.writeUInt16LE(aces.length, 4)
  return Buffer.concat([header, ...aces]).toString('base64')
}

function nativeAcl(pointer: NativePtr | null): string | null {
  if (pointer === null) return null
  const length = decodeUint16At(pointer, 2)
  if (length < 8) throw new Error('Windows returned a malformed ACL')
  const encoded = copyNativeBytes(pointer, length).toString('base64')
  return pack(entries(encoded), encoded)
}

/** Read only the security information that grants may change.
 * @param api - Win32 calls.
 * @param path - existing filesystem object.
 * @param object - Optional held identity-checked handle; read access is sufficient.
 * @returns independently owned ACL bytes and inheritance controls.
 */
export function readSecurityState(api: Win32Bindings, path: string, object?: SecurityObject): SecurityState {
  if (object === undefined) return withSecurityObject(api, path, held => readSecurityState(api, path, held), 'read')
  const dacl = allocPtrSlot()
  const label = allocPtrSlot()
  const descriptor = allocPtrSlot()
  const result = api.getSecurityInfo(object.handle, abi.SE_FILE_OBJECT,
    abi.DACL_SECURITY_INFORMATION | abi.LABEL_SECURITY_INFORMATION,
    allocPtrSlot(), allocPtrSlot(), dacl, label, descriptor)
  if (result !== abi.ERROR_SUCCESS) throwWin32(api, 'GetNamedSecurityInfoW', result, path)
  const allocation = decodePtr(descriptor)
  if (allocation === null) throw new Error(`Missing security descriptor: ${path}`)
  try {
    return {
      dacl: nativeAcl(decodePtr(dacl)),
      label: nativeAcl(decodePtr(label)),
      control: decodeUint16At(allocation, 2) & CONTROL,
    }
  } finally {
    if (!isNullPtr(api.localFree(allocation))) throwLastError(api, 'LocalFree', path)
  }
}

/** Write one object's DACL and label without propagating onto unsnapshotted descendants.
 * @param api - Win32 calls.
 * @param path - identity-checked filesystem object.
 * @param state - saved or prepared security information.
 * @param object - Optional held writable identity-checked handle; read-only handles are refused.
 */
export function writeSecurityState(api: Win32Bindings, path: string, state: SecurityState, object?: SecurityObject): void {
  if (object === undefined) {
    withSecurityObject(api, path, (held) => { writeSecurityState(api, path, state, held) })
    return
  }
  if (!object.writable) throw new Error(`Security snapshot handle cannot write: ${path}`)
  const dacl = state.dacl === null ? null : Buffer.from(state.dacl, 'base64')
  const label = state.label === null ? null : Buffer.from(state.label, 'base64')
  entries(state.dacl)
  entries(state.label)
  const descriptor = Buffer.alloc(20)
  descriptor[0] = 1
  descriptor.writeUInt16LE(state.control | 0x8000 | (label === null ? 0 : 0x10)
    | ((state.control & 0x400) !== 0 ? 0x100 : 0) | ((state.control & 0x800) !== 0 ? 0x200 : 0), 2)
  if (label !== null) descriptor.writeUInt32LE(20, 12)
  if (dacl !== null) descriptor.writeUInt32LE(20 + (label?.length ?? 0), 16)
  const status = api.ntSetSecurityObject(object.handle, abi.DACL_SECURITY_INFORMATION | abi.LABEL_SECURITY_INFORMATION,
    Buffer.concat([descriptor, label ?? Buffer.alloc(0), dacl ?? Buffer.alloc(0)]))
  if (status < 0) throwWin32(api, 'NtSetSecurityObject', api.rtlNtStatusToDosError(status), path)
}

/** Compare the owned security fields, ignoring ACL allocator padding.
 * @param left - first snapshot.
 * @param right - second snapshot.
 * @returns whether all owned fields agree.
 */
export function sameSecurityState(left: SecurityState, right: SecurityState): boolean {
  return left.dacl === right.dacl && left.label === right.label && left.control === right.control
}

function sidBytes(sid: string): Buffer {
  if (!/^S-1-4-\d+-\d+(?:-1)?$/u.test(sid)) throw new Error(`Invalid workspace capability SID: ${sid}`)
  const values = sid.split('-').slice(3).map(Number)
  const bytes = Buffer.alloc(8 + 4 * values.length)
  bytes[0] = 1
  bytes[1] = values.length
  bytes[7] = 4
  values.forEach((value, index) => bytes.writeUInt32LE(value, 8 + index * 4))
  return bytes
}

function ace(type: number, flags: number, mask: number, sid: Buffer): Buffer {
  const bytes = Buffer.alloc(8 + sid.length)
  bytes[0] = type
  bytes[1] = flags
  bytes.writeUInt16LE(bytes.length, 2)
  bytes.writeUInt32LE(mask, 4)
  sid.copy(bytes, 8)
  return bytes
}

function capability(entry: Buffer): boolean {
  return entry[0] === abi.ACCESS_ALLOWED_ACE_TYPE && entry.length >= 20
    && entry[8] === 1 && entry.subarray(10, 16).equals(Buffer.from([0, 0, 0, 0, 0, 4]))
}

/** Prepare a grant without mutating files; refuse unbacked legacy grants.
 * @param before - original owned security fields.
 * @param sid - write capability.
 * @param directory - whether inheritance applies to future children.
 * @returns exact security fields to journal before applying.
 */
export function grantedSecurityState(before: SecurityState, sid: string, directory: boolean): SecurityState {
  if (before.dacl === null) throw new Error('Cannot safely grant a directory tree containing a null DACL')
  const original = entries(before.dacl)
  if (original.some(capability)) throw new Error('Legacy Windows sandbox grant has no recovery record; original permissions are unknown. Preserve the directory and use a verified pre-grant Windows permissions backup, or create a fresh workspace copy without copying security descriptors. The diagnosis skill preserves integrity labels and cannot reconstruct the missing backup.')
  const deny = ace(abi.ACCESS_DENIED_ACE_TYPE, abi.CONTAINER_INHERIT_ACE, abi.FILE_DELETE_CHILD, WORLD_SID)
  const grant = ace(abi.ACCESS_ALLOWED_ACE_TYPE, directory ? abi.SUB_CONTAINERS_AND_OBJECTS_INHERIT : 0,
    abi.GRANT_MASK, sidBytes(sid))
  const explicit = original.filter(entry => (entry.readUInt8(1) & INHERITED) === 0)
  const inherited = original.filter(entry => (entry.readUInt8(1) & INHERITED) !== 0)
  const denyEntries = directory && !original.some(entry => entry.equals(deny)) ? [deny] : []
  return {
    dacl: pack([...denyEntries, ...explicit, grant, ...inherited], before.dacl),
    label: pack([ace(abi.SYSTEM_MANDATORY_LABEL_ACE_TYPE, directory ? 3 : 0,
      abi.SYSTEM_MANDATORY_LABEL_NO_WRITE_UP, LOW_SID)]),
    control: before.control | 0x4,
  }
}

/** Remove this grant's inherited entries from an object created during its lease.
 * @param current - new object's observed security information.
 * @param sid - owning workspace capability.
 * @param parent - already restored parent's security information.
 * @param directory - whether this object is a directory.
 * @returns cleanup state preserving unrelated permissions and explicit non-Low labels.
 */
export function createdObjectSecurityState(current: SecurityState, sid: string, parent: SecurityState, directory: boolean): SecurityState {
  const ownSid = sidBytes(sid)
  const ownsGrant = entries(current.dacl).some(entry => entry[0] === abi.ACCESS_ALLOWED_ACE_TYPE && entry.subarray(8).equals(ownSid))
  const originalParentDeny = entries(parent.dacl).some(entry => entry[0] === abi.ACCESS_DENIED_ACE_TYPE
    && (entry.readUInt8(1) & abi.CONTAINER_INHERIT_ACE) !== 0 && entry.readUInt32LE(4) === abi.FILE_DELETE_CHILD
    && entry.subarray(8).equals(WORLD_SID))
  const remaining = entries(current.dacl).filter((entry) => {
    if (entry[0] === abi.ACCESS_ALLOWED_ACE_TYPE && entry.subarray(8).equals(ownSid)) {
      if (entry.readUInt32LE(4) !== abi.GRANT_MASK && entry.readUInt32LE(4) !== abi.FILE_ALL_ACCESS) {
        throw new Error('New object has a modified Windows sandbox capability; automatic recovery refused')
      }
      return false
    }
    return !(!originalParentDeny && entry[0] === abi.ACCESS_DENIED_ACE_TYPE && (entry.readUInt8(1) & INHERITED) !== 0
      && entry.readUInt32LE(4) === abi.FILE_DELETE_CHILD && entry.subarray(8).equals(WORLD_SID))
  })
  const labels = entries(current.label)
  const label = labels[0]
  const isOwnedLow = labels.length === 1 && label !== undefined && label[0] === abi.SYSTEM_MANDATORY_LABEL_ACE_TYPE
    && label.subarray(8).equals(LOW_SID) && label.readUInt32LE(4) === abi.SYSTEM_MANDATORY_LABEL_NO_WRITE_UP
  if (isOwnedLow && !ownsGrant) throw new Error('New object has a Low integrity label without an attributable workspace grant; automatic recovery refused')
  const inheritedLabels = entries(parent.label).filter(entry => (entry.readUInt8(1) & (directory ? 2 : 1)) !== 0).map((entry) => {
    const copy = Buffer.from(entry)
    copy[1] = directory ? copy.readUInt8(1) | INHERITED : INHERITED
    return copy
  })
  return {
    dacl: current.dacl === null ? null : pack(remaining, current.dacl),
    label: isOwnedLow ? (inheritedLabels.length === 0 ? null : pack(inheritedLabels)) : current.label,
    control: current.control,
  }
}

/** Validate the durable snapshot before it reaches Win32.
 * @param value - parsed JSON field.
 * @returns whether the value has valid ACL encoding and controls.
 */
export function isSecurityState(value: unknown): value is SecurityState {
  if (typeof value !== 'object' || value === null || !('dacl' in value) || !('label' in value) || !('control' in value)) return false
  if ((value.dacl !== null && typeof value.dacl !== 'string') || (value.label !== null && typeof value.label !== 'string')
    || typeof value.control !== 'number' || !Number.isInteger(value.control) || (value.control & ~CONTROL) !== 0) return false
  try {
    entries(value.dacl)
    entries(value.label)
    return true
  } catch {
    return false
  }
}

/** Refuse recovery storage writable by the confined Low-integrity token.
 * @param state - recovery directory security state.
 * @returns whether its label is implicit Medium or explicitly Medium/higher.
 */
export function isRecoveryStorageIntegrity(state: SecurityState): boolean {
  return entries(state.label).every(entry => entry[0] !== abi.SYSTEM_MANDATORY_LABEL_ACE_TYPE
    || (entry.length === 20 && entry.readUInt32LE(16) >= 8192
      && (entry.readUInt32LE(4) & abi.SYSTEM_MANDATORY_LABEL_NO_WRITE_UP) !== 0))
}
