import { ConversationDetailView } from "./View";

/** Panel del restaurante de este deployment. La pantalla vive en View.tsx, compartida con /<slug>. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConversationDetailView conversationId={id} />;
}
