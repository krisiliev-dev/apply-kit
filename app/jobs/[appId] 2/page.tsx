import { JobDetailView } from "./JobDetailView";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;
  return <JobDetailView appId={appId} />;
}
