import { PageCard, type PageCardData } from "@/components/dashboard/PageCard";

export function PageList({ pages }: { pages: PageCardData[] }) {
  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 py-16 text-center">
        <p className="text-slate-500">No pages yet.</p>
        <p className="text-sm text-slate-400">Create a page to start recording a lecture.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((page) => (
        <PageCard key={page.id} page={page} />
      ))}
    </div>
  );
}
