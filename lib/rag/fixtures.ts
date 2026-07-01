import { buildMeetingMemoryChunks } from "@/lib/rag/chunking";
import type { MemoryChunkRow } from "@/lib/rag/types";
import type { Meeting, Note, Photo, Transcript } from "@/lib/types";

export const DUMMY_MEETINGS: Meeting[] = [
  {
    id: "dummy-sbq-2026-05-24",
    title: "SBQ 논문 benchmark decision",
    date: "2026-05-24",
    participants: ["박진웅", "윤성", "지도교수님"],
    project_tag: "SBQ 논문",
    agenda: "GSM8K와 TFQA-MC 중 main benchmark를 무엇으로 둘지 결정한다.",
    created_at: "2026-05-24T05:00:00.000Z",
  },
  {
    id: "dummy-vla-2026-05-17",
    title: "VLA 로봇팔 grasp policy 리뷰",
    date: "2026-05-17",
    participants: ["규진", "박진웅", "지도교수님"],
    project_tag: "VLA 로봇팔",
    agenda: "새 grasp policy의 baseline 대비 성능과 unseen object 평가 계획을 논의한다.",
    created_at: "2026-05-17T05:00:00.000Z",
  },
  {
    id: "dummy-offoffice-2026-05-29",
    title: "Off-office GEPA feedback discussion",
    date: "2026-05-29",
    participants: ["박진웅", "윤성"],
    project_tag: "GEPA 분석",
    agenda: "proposal_events.jsonl에서 reusable signal을 뽑을 수 있는지 논의한다.",
    created_at: "2026-05-29T09:30:00.000Z",
  },
];

const DUMMY_TRANSCRIPTS: Transcript[] = [
  {
    id: "dummy-transcript-sbq",
    meeting_id: "dummy-sbq-2026-05-24",
    audio_path: null,
    created_at: "2026-05-24T05:20:00.000Z",
    full_text: [
      "[00:03:10] 박진웅: GSM8K를 main table에 넣으면 generation cost가 커서 ablation iteration이 너무 느립니다.",
      "[00:05:40] 윤성: DoLa baseline도 GSM8K setting에서는 seed마다 variance가 커서 비교가 불안정합니다.",
      "[00:09:15] 지도교수님: SBQ의 주장은 reasoning 성능이 아니라 factual consistency와 hallucination 감소에 더 가깝죠.",
      "[00:11:20] 지도교수님: 그럼 GSM8K는 appendix에 참고용으로만 넣고, main table은 TFQA-MC로 갑시다. 대신 왜 GSM8K를 main에서 뺐는지 한 문단 justification 꼭 쓰고.",
      "[00:13:05] 박진웅: 네, camera-ready 전에 TFQA-MC 5 seed 평균으로 다시 돌리겠습니다.",
    ].join("\n"),
  },
  {
    id: "dummy-transcript-vla",
    meeting_id: "dummy-vla-2026-05-17",
    audio_path: null,
    created_at: "2026-05-17T05:25:00.000Z",
    full_text: [
      "[00:02:15] 규진: 새 grasp policy가 baseline 대비 success rate가 12%p 올랐습니다.",
      "[00:07:50] 박진웅: 다만 seen object에 overfit됐을 가능성이 있어서 unseen object 결과가 필요합니다.",
      "[00:15:30] 지도교수님: unseen set으로 다시 돌려보고, 다음 주까지 checkpoint ckpt-0413 기준으로 비교표 만들어 오세요.",
      "[00:18:10] 규진: object당 20 trial로 기존 eval protocol을 유지하겠습니다.",
    ].join("\n"),
  },
  {
    id: "dummy-transcript-offoffice",
    meeting_id: "dummy-offoffice-2026-05-29",
    audio_path: null,
    created_at: "2026-05-29T09:45:00.000Z",
    full_text: [
      "[00:01:10] 박진웅: GEPA feedback 로그에서 representation 후보를 만들 수 있을지 봐야 합니다.",
      "[00:04:30] 윤성: manual feedback 자체보다 input trace에서 reusable signal을 뽑는 방향이 더 중요할 것 같습니다.",
      "[00:08:00] 박진웅: good update와 bad update 사이의 차이를 proposal_events.jsonl에서 비교해 봅시다.",
      "[00:10:25] 윤성: open question은 feedback text만으로 representation을 만들 수 있는지입니다.",
    ].join("\n"),
  },
];

const DUMMY_NOTES: Note[] = [
  {
    id: "dummy-note-sbq-1",
    meeting_id: "dummy-sbq-2026-05-24",
    content: "Decision: TFQA-MC를 main benchmark로 사용. GSM8K는 appendix only.",
    elapsed_seconds: 690,
    created_at: "2026-05-24T05:21:30.000Z",
  },
  {
    id: "dummy-note-sbq-2",
    meeting_id: "dummy-sbq-2026-05-24",
    content: "TODO: 박진웅이 TFQA-MC 5 seed 재실험과 GSM8K 제외 justification 문단 작성.",
    elapsed_seconds: 785,
    created_at: "2026-05-24T05:23:05.000Z",
  },
  {
    id: "dummy-note-vla-1",
    meeting_id: "dummy-vla-2026-05-17",
    content: "Decision: unseen object 20개로 generalization 재검증. 기준 checkpoint는 ckpt-0413.",
    elapsed_seconds: 930,
    created_at: "2026-05-17T05:25:30.000Z",
  },
  {
    id: "dummy-note-offoffice-1",
    meeting_id: "dummy-offoffice-2026-05-29",
    content: "Action: proposal_events.jsonl에서 representation candidate case 확인.",
    elapsed_seconds: 480,
    created_at: "2026-05-29T09:48:00.000Z",
  },
  {
    id: "dummy-note-offoffice-2",
    meeting_id: "dummy-offoffice-2026-05-29",
    content: "Open question: 실패 케이스의 공통 구조를 prompt update feature로 쓸 수 있는가?",
    elapsed_seconds: 625,
    created_at: "2026-05-29T09:50:25.000Z",
  },
];

const DUMMY_PHOTOS: Photo[] = [
  {
    id: "dummy-photo-sbq-board",
    meeting_id: "dummy-sbq-2026-05-24",
    storage_path: "dummy/sbq/board-benchmark-tradeoff.png",
    elapsed_seconds: 560,
    created_at: "2026-05-24T05:19:20.000Z",
  },
  {
    id: "dummy-photo-vla-board",
    meeting_id: "dummy-vla-2026-05-17",
    storage_path: "dummy/vla/board-unseen-eval.png",
    elapsed_seconds: 885,
    created_at: "2026-05-17T05:24:45.000Z",
  },
];

export function getDummyMeeting(meetingId: string): Meeting | null {
  return DUMMY_MEETINGS.find((meeting) => meeting.id === meetingId) ?? null;
}

export function getDummyChunks(meetingId?: string): MemoryChunkRow[] {
  const selectedMeetings = meetingId
    ? DUMMY_MEETINGS.filter((meeting) => meeting.id === meetingId)
    : DUMMY_MEETINGS;

  return selectedMeetings.flatMap((meeting) => {
    const chunks = buildMeetingMemoryChunks({
      meeting,
      transcripts: DUMMY_TRANSCRIPTS.filter((item) => item.meeting_id === meeting.id),
      notes: DUMMY_NOTES.filter((item) => item.meeting_id === meeting.id),
      photos: DUMMY_PHOTOS.filter((item) => item.meeting_id === meeting.id),
    });

    return chunks.map((chunk, index) => ({
      ...chunk,
      id: `${meeting.id}-${chunk.source_type}-${chunk.source_id ?? "meta"}-${chunk.chunk_index}-${index}`,
      meetings: {
        title: meeting.title,
        date: meeting.date,
        project_tag: meeting.project_tag,
      },
    }));
  });
}
