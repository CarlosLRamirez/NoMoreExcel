import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/auth";

const links = [
  { to: "/", label: "Resumen", end: true },
  { to: "/movimientos", label: "Movimientos" },
  { to: "/presupuesto", label: "Presupuesto" },
  { to: "/cuentas", label: "Cuentas" },
  { to: "/categorias", label: "Categorías" },
  { to: "/reportes", label: "Reportes" },
  { to: "/ajustes", label: "Ajustes" },
];

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="app">
      <aside className="sidebar">
        <h1>💰 NoMoreExcel</h1>
        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <div className="muted">{user?.nombre || user?.email}</div>
        <button className="link" onClick={logout} style={{ textAlign: "left" }}>
          Cerrar sesión
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
