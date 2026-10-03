import { DomainError } from '../../domain/domain-error.js';

export function classifyFailure(error: unknown): 'permanent' | 'transient' {
  if (error instanceof DomainError) return 'permanent';
  const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return /^(22|23|42)/.test(code) ? 'permanent' : 'transient';
}
export function retryDelaySeconds(attempt: number): number { return Math.min(60, 2 ** Math.min(Math.max(attempt - 1, 0), 6)); }
