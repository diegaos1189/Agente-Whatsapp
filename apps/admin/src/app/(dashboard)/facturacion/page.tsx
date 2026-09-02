import { FacturacionView } from "./View";

/** Panel del restaurante de este deployment. La pantalla vive en View.tsx, compartida con /<slug>. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <FacturacionView searchParams={searchParams as never} />;
}
