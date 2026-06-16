import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/auth";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Cuentas } from "./pages/Cuentas";
import { Categorias } from "./pages/Categorias";
import { Movimientos } from "./pages/Movimientos";
import { Reportes } from "./pages/Reportes";
import { Presupuesto } from "./pages/Presupuesto";
import { Ajustes } from "./pages/Ajustes";

export default function App() {
  const { user } = useAuth();

  if (!user) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="/movimientos" element={<Movimientos />} />
        <Route path="/cuentas" element={<Cuentas />} />
        <Route path="/categorias" element={<Categorias />} />
        <Route path="/presupuesto" element={<Presupuesto />} />
        <Route path="/reportes" element={<Reportes />} />
        <Route path="/ajustes" element={<Ajustes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
