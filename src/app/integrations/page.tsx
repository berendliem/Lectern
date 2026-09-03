import type { Metadata } from "next";
import { IntegrationsManager } from "@/components/integrations/IntegrationsManager";

export const metadata: Metadata = { title: "Integrations — Lectern" };

export default function IntegrationsPage() {
  return <IntegrationsManager />;
}
