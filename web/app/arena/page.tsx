import { Suspense } from "react";
import { ArenaView } from "@/components/ArenaView";

export default function Page() {
  return (
    <Suspense>
      <ArenaView />
    </Suspense>
  );
}
