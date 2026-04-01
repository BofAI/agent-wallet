export function stripHexPrefix(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value
}
