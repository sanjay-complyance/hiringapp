import { HiringWorkspace } from "@/app/workspace";
import { getAppData, getPublicAppData } from "@/lib/app-data";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const initialUser = await getSessionUserFromCookieHeader(requestHeaders.get("cookie"));
  const data = initialUser ? await getAppData() : await getPublicAppData();
  return <HiringWorkspace data={data} initialUser={initialUser} />;
}
