import { Suspense } from "react";
import { GachaView } from "@/components/GachaView";

export default function Page() {
  return (
    <Suspense>
      <GachaView />
    </Suspense>
  );
}
