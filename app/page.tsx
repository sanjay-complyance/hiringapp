import { HiringWorkspace } from "@/app/workspace";
import { getAppData } from "@/lib/app-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getAppData();
  return <HiringWorkspace data={data} />;
}
