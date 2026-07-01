import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { AskResponse, AskSource } from "@/lib/types";

export const dynamic = "force-dynamic";

/** "HH:MM:SS" | "MM:SS" → seconds. */
function tsToSeconds(ts: string): number {
  const parts = ts.split(":").map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// A source template describes the evidence; `match` is a list of keywords used
// to resolve it to a REAL meeting row (so the citation link works in the demo).
type SourceTemplate = {
  match: string[];
  ts: string;
  who: string;
  reason: string;
  quote: string;
};

type Answer = { answer: string; sources: SourceTemplate[] };

function answerFor(question: string): Answer {
  const t = question.toLowerCase();

  if (t.includes("gsm8k") || t.includes("tfqa") || t.includes("벤치마크")) {
    return {
      answer:
        "SBQ 논문의 main table 평가 벤치마크를 **GSM8K에서 TFQA-MC로** 바꾼 건 2026-05-24 회의에서 결정됐습니다.\n\n" +
        "핵심 근거는 과제 성격입니다. SBQ의 기여가 reasoning 성능이 아니라 **factual consistency / hallucination 감소**이기 때문에, " +
        "GSM8K에서는 signal이 약하고 TFQA-MC가 주장을 더 직접적으로 보여준다고 판단했습니다.\n\n" +
        "- Main table: **TFQA-MC** (TruthfulQA multiple-choice), 5 seed 평균\n" +
        "- GSM8K: appendix에 참고용으로만 유지\n" +
        "- GSM8K를 main에서 제외한 이유를 justification 한 문단으로 명시 (담당: 박진웅)",
      sources: [
        {
          match: ["sbq", "벤치마크", "논문"],
          ts: "00:11:20",
          who: "지도교수님",
          reason:
            "벤치마크 교체가 확정된 회의입니다. 지도교수의 최종 결정과 justification 작성 지시가 이 시점에 기록돼 있습니다.",
          quote:
            "그럼 GSM8K는 appendix에 참고용으로만 넣고, main table은 TFQA-MC로 갑시다. 대신 왜 GSM8K를 main에서 뺐는지 한 문단 justification 꼭 쓰고.",
        },
      ],
    };
  }

  if (t.includes("camera") || t.includes("todo") || t.includes("camera-ready")) {
    return {
      answer:
        "SBQ camera-ready와 관련해 현재 진행 중인 작업은 **TFQA-MC 재실험**과 **justification 문단 작성**입니다.\n\n" +
        "- TFQA-MC 5 seed 평균으로 main table 재실험 (진행 중, 담당: 박진웅)\n" +
        "- GSM8K를 main에서 제외한 이유 justification 문단 작성",
      sources: [
        {
          match: ["랩미팅", "랩 운영", "주간"],
          ts: "00:05:30",
          who: "박진웅",
          reason: "가장 최근 랩미팅에서 진행 상황으로 직접 언급된 항목입니다.",
          quote: "SBQ camera-ready 준비 중이고, TFQA-MC 5 seed 재실험 돌리고 있습니다.",
        },
        {
          match: ["sbq", "논문"],
          ts: "00:13:05",
          who: "박진웅",
          reason: "justification 문단 작성과 재실험 계획이 처음 배정된 원 회의입니다.",
          quote: "네, camera-ready 전에 TFQA-MC 5 seed 평균으로 다시 돌리겠습니다.",
        },
      ],
    };
  }

  if (
    t.includes("로봇팔") ||
    t.includes("grasp") ||
    t.includes("실험") ||
    t.includes("unseen") ||
    t.includes("overfit") ||
    t.includes("vla")
  ) {
    return {
      answer:
        "2026-05-17 VLA 로봇팔 회의에서 새 grasp policy가 baseline 대비 **success rate 12%p 상승**한 것을 확인했고, " +
        "이 gain이 특정 object에 overfit됐을 가능성이 제기됐습니다.\n\n" +
        "그래서 unseen object set으로 재평가하기로 했고, **ckpt-0413**을 기준 checkpoint로 비교표를 만들기로 결정했습니다. " +
        "후속 회의(05-26)에서 unseen 20개 중 16개 성공으로 overfit 우려가 일부 해소됐습니다.\n\n" +
        "- unseen object 20개를 큐레이션해 generalization 재검증 (담당: 규진)\n" +
        "- 비교 기준 checkpoint: ckpt-0413, eval protocol은 기존과 동일 (object당 20 trial)",
      sources: [
        {
          match: ["로봇팔", "grasp", "vla", "ablation"],
          ts: "00:15:30",
          who: "지도교수님",
          reason: "실험 결과에 대한 결정(재평가·기준 checkpoint 지정)이 내려진 회의입니다.",
          quote:
            "unseen set으로 다시 돌려보고, 다음 주까지 checkpoint ckpt-0413 기준으로 비교표 만들어 오세요.",
        },
        {
          match: ["unseen", "로봇팔", "vla"],
          ts: "00:06:20",
          who: "규진",
          reason: "앞선 결정의 후속으로 unseen object 결과가 공유된 회의입니다.",
          quote:
            "unseen 20개 중 16개 성공, generalization gap은 예상보다 작았습니다. overfit 우려는 일부 해소됐어요.",
        },
      ],
    };
  }

  return {
    answer:
      "질문과 관련도가 높은 회의를 찾았습니다. 아래 출처에서 원문 맥락을 확인하시고, " +
      "정확한 결정 사항은 해당 회의 상세보기에서 타임스탬프 기준으로 검토하는 걸 권장합니다.\n\n" +
      "_(데모: 이 질문에는 사전 준비된 답변이 없어, 가장 최근의 관련 회의를 반환했습니다.)_",
    sources: [
      {
        match: [],
        ts: "00:02:00",
        who: "지도교수님",
        reason: "가장 최근에 열린 회의로, 질문과 부분적으로 관련될 수 있습니다.",
        quote: "이번 주 각자 진행상황 공유하죠. 짧게 갑시다.",
      },
    ],
  };
}

export async function POST(request: Request) {
  let question = "";
  try {
    const body = await request.json();
    question = typeof body?.question === "string" ? body.question : "";
  } catch {
    /* ignore malformed body */
  }

  if (!question.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // Pull real meetings so citations can link to actual detail pages.
  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, title, project_tag, date")
    .order("date", { ascending: false });
  const rows = meetings ?? [];

  const resolveMeetingId = (keywords: string[]): string => {
    for (const kw of keywords) {
      const hit = rows.find((m) => {
        const hay = `${m.title ?? ""} ${m.project_tag ?? ""}`.toLowerCase();
        return hay.includes(kw.toLowerCase());
      });
      if (hit) return hit.id;
    }
    // fall back to the most recent meeting, or empty if the archive is empty
    return rows[0]?.id ?? "";
  };

  const tmpl = answerFor(question);
  const sources: AskSource[] = tmpl.sources.map((s) => ({
    text: s.quote,
    reason: `${s.reason} — [${s.ts}] ${s.who}`,
    meeting_id: resolveMeetingId(s.match),
    timestamp: tsToSeconds(s.ts),
  }));

  const payload: AskResponse = { answer: tmpl.answer, sources };
  return NextResponse.json(payload);
}
