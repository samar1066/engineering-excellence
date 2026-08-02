/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the notes API. Defaults to /api, which the dev server proxies. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
