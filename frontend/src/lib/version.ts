// Versión de la build desplegada (ver `define` en vite.config.ts).
export const APP_VERSION = __APP_VERSION__;
export const APP_COMMIT = __APP_COMMIT__;
export const APP_BUILD_DATE = __APP_BUILD_DATE__;
export const versionLabel = `v${APP_VERSION} · ${APP_COMMIT}`;
