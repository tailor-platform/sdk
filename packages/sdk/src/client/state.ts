export type Fetch = typeof globalThis.fetch;

interface ClientState {
  getUrl?: () => string;
  defaultUrl?: string;
  fetch?: Fetch;
}

export const state: ClientState = {};

export function resetResolverClient(): void {
  delete state.getUrl;
  delete state.defaultUrl;
  delete state.fetch;
}
