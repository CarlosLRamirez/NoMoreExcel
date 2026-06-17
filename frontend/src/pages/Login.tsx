import { useState, type FormEvent } from "react";
import { useAuth } from "../hooks/auth";

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "No se pudo iniciar sesión. Revisa tus datos."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h2>Iniciar sesión</h2>
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label>Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy} style={{ width: "100%" }}>
          {busy ? "..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
