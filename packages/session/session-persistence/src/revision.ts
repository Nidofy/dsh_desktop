/** Opaque revision identity for lightweight persistence observations. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Persistent identity of one physical log incarnation, stable across appends and process restarts. */
export type SessionPersistenceGeneration = Branded<'SessionPersistenceGeneration'>

/** Brand a provider-owned physical identity; format versions and cache revisions are not identities.
 * @param value - persistent provider representation of one physical log incarnation.
 * @returns the opaque generation token.
 */
export function SessionPersistenceGeneration(value: string): SessionPersistenceGeneration {
  return value as SessionPersistenceGeneration
}

/**
 * Backend-owned token that identifies both one storage source and one revision
 * of a persisted session log.
 */
export type SessionPersistenceRevision = Branded<'SessionPersistenceRevision'>

/**
 * Brand a backend revision for the provider-neutral persistence contract.
 * @param value - backend-owned opaque revision representation.
 * @returns the same runtime string with persistence-revision identity.
 */
export function SessionPersistenceRevision(value: string): SessionPersistenceRevision {
  return value as SessionPersistenceRevision
}
