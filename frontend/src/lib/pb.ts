import PocketBase from "pocketbase";

const url = import.meta.env.VITE_PB_URL || "http://127.0.0.1:8090";

export const pb = new PocketBase(url);

// Evita que peticiones concurrentes con la misma "clave" se cancelen entre sí
// (TanStack Query dispara varias a la vez).
pb.autoCancellation(false);
