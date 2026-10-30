// Tema visual por dispositivo (preferencia local, no se sincroniza entre equipos).
// "auto" sigue el tema del sistema. El valor inicial lo aplica index.html antes de
// renderizar para evitar un parpadeo claro al abrir.

export type Tema = "dark" | "light" | "auto";
const KEY = "nme_tema";
const DEFAULT: Tema = "dark";

export function getTema(): Tema {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" || v === "auto" ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setTema(t: Tema) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // sin almacenamiento (modo privado): se aplica solo en esta sesión
  }
  aplicarTema(t);
}

export function aplicarTema(t: Tema = getTema()) {
  document.documentElement.dataset.theme = t;
  // Color de la barra de estado (PWA / navegador móvil) = fondo del tema efectivo.
  const oscuro = t === "dark" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", oscuro ? "#161b22" : "#f6f7f9");
}
