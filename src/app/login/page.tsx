import { Suspense } from "react";

import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-8">
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:32px_32px]" />
      <section className="relative w-full max-w-[440px] rounded-lg border border-border/70 bg-card p-6 shadow-lg sm:p-8" aria-labelledby="login-title">
        <Suspense fallback={null}><LoginForm /></Suspense>
      </section>
    </main>
  );
}
