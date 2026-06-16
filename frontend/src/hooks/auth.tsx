import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { pb } from "../lib/pb";
import type { Usuario } from "../lib/types";

interface AuthCtx {
  user: Usuario | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nombre: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(
    (pb.authStore.record as unknown as Usuario) ?? null
  );

  useEffect(() => {
    return pb.authStore.onChange(() => {
      setUser((pb.authStore.record as unknown as Usuario) ?? null);
    });
  }, []);

  const login = async (email: string, password: string) => {
    await pb.collection("users").authWithPassword(email, password);
  };

  const register = async (email: string, password: string, nombre: string) => {
    await pb.collection("users").create({
      email,
      password,
      passwordConfirm: password,
      nombre,
    });
    await pb.collection("users").authWithPassword(email, password);
  };

  const logout = () => pb.authStore.clear();

  return <Ctx.Provider value={{ user, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
