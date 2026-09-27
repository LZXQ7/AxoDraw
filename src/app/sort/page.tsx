import type { Metadata } from "next";
import { ShuffleTool } from "@/components/shuffle-tool";

export const metadata: Metadata = {
  title: "随机排序",
  description: "粘贴名单即可立即随机排序，或均分成多个组；无需发起、无需登录。",
};

export default function SortPage() {
  return <ShuffleTool />;
}
