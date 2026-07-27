"use client";

import { useEffect, useState } from "react";
import { SpinnerGap } from "@/components/ui/icon";

export function PdfViewer({ bytes, title }: { bytes: Uint8Array<ArrayBuffer>; title: string }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const nextUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [bytes]);

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <iframe
      src={`${url}#view=FitH`}
      title={title}
      className="h-full w-full border-0 bg-white"
    />
  );
}
