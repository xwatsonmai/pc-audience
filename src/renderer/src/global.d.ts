import type { AudienceApi } from "../../preload";

declare global {
  interface Window {
    audience: AudienceApi;
  }
}

export {};
