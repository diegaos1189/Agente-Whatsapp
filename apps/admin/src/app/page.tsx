import { Suspense } from "react";
import { LandingContent } from "./LandingContent";

export const dynamic = "force-dynamic";

export default function LandingPage() {
  return (
    <Suspense fallback={null}>
      <LandingContent />
    </Suspense>
  );
}
