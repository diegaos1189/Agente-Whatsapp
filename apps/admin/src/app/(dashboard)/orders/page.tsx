import { OrdersView } from "./View";

/** Panel del restaurante de este deployment. La pantalla vive en View.tsx, compartida con /<slug>. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <OrdersView searchParams={searchParams as never} />;
}
