export function applicationCountLabel(count: number): string {
  return `${count} ${count === 1 ? "application" : "applications"}`;
}
