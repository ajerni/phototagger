import { FormEvent, useState } from "react";
import {
  BrainCircuit,
  CircleAlert,
  Download,
  LockKeyhole,
  MessageCircle,
  Send,
  Sparkles
} from "lucide-react";
import type {
  AnalysisJob,
  AskResponse,
  HealthResponse,
  Photo,
  TripQuestion,
  TripMemory
} from "../../api/client";
import { assetUrl } from "../../api/client";
import {
  jobDetail,
  jobPercent,
  jobRemaining,
  jobStage,
  jobStepCount
} from "../story/jobStatus";

type MemoryCompanionProps = {
  health: HealthResponse | null;
  healthError: string | null;
  askDisabled: boolean;
  job: AnalysisJob | null;
  tripMemory: TripMemory | null;
  askResponse: AskResponse | null;
  questions: TripQuestion[];
  photos: Photo[];
  exportDisabled: boolean;
  onAsk: (question: string) => void;
  onSelectEvidence: (photoId: number) => void;
  onExportMarkdown: () => void;
  onExportZip: () => void;
};

export function MemoryCompanion({
  health,
  healthError,
  askDisabled,
  job,
  tripMemory,
  askResponse,
  questions,
  photos,
  exportDisabled,
  onAsk,
  onSelectEvidence,
  onExportMarkdown,
  onExportZip
}: MemoryCompanionProps) {
  const [question, setQuestion] = useState("What did I seem drawn to on this trip?");
  const prompts = [
    "What did I seem drawn to on this trip?",
    "Which moments feel most memorable?",
    "What should I revisit next time?"
  ];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (question.trim()) {
      onAsk(question.trim());
    }
  }

  return (
    <aside className="memory-companion">
      <div className="companion-heading">
        <div className="companion-title-row">
          <div>
            <span className="soft-kicker">Ask this trip</span>
            <h2>Talk to your memories</h2>
          </div>
          <details className="companion-export-menu">
            <summary aria-label="Export memory">
              <Download size={16} aria-hidden="true" />
            </summary>
            <div>
              <button type="button" disabled={exportDisabled} onClick={onExportMarkdown}>
                Markdown
              </button>
              <button type="button" disabled={exportDisabled} onClick={onExportZip}>
                ZIP dossier
              </button>
            </div>
          </details>
        </div>
        <p>
          {health ? (
            <>
              <LockKeyhole size={13} aria-hidden="true" />
              Local memory store ready
            </>
          ) : (
            healthError ?? "Backend offline"
          )}
        </p>
      </div>

      {job ? <CompanionProgress job={job} /> : null}

      <div className="reflection-card">
        {tripMemory ? (
          <>
            <span className="soft-kicker">Reflection</span>
            <p>{tripMemory.user_narrative_summary || tripMemory.narrative_summary}</p>
            {tripMemory.user_note ? <em>{tripMemory.user_note}</em> : null}
            <EvidenceButtons
              ids={tripMemory.evidence_photo_ids}
              photos={photos}
              onSelectEvidence={onSelectEvidence}
            />
          </>
        ) : (
          <div className="reflection-empty">
            <Sparkles size={20} aria-hidden="true" />
            <p>Develop memories from the cover, then ask grounded questions here.</p>
          </div>
        )}
      </div>

      <div className="prompt-row" aria-label="Suggested questions">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={askDisabled}
            onClick={() => setQuestion(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>

      <form className="companion-form" onSubmit={handleSubmit}>
        <MessageCircle size={17} aria-hidden="true" />
        <input
          aria-label="Ask a trip question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={askDisabled}
          placeholder="Ask about this trip..."
        />
        <button type="submit" disabled={askDisabled || !question.trim()} title="Ask trip">
          <Send size={16} aria-hidden="true" />
        </button>
      </form>

      <div className="companion-answer">
        {askResponse ? (
          <>
            <span className="soft-kicker">Grounded answer</span>
            <p>{askResponse.answer}</p>
            <EvidenceButtons
              ids={askResponse.evidence_photo_ids}
              photos={photos}
              onSelectEvidence={onSelectEvidence}
            />
          </>
        ) : (
          <div className="answer-waiting">
            <BrainCircuit size={20} aria-hidden="true" />
            <p>
              {askDisabled
                ? "Trip Q&A unlocks after memories are developed."
                : "Ask a question and Gemma will answer from the stored memories."}
            </p>
          </div>
        )}
      </div>

      {questions.length > 0 ? (
        <div className="question-history">
          <span className="soft-kicker">Asked before</span>
          {questions.slice(-3).reverse().map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setQuestion(item.question)}
            >
              <strong>{item.question}</strong>
              <span>{item.answer}</span>
            </button>
          ))}
        </div>
      ) : null}

      <details className="local-facts">
        <summary>Local facts</summary>
        <dl>
          <div>
            <dt>Model</dt>
            <dd>
              {health
                ? health.model_available
                  ? health.model
                  : health.model_status
                : "Offline"}
            </dd>
          </div>
          <div>
            <dt>Coordinates</dt>
            <dd>EXIF only</dd>
          </div>
          <div>
            <dt>Images</dt>
            <dd>JPEG, PNG, WebP</dd>
          </div>
          <div>
            <dt>Memory</dt>
            <dd>Local SQLite</dd>
          </div>
        </dl>
      </details>
    </aside>
  );
}

function CompanionProgress({ job }: { job: AnalysisJob }) {
  const percent = jobPercent(job);
  const detail = jobDetail(job);
  const stepCount = jobStepCount(job);
  const remaining = jobRemaining(job);

  return (
    <div className={`companion-progress ${job.status}`}>
      <div>
        <strong>{jobStage(job)}</strong>
        <span>{percent}%</span>
      </div>
      <p className="job-step-line">
        {job.error ? <CircleAlert size={14} aria-hidden="true" /> : null}
        {detail}
      </p>
      <progress max={100} value={percent} />
      {stepCount || remaining ? (
        <div className="job-meta-row">
          {stepCount ? <span>{stepCount}</span> : null}
          {remaining ? <span>{remaining}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function EvidenceButtons({
  ids,
  photos,
  onSelectEvidence
}: {
  ids: number[];
  photos: Photo[];
  onSelectEvidence: (photoId: number) => void;
}) {
  if (ids.length === 0) {
    return null;
  }

  return (
    <div className="companion-evidence">
      <span>Evidence</span>
      {ids.map((id) => {
        const photo = photos.find((item) => item.id === id);
        return (
          <button key={id} type="button" onClick={() => onSelectEvidence(id)}>
            {photo ? (
              <img
                src={assetUrl(photo.image_url)}
                alt={photo.analysis?.memory_caption || photo.filename}
              />
            ) : null}
            <em>#{id}</em>
          </button>
        );
      })}
    </div>
  );
}
