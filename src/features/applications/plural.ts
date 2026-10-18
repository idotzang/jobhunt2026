// Throwaway module for exercising the factory fix loop.
export function pluralizeApplications(n: number): string {
  return n === 1 ? "1 application" : `${n} applications`;
}
