from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, BackgroundTasks, Body, Depends, status
from sqlmodel import Session, select

from backend.app.api.deps import get_trip_or_404
from backend.app.api.errors import workflow_bad_request
from backend.app.core.config import get_settings
from backend.app.db.models import AnalysisJob, Photo, Trip, utc_now
from backend.app.db.session import get_engine, get_session
from backend.app.schemas.analysis import AnalyzeTripRequest, PhotoAnalysisRead
from backend.app.schemas.job import AnalysisJobRead
from backend.app.workflows.client import GemmaClient, OpenRouterClient
from backend.app.workflows.travel_memory import (
    WorkflowError,
    WorkflowCanceled,
    analyze_photo_memory,
    run_trip_memory_workflow,
)

router = APIRouter(tags=["analysis"])

ClientFactory = Callable[[], GemmaClient]


def get_gemma_client() -> GemmaClient:
    return OpenRouterClient(get_settings())


@router.post("/photos/{photo_id}/analyze", response_model=PhotoAnalysisRead)
def analyze_photo(
    photo_id: int,
    session: Session = Depends(get_session),
) -> PhotoAnalysisRead:
    try:
        record = analyze_photo_memory(session, photo_id, client=get_gemma_client())
    except WorkflowError as exc:
        raise workflow_bad_request(exc) from exc
    return PhotoAnalysisRead.model_validate(record)


@router.post(
    "/trips/{trip_id}/analyze",
    response_model=AnalysisJobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def analyze_trip(
    background_tasks: BackgroundTasks,
    payload: AnalyzeTripRequest | None = Body(default=None),
    trip: Trip = Depends(get_trip_or_404),
    session: Session = Depends(get_session),
) -> AnalysisJobRead:
    job = create_analysis_job(session, int(trip.id), (payload or AnalyzeTripRequest()).mode)

    background_tasks.add_task(run_analysis_job, int(job.id), get_gemma_client)
    return AnalysisJobRead.model_validate(job)


def create_analysis_job(session: Session, trip_id: int, mode: str = "all") -> AnalysisJob:
    total_steps = _analysis_total_steps(session, trip_id, mode)
    job = AnalysisJob(
        trip_id=trip_id,
        status="queued",
        current_step="Queued",
        completed_steps=0,
        total_steps=total_steps,
        mode=mode,
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def run_analysis_job(
    job_id: int,
    client_factory: ClientFactory = get_gemma_client,
) -> None:
    with Session(get_engine()) as session:
        job = session.get(AnalysisJob, job_id)
        if job is None:
            return
        if job.status == "cancel_requested":
            _save_job(session, job, status_value="canceled", current_step="Canceled")
            return

        try:
            client = client_factory()

            def update_progress(
                current_step: str,
                completed_steps: int,
                total_steps: int,
            ) -> None:
                _save_job(
                    session,
                    job,
                    status_value="running",
                    current_step=current_step,
                    completed_steps=completed_steps,
                    total_steps=total_steps,
                )

            def should_cancel() -> bool:
                session.refresh(job)
                return job.status == "cancel_requested"

            _save_job(
                session,
                job,
                status_value="running",
                current_step="Starting analysis",
            )
            run_trip_memory_workflow(
                session,
                job.trip_id,
                client=client,
                on_progress=update_progress,
                mode=job.mode,
                should_cancel=should_cancel,
            )
            _save_job(
                session,
                job,
                status_value="completed",
                current_step="Completed",
                completed_steps=job.total_steps,
                total_steps=job.total_steps,
                error=None,
            )
        except WorkflowCanceled:
            session.rollback()
            _save_job(
                session,
                job,
                status_value="canceled",
                current_step="Canceled",
                error=None,
            )
        except Exception as exc:
            session.rollback()
            _save_job(
                session,
                job,
                status_value="failed",
                current_step="Failed",
                error=str(exc),
            )


def _save_job(
    session: Session,
    job: AnalysisJob,
    *,
    status_value: str,
    current_step: str | None = None,
    completed_steps: int | None = None,
    total_steps: int | None = None,
    error: str | None = None,
) -> None:
    job.status = status_value
    if current_step is not None:
        job.current_step = current_step
    if completed_steps is not None:
        job.completed_steps = completed_steps
    if total_steps is not None:
        job.total_steps = total_steps
    job.error = error
    job.updated_at = utc_now()
    session.add(job)
    session.commit()


def _analysis_total_steps(session: Session, trip_id: int, mode: str) -> int:
    photos = session.exec(select(Photo).where(Photo.trip_id == trip_id)).all()
    if mode == "missing":
        photo_steps = sum(1 for photo in photos if photo.analysis is None)
    else:
        photo_steps = len(photos)
    return photo_steps + (1 if photos else 0)
