import { useLocation } from "react-router-dom";
import { NAV } from "../nav";

export default function Planned() {
  const { pathname } = useLocation();
  const item = NAV.flatMap((g) => g.items).find((i) => i.to === pathname);
  if (!item) return <p className="text-muted">Page not found.</p>;
  return (
    <div>
      <h1 className="text-xl font-semibold">{item.label}</h1>
      <div className="mt-6 max-w-xl rounded border border-dashed border-line bg-surface p-6">
        <p className="font-medium">This module is built in Phase {item.phase}.</p>
        <p className="mt-1 text-sm text-muted">{item.desc}</p>
      </div>
    </div>
  );
}
