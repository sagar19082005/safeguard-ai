import { createContext, useContext, useEffect, useState } from "react";
import { api, token } from "./api";

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token.get()) return setReady(true);
    api("/auth/me").then(setUser).catch(() => token.clear()).finally(() => setReady(true));
  }, []);

  const finish = (r) => { token.set(r.access_token); setUser(r.user); };
  const login = async (email, password) =>
    finish(await api("/auth/login", { method: "POST", form: new URLSearchParams({ username: email, password }) }));
  const register = async (payload) => finish(await api("/auth/register", { method: "POST", body: payload }));
  const logout = () => { token.clear(); setUser(null); };

  return <Ctx.Provider value={{ user, ready, login, register, logout }}>{children}</Ctx.Provider>;
}
