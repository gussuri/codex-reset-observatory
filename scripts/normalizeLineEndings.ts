export function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}
