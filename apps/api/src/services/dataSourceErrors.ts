export class DataSourceSetupError extends Error {
  override readonly name = 'DataSourceSetupError';
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}
