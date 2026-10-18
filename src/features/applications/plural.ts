// Throwaway module for exercising the factory fix loop.
export function pluralizeApplications(n: number): string {
  // BUG (deliberate): the singular case is missing.
  return `${n} applications`;
}
