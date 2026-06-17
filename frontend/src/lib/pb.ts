import PocketBase from "pocketbase";

// En desarrollo se usa VITE_PB_URL (.env). En producción PocketBase sirve el frontend
// y la API en el MISMO origen, así que usamos window.location.origin.
const url =
  import.meta.env.VITE_PB_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8090");

export const pb = new PocketBase(url);

// Evita que peticiones concurrentes con la misma "clave" se cancelen entre sí
// (TanStack Query dispara varias a la vez).
pb.autoCancellation(false);
