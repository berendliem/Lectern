import type { Metadata } from "next";
import { DictionaryManager } from "@/components/dictionary/DictionaryManager";

export const metadata: Metadata = { title: "Dictionary — AI Notetaker" };

export default function DictionaryPage() {
  return <DictionaryManager />;
}
