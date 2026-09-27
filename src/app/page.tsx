"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Fingerprint, Hourglass, Search, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { GroupCards, ResultList } from "@/components/result-view";
import { Stat } from "@/components/stat";
import { cn } from "@/lib/utils";
import { dateLabel, drawModeMeta, drawModeOf, drawModes, DrawVerification, entries, Lottery, sampleCodes } from "@/lib/lottery";

export default function Home() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Lottery | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [verification, setVerification] = useState<DrawVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [manageCode, setManageCode] = useState("");
  const [manageToken, setManageToken] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState("");
  const [entriesDraft, setEntriesDraft] = useState("");
  const [entriesSaving, setEntriesSaving] = useState(false);
  const [entriesError, setEntriesError] = useState("");
  const [entriesSaved, setEntriesSaved] = useState(false);

  const mode = result ? drawModeOf(result) : "lottery";
  const modeMeta = drawModeMeta[mode];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || params.get("manage");
    const token = params.get("token");
    if (code) {
      window.setTimeout(() => {
        const manage = params.get("manage");
        if (manage && token) { setManageCode(manage.toUpperCase()); setManageToken(token); }
        setQuery(code); void lookup(code, Boolean(token));
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 管理模式：加载/保存后同步参与值草稿（渲染期同步，避免 effect 中 setState）
  const [draftSource, setDraftSource] = useState<Lottery | null>(null);
  if (result !== draftSource) {
    setDraftSource(result);
    if (result?.status === "scheduled" && manageCode === result.code && manageToken) {
      setEntriesDraft(result.entries.join("\n"));
      setEntriesSaved(false);
      setEntriesError("");
    }
  }

  async function lookup(code = query, preserveManagementUrl = false) {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/lotteries/" + encodeURIComponent(normalized));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "未找到这个抽奖");
      setResult(data.lottery); setAuditOpen(false); setVerification(null);
      if (data.lottery.status === "drawn") void verifyDraw(normalized);
      if (!preserveManagementUrl) window.history.replaceState(null, "", "/?code=" + normalized);
    } catch (cause) { setResult(null); setError(cause instanceof Error ? cause.message : "查询失败"); }
    finally { setLoading(false); }
  }

  async function verifyDraw(code: string) {
    setVerifying(true);
    try {
      const response = await fetch(
        "/api/lotteries/" + encodeURIComponent(code) + "/verify",
      );
      const data = await response.json();
      setVerification({
        verified: data.verified === true,
        fair: data.fair === true,
        reason: data.reason || (response.ok ? "验证完成" : "验证失败"),
        checks: data.checks,
        expectedRound: data.expectedRound,
        expectedCommitment: data.expectedCommitment,
      });
    } catch (cause) {
      setVerification({
        verified: false,
        fair: false,
        reason: cause instanceof Error ? cause.message : "验证请求失败",
      });
    } finally {
      setVerifying(false);
    }
  }

  async function drawNow() {
    if (!manageCode || !manageToken) return;
    setDrawing(true); setDrawError("");
    try {
      const response = await fetch("/api/lotteries/" + manageCode + "/draw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: manageToken }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "暂时无法开奖");
      setResult(data.lottery);
      setVerification(null);
      void verifyDraw(data.lottery.code);
    } catch (cause) { setDrawError(cause instanceof Error ? cause.message : "暂时无法开奖"); }
    finally { setDrawing(false); }
  }

  async function saveEntriesNow() {
    if (!manageCode || !manageToken) return;
    setEntriesSaving(true); setEntriesError(""); setEntriesSaved(false);
    try {
      const response = await fetch("/api/lotteries/" + manageCode, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: manageToken, entriesText: entriesDraft }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      setResult(data.lottery);
      setEntriesSaved(true);
    } catch (cause) { setEntriesError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setEntriesSaving(false); }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-10 sm:px-6 lg:px-8 lg:pt-14">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Badge variant="secondary">公开信标</Badge>
              <span className="text-xs text-muted-foreground">结果可复算</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">查询结果</h1>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">输入编码，查看抽奖、随机排序或分组结果，以及可复算的信标记录。</p>
          </div>

          <form onSubmit={(event) => { event.preventDefault(); void lookup(); }} className="flex flex-col gap-3 sm:flex-row">
            <InputGroup className="flex-1">
              <InputGroupAddon align="inline-start">
                <Search />
              </InputGroupAddon>
              <InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如 AXO-7K4M" className="font-mono" />
            </InputGroup>
            <Button type="submit" disabled={loading}>{loading && <Spinner data-icon="inline-start" />}查询</Button>
          </form>

          {error && (
            <Alert variant="destructive" className="animate-fade-in">
              <AlertTitle>无法找到抽奖</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result ? (
            <Card className="animate-fade-in-up">
              <CardHeader className="border-b">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={result.status === "drawn" ? "default" : "secondary"}>{result.status === "drawn" ? modeMeta.drawnBadge : "进行中"}</Badge>
                      <Badge variant="outline">{modeMeta.label}</Badge>
                      <span className="font-mono text-xs text-muted-foreground">{result.code}</span>
                    </div>
                    <CardTitle className="text-2xl tracking-tight">{result.title}</CardTitle>
                    {result.description && <CardDescription className="max-w-xl text-sm">{result.description}</CardDescription>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                    <span>截止时间</span>
                    <span className="font-mono font-medium text-foreground">{dateLabel(result.deadline)}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {manageCode === result.code && manageToken && result.status === "scheduled" && (
                  <div className="animate-fade-in flex flex-col gap-4 rounded-2xl border bg-muted/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium">管理模式</p>
                        <p className="text-xs leading-5 text-muted-foreground">{modeMeta.label}的结果由截止后 10 分钟的固定 drand 轮次生成，签名与结果会自动验证。</p>
                      </div>
                      <Button onClick={() => void drawNow()} disabled={drawing}>{drawing && <Spinner data-icon="inline-start" />}{modeMeta.action}</Button>
                    </div>
                    {Date.now() >= new Date(result.deadline).getTime() ? (
                      <p className="border-t pt-4 text-xs leading-5 text-muted-foreground">
                        已过截止时间：{dateLabel(result.deadline)}，参与值已锁定，不可再修改，可直接生成结果。
                      </p>
                    ) : (
                      <form
                        onSubmit={(event) => { event.preventDefault(); void saveEntriesNow(); }}
                        className="flex flex-col gap-3 border-t pt-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-medium">参与值（截止前可修改）</p>
                          <span className="font-mono text-[11px] text-muted-foreground">共 {entries(entriesDraft).length} 条 · {result.duplicatePolicy === "dedupe" ? "自动去重" : "不去重"}</span>
                        </div>
                        <Textarea
                          value={entriesDraft}
                          onChange={(event) => setEntriesDraft(event.target.value)}
                          rows={8}
                          className="min-h-44 resize-y bg-background font-mono text-sm"
                          aria-label="参与值列表"
                        />
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <Button type="submit" size="sm" disabled={entriesSaving}>{entriesSaving && <Spinner data-icon="inline-start" />}保存参与值</Button>
                          {entriesSaved && <span className="text-xs text-emerald-600 dark:text-emerald-400">已保存，开奖将基于最新参与值</span>}
                          {entriesError && <span className="text-xs text-red-600 dark:text-red-400">{entriesError}</span>}
                        </div>
                      </form>
                    )}
                  </div>
                )}
                {drawError && <p className="font-mono text-xs text-muted-foreground">{drawError}</p>}

                {result.status === "drawn" ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">{modeMeta.resultTitle}</h3>
                      <span className="font-mono text-xs text-muted-foreground">
                        {mode === "group" ? `${result.groups?.length ?? 0} ${modeMeta.unit}` : `${result.winners.length} ${modeMeta.unit}`}
                      </span>
                    </div>
                    {mode === "group" ? (
                      <GroupCards groups={result.groups ?? []} />
                    ) : (
                      <ResultList items={result.winners} />
                    )}
                    {mode === "shuffle" && (
                      <p className="text-xs leading-5 text-muted-foreground">序号即随机顺序：全部参与值都会出现，且各出现一次。</p>
                    )}
                    {mode === "group" && (
                      <p className="text-xs leading-5 text-muted-foreground">分组来自同一次随机排序：先随机打乱，再按顺序连续切分成 {result.groupCount ?? result.groups?.length ?? 0} 组，各组人数相差不超过 1。</p>
                    )}
                  </div>
                ) : (
                  <Empty className="bg-muted/50">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Hourglass />
                      </EmptyMedia>
                      <EmptyTitle>{modeMeta.pendingTitle}</EmptyTitle>
                      <EmptyDescription>{modeMeta.pendingHint}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}

                <Collapsible open={auditOpen} onOpenChange={setAuditOpen}>
                  <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 border-t pt-4 text-sm font-medium">
                    <span className="flex items-center gap-2"><ShieldCheck data-icon="inline-start" />验证详情</span>
                    <ChevronArrow open={auditOpen} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="flex flex-col gap-6 pt-5">
                    {result.status === "drawn" && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/40 p-4">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={verification?.verified ? "default" : verification ? "destructive" : "secondary"}
                            >
                              {verifying ? "正在验证" : verification?.verified ? "验证通过" : verification ? "验证失败" : "等待验证"}
                            </Badge>
                            <span className="text-xs font-medium">独立验证</span>
                          </div>
                          <p className="text-xs leading-5 text-muted-foreground">
                            {verification?.reason ?? "正在核对目标轮次、drand 签名、名单承诺、结果模式、摘要与结果名单。"}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" disabled={verifying} onClick={() => void verifyDraw(result.code)}>
                          {verifying && <Spinner data-icon="inline-start" />}重新验证
                        </Button>
                      </div>
                    )}
                    <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
                      <Stat label="参与值数量" value={String(result.entries.length)} />
                      <Stat
                        label={modeMeta.countStatLabel}
                        value={
                          mode === "group"
                            ? String(result.groupCount ?? result.groups?.length ?? 0)
                            : mode === "shuffle"
                              ? String(result.entries.length)
                              : String(result.winnerCount)
                        }
                      />
                      <Stat label="结果模式" value={modeMeta.label} />
                      <Stat label="随机信标" value={String(result.draw?.round ?? "等待生成")} />
                      <Stat label="算法版本" value={result.draw?.algorithm ?? "deterministic-v2"} />
                    </div>
                    {result.entriesCommitment && (
                      <div className="flex flex-col gap-1 rounded-2xl border bg-muted/40 p-4 font-mono text-[11px] leading-6 text-muted-foreground break-all">
                        <p>mode: {mode}{mode === "group" ? ` (groupCount: ${result.groupCount ?? "?"})` : ""}</p>
                        <p>entriesCommitment: {result.entriesCommitment}</p>
                        <p>commitmentUpdatedAt: {result.commitmentUpdatedAt ?? "unknown"}</p>
                      </div>
                    )}
                    {result.draw && (
                      <div className="flex flex-col gap-1 rounded-2xl border bg-muted/40 p-4 font-mono text-[11px] leading-6 text-muted-foreground break-all">
                        <p>randomness: {result.draw.randomness}</p>
                        <p>signature: {result.draw.signature}</p>
                        <p>digest: {result.draw.digest}</p>
                        <p>drawCommitment: {result.draw.entriesCommitment ?? "legacy-missing"}</p>
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-muted-foreground">参与值</p>
                      <div className="max-h-44 overflow-auto rounded-2xl border p-3.5 font-mono text-[11px] leading-6 text-muted-foreground whitespace-pre-wrap">{result.entries.join("\n")}</div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Fingerprint />
                </EmptyMedia>
                <EmptyTitle>每种结果都有一份公开记录</EmptyTitle>
                <EmptyDescription>输入编码即可查看抽奖、随机排序或分组结果与信标记录，也可以直接试试示例。</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <div className="flex flex-col items-center gap-3">
                  <div className="flex flex-wrap justify-center gap-3">
                    {drawModes.map((sampleMode) => (
                      <Button
                        key={sampleMode}
                        variant={sampleMode === "lottery" ? "default" : "outline"}
                        onClick={() => void lookup(sampleCodes[sampleMode])}
                      >
                        {drawModeMeta[sampleMode].label}示例
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    只是想把名单打乱？用
                    <Link href="/sort" className="font-medium text-foreground underline underline-offset-4">随机排序工具</Link>
                    ，粘贴即出结果。
                  </p>
                </div>
              </EmptyContent>
            </Empty>
          )}
        </section>

        <aside className="hidden lg:block">
          <Card className="sticky top-24">
            <CardHeader>
              <CardTitle>验证流程</CardTitle>
              <CardDescription>每个结果都能独立复算。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {["输入公开编码", "读取开奖信标", "核对结果摘要"].map((step, index) => (
                <div key={step} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">0{index + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{step}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{index === 0 ? "无需登录，凭编码即可查看。" : index === 1 ? "使用截止时间后的 drand beacon。" : "展示参与值、算法与 digest。"}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function ChevronArrow({ open }: { open: boolean }) {
  return <ChevronDown data-icon="inline-end" className={cn("transition-transform duration-300 ease-out-expo", open ? "rotate-180" : "")} />;
}
