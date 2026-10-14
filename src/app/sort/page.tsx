import type { Metadata } from "next";
import { ShuffleTool } from "@/components/shuffle-tool";

export const metadata: Metadata = {
  title: "随机排序与即时抽奖",
  description: "粘贴名单即可立即随机排序、均分成多个组，或直接抽出 N 名中奖者；无需截止时间、无需登录。",
};

export default function SortPage() {
  return <ShuffleTool />;
}
