"use client";

import { Nav } from "./nav";

export function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <Nav />
      <main className="page-content">{children}</main>
    </div>
  );
}
