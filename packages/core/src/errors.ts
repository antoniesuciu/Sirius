/** Errors the API reports on purpose. Anything else is a bug and becomes a 500. */
export class DomainError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what: string) => new DomainError(404, 'not_found', `${what} not found`);

export const requiresProposal = (reason: string) =>
  new DomainError(403, 'requires_proposal', `${reason} Use propose_changes instead.`);

export const forbidden = (message: string) => new DomainError(403, 'forbidden', message);

export const conflict = (message: string) => new DomainError(409, 'conflict', message);
