export class WorkspaceServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export type ServiceErrorCtor = new (message: string, statusCode: number) => WorkspaceServiceError;

export function isPermissionDenied(err: unknown): boolean {
  if (err != null && typeof err === 'object' && 'errorCode' in err) {
    return (err as { errorCode: unknown }).errorCode === 'PERMISSION_DENIED';
  }
  const message = err instanceof Error ? err.message : String(err);
  return /PERMISSION_DENIED|not authorized/i.test(message);
}

export function isNotFound(err: unknown): boolean {
  if (err != null && typeof err === 'object') {
    const errorCode = 'errorCode' in err ? (err as { errorCode: unknown }).errorCode : undefined;
    const status = 'status' in err ? (err as { status: unknown }).status : undefined;
    const statusCode =
      'statusCode' in err ? (err as { statusCode: unknown }).statusCode : undefined;
    if (errorCode === 'RESOURCE_DOES_NOT_EXIST' || status === 404 || statusCode === 404) {
      return true;
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return /RESOURCE_DOES_NOT_EXIST|not found|404/i.test(message);
}
