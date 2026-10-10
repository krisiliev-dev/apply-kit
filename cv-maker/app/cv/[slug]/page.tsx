import { Editor } from "@/components/editor/Editor";

export default async function CvEditorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <Editor slug={slug} />;
}
