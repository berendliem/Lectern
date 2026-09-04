import { db } from "@/lib/db";
import { PomodoroTimer } from "@/components/focus/PomodoroTimer";

export const metadata = { title: "Focus — Lectern" };
export const dynamic = "force-dynamic";

export default async function FocusPage({
  searchParams,
}: {
  searchParams: Promise<{ pageId?: string }>;
}) {
  const { pageId } = await searchParams;
  const page = pageId
    ? await db.page.findUnique({ where: { id: pageId }, select: { id: true, title: true } })
    : null;

  return <PomodoroTimer lecture={page ?? undefined} />;
}
