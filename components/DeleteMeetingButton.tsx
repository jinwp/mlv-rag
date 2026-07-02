"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  meetingId: string;
  meetingTitle: string;
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fff",
  color: "#b91c1c",
  borderRadius: 8,
  padding: "6px 9px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

export function DeleteMeetingButton({ meetingId, meetingTitle }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const ok = window.confirm(
      `"${meetingTitle}" 회의를 정말 삭제할까요?\n\n전사, 메모, 사진, 생성 이미지, RAG chunk도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`
    );

    if (!ok) return;

    setBusy(true);

    try {
      const res = await fetch("/api/meetings/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ meetingId }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(data?.details ?? data?.error ?? "삭제 실패");
      }

      router.refresh();
    } catch (error: any) {
      console.error("[DeleteMeetingButton] failed", error);
      window.alert(error?.message ?? "회의 삭제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={busy}
      style={{
        ...buttonStyle,
        opacity: busy ? 0.6 : 1,
        cursor: busy ? "not-allowed" : "pointer",
      }}
    >
      {busy ? "Deleting..." : "Delete"}
    </button>
  );
}