import { Agent, fetch as undiciFetch } from "undici";

export const OPENROUTER_CONNECT_TIMEOUT_MS = 20_000;

const openRouterDispatcher = new Agent({
  connect: { timeout: OPENROUTER_CONNECT_TIMEOUT_MS },
});

export function openRouterFetch(
  url: string,
  init: Parameters<typeof undiciFetch>[1] = {},
) {
  return undiciFetch(url, { ...init, dispatcher: openRouterDispatcher });
}
