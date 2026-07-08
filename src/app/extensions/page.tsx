"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";

function ExtensionsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  useEffect(() => {
    router.replace(tab === "mcp" ? "/plugins#mcp" : "/plugins#skills");
  }, [router, tab]);

  return null;
}

export default function ExtensionsPage() {
  return (
    <Suspense fallback={null}>
      <ExtensionsRedirect />
    </Suspense>
  );
}
