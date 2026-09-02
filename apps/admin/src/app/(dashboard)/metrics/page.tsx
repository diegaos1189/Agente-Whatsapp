import { MetricsView } from "./View";

/** Panel del restaurante de este deployment. La pantalla vive en View.tsx, compartida con /<slug>. */
export default async function Page() {
  return <MetricsView />;
}
