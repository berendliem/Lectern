import type { Metadata } from "next";
import { IntegrationsManager } from "@/components/integrations/IntegrationsManager";

export const metadata: Metadata = { title: "Integrations — AI Notetaker" };

export default function IntegrationsPage() {
  return <IntegrationsManager />;
}
