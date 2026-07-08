"use client";

import { Suspense } from "react";
import { TasksSection } from "@/components/settings/TasksSection";

export default function SettingsTasksPage() {
  // useSearchParams (used inside TasksSection for ?focus=…) needs a
  // Suspense boundary in App Router; without it the page would error
  // when the URL has any search params at all.
  return (
    <Suspense fallback={null}>
      <TasksSection />
    </Suspense>
  );
}
