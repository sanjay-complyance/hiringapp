"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function SyncWatcher() {
  const router = useRouter();
  const cursor = useRef(0);
  const [state, setState] = useState<"connecting" | "live" | "updating" | "offline">("connecting");

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll(initial = false) {
      if (stopped || (!initial && document.hidden)) {
        timer = setTimeout(() => void poll(), 3500);
        return;
      }
      try {
        const response = await fetch(initial ? "/api/events?latest=1" : `/api/events?since=${cursor.current}`, { cache: "no-store" });
        if (!response.ok) throw new Error("sync failed");
        const body = await response.json() as { cursor: number; events: unknown[] };
        if (stopped) return;
        cursor.current = body.cursor;
        if (!initial && body.events.length) {
          setState("updating");
          router.refresh();
        }
        setState("live");
      } catch {
        if (!stopped) setState("offline");
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 3500);
      }
    }

    void poll(true);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [router]);

  return <span className={`sync-indicator ${state}`}><i />{state === "updating" ? "Updating" : state === "offline" ? "Offline" : "Live"}</span>;
}
