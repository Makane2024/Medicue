export class ApiError extends Error {
  constructor(
    public status: number,
    msg: string,
  ) {
    super(msg)
  }
}
