"use client";

import { ChangeEvent, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Copy, Dices, Eraser, ListOrdered, Shuffle, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GroupCards, ResultList } from "@/components/result-view";
import { entries } from "@/lib/lottery";
import { shuffle, splitIntoGroups } from "@/lib/shuffle";

type SortResult = { order: string[]; groups?: string[][] };

const sampleItems = Array.from({ length: 8 }, (_, index) => `成员 ${String(index + 1).padStart(2, "0")}`).join("\n");

function formatResult(result: SortResult) {
  if (result.groups) {
    return result.groups
      .map((group, groupIndex) => `第 ${groupIndex + 1} 组\n${group.map((item) => `- ${item}`).join("\n")}`)
      .join("\n\n");
  }
  return result.order.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

export function ShuffleTool() {
  const [entriesText, setEntriesText] = useState("");
  const [groupCountText, setGroupCountText] = useState("");
  const [dedupe, setDedupe] = useState(false);
  const [result, setResult] = useState<SortResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const stats = useMemo(() => {
    const list = entries(entriesText);
    return { total: list.length, unique: new Set(list).size };
  }, [entriesText]);

  function updateEntries(value: string) {
    setEntriesText(value);
    setResult(null);
    setError("");
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateEntries(String(reader.result || ""));
    reader.readAsText(file);
  }

  function run() {
    const list = entries(entriesText);
    const items = dedupe ? [...new Set(list)] : list;
    if (items.length < 2) {
      setResult(null);
      setError("至少需要 2 条参与值");
      return;
    }
    const raw = groupCountText.trim();
    const groupCount = raw === "" ? 0 : Number(raw);
    if (groupCount !== 0 && (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > items.length)) {
      setResult(null);
      setError("分组数需在 2 与参与值数量之间");
      return;
    }
    setError("");
    setCopied(false);
    const order = shuffle(items);
    setResult({
      order,
      groups: groupCount >= 2 ? splitIntoGroups(order, groupCount) : undefined,
    });
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(formatResult(result));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择结果文本");
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-10 sm:px-6 lg:px-8 lg:pt-14">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Badge variant="secondary">本地即时</Badge>
              <span className="text-xs text-muted-foreground">无需发起、无需登录</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">随机排序</h1>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              把名单粘进来，点一下就打乱全部条目；填了分组数则先随机排序，再均分成多组。结果在浏览器本地生成，随刷随用。
            </p>
          </div>

          <Card>
            <CardContent className="flex flex-col gap-6 pt-6">
              <FieldGroup>
                <Field>
                  <div className="flex items-center justify-between gap-4">
                    <FieldLabel htmlFor="sort-entries">参与值（一行一个）</FieldLabel>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => updateEntries(sampleItems)}
                        className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        填入示例
                      </button>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                        <Upload data-icon="inline-start" />
                        上传文件
                        <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} className="sr-only" />
                      </label>
                    </div>
                  </div>
                  <Textarea
                    id="sort-entries"
                    value={entriesText}
                    onChange={(event) => updateEntries(event.target.value)}
                    placeholder={"张三\n李四\n王五\n赵六"}
                    className="min-h-44 resize-y font-mono text-sm"
                    aria-label="参与值列表"
                  />
                  <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                    <span>共 {stats.total} 条</span>
                    <span>唯一 {stats.unique} 条</span>
                    <span>重复 {stats.total - stats.unique} 条</span>
                  </p>
                </Field>
              </FieldGroup>

              <div className="grid gap-6 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="sort-group-count">分组数 <span className="font-normal text-muted-foreground">可选</span></FieldLabel>
                  <Input
                    id="sort-group-count"
                    type="number"
                    min="2"
                    max={Math.max(2, stats.total)}
                    value={groupCountText}
                    onChange={(event) => { setGroupCountText(event.target.value); setResult(null); setError(""); }}
                    placeholder="留空 = 只随机排序"
                  />
                  <FieldDescription>填 2 以上会先随机排序，再把全部条目连续均分成这么多组，各组人数相差不超过 1。</FieldDescription>
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="sort-dedupe">自动去重</FieldLabel>
                    <FieldDescription>开启后重复条目只保留一条。</FieldDescription>
                  </FieldContent>
                  <Checkbox
                    id="sort-dedupe"
                    checked={dedupe}
                    onCheckedChange={(checked) => { setDedupe(checked); setResult(null); setError(""); }}
                  />
                </Field>
              </div>

              {error && (
                <Alert variant="destructive" className="animate-fade-in">
                  <AlertTitle>无法排序</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="flex flex-col items-stretch justify-between gap-4 border-t sm:flex-row sm:items-center">
              <p className="max-w-md text-xs leading-5 text-muted-foreground">
                随机源是浏览器的 crypto，本地洗牌；结果不会上传，也不会生成公开记录。
              </p>
              <div className="flex items-center gap-3">
                {(entriesText || result) && (
                  <Button
                    variant="ghost"
                    onClick={() => { setEntriesText(""); setGroupCountText(""); setResult(null); setError(""); }}
                  >
                    <Eraser data-icon="inline-start" />清空
                  </Button>
                )}
                <Button onClick={run} disabled={stats.total < 1}>
                  {result ? <Dices data-icon="inline-start" /> : <Shuffle data-icon="inline-start" />}
                  {result ? "再排一次" : "开始随机排序"}
                </Button>
              </div>
            </CardFooter>
          </Card>

          {result ? (
            <Card className="animate-fade-in-up">
              <CardHeader className="border-b">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Badge>已完成</Badge>
                      <Badge variant="outline">{result.groups ? "分组随机排序" : "随机排序"}</Badge>
                    </div>
                    <CardTitle className="text-2xl tracking-tight">{result.groups ? "分组结果" : "随机顺序"}</CardTitle>
                    <CardDescription>本地生成，刷新页面即消失；想留档请复制结果。</CardDescription>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void copyResult()}>
                    {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                    {copied ? "已复制" : "复制结果"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{result.groups ? "分组" : "顺序"}</h3>
                  <span className="font-mono text-xs text-muted-foreground">
                    {result.groups ? `${result.groups.length} GROUPS` : `${result.order.length} ITEMS`}
                  </span>
                </div>
                {result.groups ? <GroupCards groups={result.groups} /> : <ResultList items={result.order} />}
              </CardContent>
            </Card>
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListOrdered />
                </EmptyMedia>
                <EmptyTitle>填入名单，一键打乱</EmptyTitle>
                <EmptyDescription>不需要截止时间、管理链接或等待开奖；需要可公开复算的结果时再用「发起抽奖」。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>

        <aside className="hidden lg:block">
          <Card className="sticky top-24">
            <CardHeader>
              <CardTitle>怎么用</CardTitle>
              <CardDescription>三步搞定，全在本地。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {[
                { title: "粘贴名单", text: "一行一个，也可以直接上传 .txt / .csv 文件。" },
                { title: "点开始随机排序", text: "需要分组就填分组数，先随机排序再均分成多组。" },
                { title: "复制结果", text: "结果留在浏览器里；点「再排一次」可以换一组顺序。" },
              ].map((step, index) => (
                <div key={step.title} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">0{index + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.text}</p>
                  </div>
                </div>
              ))}
              <div className="flex flex-col gap-2 border-t pt-5">
                <p className="text-xs leading-5 text-muted-foreground">
                  这个工具不产生公开记录，随机数也不需要别人复核。若要「谁都能复算」的结果，请用公开信标抽奖。
                </p>
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/create" />}>
                  去发起抽奖<ArrowUpRight data-icon="inline-end" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
