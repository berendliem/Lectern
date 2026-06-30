"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";

type Tag = { id: string; name: string };

export function TagEditor({ pageId, initialTags }: { pageId: string; initialTags: Tag[] }) {
  const [tags, setTags] = useState(initialTags);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [value, setValue] = useState("");
  const router = useRouter();

  useEffect(() => {
    let ignore = false;
    fetch("/api/tags")
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) setAllTags(data.tags ?? []);
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function addTag(name: string) {
    const trimmed = name.trim();
    if (!trimmed || tags.some((t) => t.name === trimmed)) return;
    setValue("");
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId, tagName: trimmed }),
    });
    if (res.ok) {
      const { tag } = await res.json();
      setTags((t) => [...t, tag]);
      router.refresh();
    }
  }

  async function removeTag(tagId: string) {
    setTags((t) => t.filter((tag) => tag.id !== tagId));
    await fetch(`/api/pages/${pageId}/tags/${tagId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <Badge key={tag.id} tone="blue" className="gap-1">
          #{tag.name}
          <button onClick={() => removeTag(tag.id)} aria-label={`Remove tag ${tag.name}`} className="hover:text-blue-900">
            ×
          </button>
        </Badge>
      ))}
      <Input
        list="tag-suggestions"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addTag(value);
          }
        }}
        placeholder="Add tag…"
        className="h-7 w-28 px-2 py-1 text-xs"
      />
      <datalist id="tag-suggestions">
        {allTags.map((tag) => (
          <option key={tag.id} value={tag.name} />
        ))}
      </datalist>
    </div>
  );
}
