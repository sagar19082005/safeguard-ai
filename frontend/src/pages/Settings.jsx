import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

const blankUser = { email: "", full_name: "", password: "", role: "viewer" };

export default function Settings() {
  const { user } = useAuth();
  const [passwords, setPasswords] = useState({ current_password: "", new_password: "" });
  const [newUser, setNewUser] = useState(blankUser);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isAdmin = user.role === "admin";

  const loadAdminData = () => Promise.all([api("/users"), api("/users/audit-logs")]).then(([u, l]) => { setUsers(u); setLogs(l); }).catch((e) => setError(e.message));
  useEffect(() => { if (isAdmin) loadAdminData(); }, [isAdmin]);
  const changePassword = async (event) => {
    event.preventDefault();
    try { await api("/auth/change-password", { method: "POST", body: passwords }); setPasswords({ current_password: "", new_password: "" }); setMessage("Password changed."); setError(""); }
    catch (e) { setError(e.message); }
  };
  const createUser = async (event) => {
    event.preventDefault();
    try { await api("/users", { method: "POST", body: newUser }); setNewUser(blankUser); setMessage("User created."); loadAdminData(); }
    catch (e) { setError(e.message); }
  };
  const toggleUser = async (item) => {
    try { await api(`/users/${item.id}`, { method: "PATCH", body: { full_name: item.full_name, role: item.role, is_active: !item.is_active } }); loadAdminData(); }
    catch (e) { setError(e.message); }
  };
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold">Settings and access</h1><p className="mt-1 text-sm text-muted">Secure account settings and role-based organization access.</p></div>
    {message && <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}
    <form onSubmit={changePassword} className="max-w-xl rounded border border-line bg-surface p-5"><h2 className="font-medium">Change password</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><input className="field" type="password" placeholder="Current password" required value={passwords.current_password} onChange={(e) => setPasswords({ ...passwords, current_password: e.target.value })} /><input className="field" type="password" minLength="10" placeholder="New password (10+ characters)" required value={passwords.new_password} onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })} /></div><button className="btn mt-3">Update password</button></form>
    {isAdmin ? <><form onSubmit={createUser} className="rounded border border-line bg-surface p-5"><h2 className="font-medium">Create organization user</h2><div className="mt-3 grid gap-3 md:grid-cols-4"><input className="field" type="email" placeholder="Email" required value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /><input className="field" placeholder="Full name" required value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} /><input className="field" type="password" minLength="10" placeholder="Temporary password" required value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} /><select className="field" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}><option value="viewer">Viewer</option><option value="safety_officer">Safety officer</option><option value="admin">Admin</option></select></div><button className="btn mt-3">Create user</button></form>
      <section className="rounded border border-line bg-surface p-5"><h2 className="font-medium">Organization users</h2><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-line text-xs text-muted"><tr><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Role</th><th className="p-2">Status</th><th className="p-2" /></tr></thead><tbody>{users.map((item) => <tr key={item.id} className="border-b border-line last:border-0"><td className="p-2">{item.full_name}</td><td className="p-2">{item.email}</td><td className="p-2 capitalize">{item.role.replace("_", " ")}</td><td className="p-2">{item.is_active ? "Active" : "Inactive"}</td><td className="p-2 text-right">{item.id !== user.id && <button className="text-xs text-accent hover:underline" onClick={() => toggleUser(item)}>{item.is_active ? "Deactivate" : "Activate"}</button>}</td></tr>)}</tbody></table></div></section>
      <section className="rounded border border-line bg-surface p-5"><h2 className="font-medium">Audit log</h2><div className="mt-3 max-h-72 overflow-auto text-sm">{logs.map((item) => <div key={item.id} className="flex justify-between gap-3 border-b border-line py-2"><span>{item.action} · {item.actor}</span><span className="text-xs text-muted">{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</span></div>)}</div></section>
    </> : <p className="rounded border border-line bg-surface p-5 text-sm text-muted">Only organization administrators can manage users and view audit logs.</p>}
  </div>;
}
