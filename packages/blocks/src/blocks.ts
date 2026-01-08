export class UnsupportedBlockTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedBlockTypeError'
  }
}
