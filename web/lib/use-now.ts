"use client";

import { useEffect, useState } from "react";

/** Current time in ms, refreshed on an interval. 0 until mounted, so server and client render the same. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [everyMs]);
  return now;
}
