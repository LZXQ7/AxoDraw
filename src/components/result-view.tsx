export function ResultRow({ index, item }: { index: number; item: string }) {
  return (
    <div
      style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
      className="animate-fade-in flex min-w-0 items-center gap-3 px-4 py-3"
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-2xl bg-muted font-mono text-[10px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{item}</span>
    </div>
  );
}

export function ResultList({ items }: { items: string[] }) {
  return (
    <div className="divide-y rounded-2xl border">
      {items.map((item, index) => (
        <ResultRow key={item + "-" + index} index={index} item={item} />
      ))}
    </div>
  );
}

export function GroupCards({ groups }: { groups: string[][] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="overflow-hidden rounded-2xl border">
          <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
            <span className="text-sm font-medium">第 {groupIndex + 1} 组</span>
            <span className="font-mono text-xs text-muted-foreground">{group.length} 人</span>
          </div>
          <div className="divide-y">
            {group.map((item, index) => (
              <ResultRow key={item + "-" + index} index={index} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
