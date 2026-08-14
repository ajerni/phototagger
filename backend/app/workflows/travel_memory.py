from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence, TypeVar

from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ValidationError
from sqlmodel import Session, select

from backend.app.core.config import Settings, get_settings
from backend.app.db.models import Photo, PhotoAnalysis, Trip, TripMemory, utc_now
from backend.app.schemas.ask import AskResponse
from backend.app.workflows.client import GemmaClient, OpenRouterClient
from backend.app.workflows.prompts import (
    photo_analysis_prompt,
    photo_analysis_system_instruction,
    retry_prompt,
    trip_question_prompt,
    trip_question_system_instruction,
    trip_synthesis_prompt,
    trip_synthesis_system_instruction,
)
from backend.app.workflows.schemas import (
    AnalyzedPhotoContext,
    GroundedTripAnswer,
    PhotoContext,
    PhotoMemoryAnalysis,
    TripMemorySynthesis,
    TripWorkflowResult,
)


SchemaT = TypeVar("SchemaT", bound=BaseModel)
GemmaMessage = dict[str, Any]
ProgressCallback = Callable[[str, int, int], None]


class WorkflowError(RuntimeError):
    pass


class WorkflowInputError(WorkflowError):
    pass


class WorkflowValidationError(WorkflowError):
    pass


class WorkflowCanceled(WorkflowError):
    pass


def analyze_photo_memory(
    session: Session,
    photo_id: int,
    client: GemmaClient | None = None,
) -> PhotoAnalysis:
    settings = get_settings()
    client = client or OpenRouterClient(settings)
    photo = _get_photo(session, photo_id)
    image_payload = _load_image_payload(photo, settings)
    photo_metadata = _photo_context(photo).model_dump()

    messages: list[GemmaMessage] = [
        {"role": "system", "content": photo_analysis_system_instruction()},
        {
            "role": "user",
            "content": photo_analysis_prompt(photo_metadata),
            "images": [image_payload],
        }
    ]
    analysis = call_gemma_structured(
        client=client,
        schema=PhotoMemoryAnalysis,
        messages=messages,
        settings=settings,
    )

    return _save_photo_analysis(session, photo_id, analysis, settings)


def synthesize_trip_memory(
    session: Session,
    trip_id: int,
    client: GemmaClient | None = None,
) -> TripMemory:
    settings = get_settings()
    client = client or OpenRouterClient(settings)
    trip = _get_trip(session, trip_id)
    photo_contexts = _analyzed_photo_contexts(session, trip_id)
    if not photo_contexts:
        raise WorkflowInputError("Trip has no analyzed photos to synthesize")

    valid_ids = {item.id for item in photo_contexts}
    trip_context = {
        "trip": _trip_context(trip),
        "photo_memories": [item.model_dump() for item in photo_contexts],
    }
    messages: list[GemmaMessage] = [
        {"role": "system", "content": trip_synthesis_system_instruction()},
        {"role": "user", "content": trip_synthesis_prompt(trip_context)},
    ]
    synthesis = call_gemma_structured(
        client=client,
        schema=TripMemorySynthesis,
        messages=messages,
        settings=settings,
        validator=lambda item: _validate_trip_synthesis_ids(item, valid_ids),
    )

    return _save_trip_memory(session, trip_id, synthesis, settings)


def answer_trip_question_with_gemma(
    session: Session,
    trip_id: int,
    question: str,
    client: GemmaClient | None = None,
) -> AskResponse:
    settings = get_settings()
    client = client or OpenRouterClient(settings)
    trip = _get_trip(session, trip_id)
    photo_contexts = _analyzed_photo_contexts(session, trip_id)
    if not photo_contexts:
        raise WorkflowInputError("Trip has no analyzed photos for grounded Q&A")
    if len(photo_contexts) > settings.workflow_max_qa_photos:
        raise WorkflowInputError(
            "Trip has too many analyzed photos for the configured Q&A context"
        )

    valid_ids = {item.id for item in photo_contexts}
    trip_memory = session.get(TripMemory, trip_id)
    question_context = {
        "trip": _trip_context(trip),
        "question": question,
        "allowed_photo_ids": sorted(valid_ids),
        "trip_memory": _trip_memory_context(trip_memory),
        "photo_memories": [item.model_dump() for item in photo_contexts],
    }
    messages: list[GemmaMessage] = [
        {"role": "system", "content": trip_question_system_instruction()},
        {"role": "user", "content": trip_question_prompt(question_context)},
    ]
    answer = call_gemma_structured(
        client=client,
        schema=GroundedTripAnswer,
        messages=messages,
        settings=settings,
        validator=lambda item: _validate_ids(item.evidence_photo_ids, valid_ids),
    )
    return AskResponse(
        answer=answer.answer,
        evidence_photo_ids=answer.evidence_photo_ids,
    )


def run_trip_memory_workflow(
    session: Session,
    trip_id: int,
    client: GemmaClient | None = None,
    on_progress: ProgressCallback | None = None,
    mode: str = "all",
    should_cancel: Callable[[], bool] | None = None,
) -> TripWorkflowResult:
    client = client or OpenRouterClient(get_settings())
    _get_trip(session, trip_id)
    all_photos = session.exec(
        select(Photo).where(Photo.trip_id == trip_id).order_by(Photo.created_at)
    ).all()
    photos = [
        photo for photo in all_photos if mode == "all" or photo.analysis is None
    ]
    total_steps = len(photos) + (1 if all_photos else 0)
    if on_progress is not None:
        on_progress("Starting analysis", 0, total_steps)

    analyzed_ids: list[int] = []
    for index, photo in enumerate(photos, start=1):
        _raise_if_canceled(should_cancel)
        if on_progress is not None:
            on_progress(f"Analyzing {photo.filename}", index - 1, total_steps)
        analyze_photo_memory(session, int(photo.id), client=client)
        analyzed_ids.append(int(photo.id))
        _raise_if_canceled(should_cancel)
        if on_progress is not None:
            on_progress(f"Analyzed {photo.filename}", index, total_steps)

    trip_memory_created = False
    if _analyzed_photo_contexts(session, trip_id):
        _raise_if_canceled(should_cancel)
        if on_progress is not None:
            on_progress("Synthesizing trip memory", len(analyzed_ids), total_steps)
        synthesize_trip_memory(session, trip_id, client=client)
        trip_memory_created = True
        if on_progress is not None:
            on_progress("Completed", total_steps, total_steps)

    settings = get_settings()
    return TripWorkflowResult(
        trip_id=trip_id,
        analyzed_photo_ids=analyzed_ids,
        trip_memory_created=trip_memory_created,
        prompt_version=settings.prompt_version,
        qa_ready=trip_memory_created,
    )


def _raise_if_canceled(callback: Callable[[], bool] | None) -> None:
    if callback is not None and callback():
        raise WorkflowCanceled("Analysis canceled")


def call_gemma_structured(
    *,
    client: GemmaClient,
    schema: type[SchemaT],
    messages: Sequence[Mapping[str, Any]],
    settings: Settings,
    validator: Callable[[SchemaT], None] | None = None,
) -> SchemaT:
    active_messages = [dict(message) for message in messages]
    last_error: Exception | None = None
    attempts = settings.workflow_retry_invalid_json + 1
    for _attempt in range(attempts):
        raw = client.complete_json(
            messages=active_messages,
            schema=schema,
            options=_model_options(settings),
        )
        try:
            parsed = schema.model_validate_json(raw)
            if validator is not None:
                validator(parsed)
            return parsed
        except (ValidationError, WorkflowValidationError) as exc:
            last_error = exc
            active_messages = [
                *active_messages,
                {"role": "assistant", "content": raw},
                {"role": "user", "content": retry_prompt(raw, str(exc))},
            ]

    raise WorkflowValidationError(
        f"Gemma response did not satisfy {schema.__name__}"
    ) from last_error


def _save_photo_analysis(
    session: Session,
    photo_id: int,
    analysis: PhotoMemoryAnalysis,
    settings: Settings,
) -> PhotoAnalysis:
    record = session.get(PhotoAnalysis, photo_id) or PhotoAnalysis(photo_id=photo_id)
    record.scene = analysis.scene_summary
    record.activities = analysis.visible_activities
    record.objects = analysis.visible_objects
    record.mood = analysis.mood
    record.memory_prompt = analysis.memory_caption
    record.confidence = analysis.confidence
    record.raw_model_json = {
        "prompt_version": settings.prompt_version,
        "photo_memory": analysis.model_dump(),
    }
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def _save_trip_memory(
    session: Session,
    trip_id: int,
    synthesis: TripMemorySynthesis,
    settings: Settings,
) -> TripMemory:
    now = utc_now()
    record = session.get(TripMemory, trip_id) or TripMemory(
        trip_id=trip_id,
        created_at=now,
    )
    record.narrative_summary = synthesis.narrative_summary
    record.inferred_interests = synthesis.inferred_interests
    record.recurring_themes = synthesis.recurring_themes
    record.memorable_moments = [
        moment.model_dump() for moment in synthesis.memorable_moments
    ]
    record.evidence_photo_ids = synthesis.evidence_photo_ids
    record.uncertainty_notes = synthesis.uncertainty_notes
    record.raw_model_json = {
        "prompt_version": settings.prompt_version,
        "trip_memory": synthesis.model_dump(),
    }
    record.prompt_version = settings.prompt_version
    record.updated_at = now

    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def _model_options(settings: Settings) -> dict[str, Any]:
    return {
        "temperature": settings.workflow_temperature,
        "num_ctx": settings.workflow_num_ctx,
    }


def _get_trip(session: Session, trip_id: int) -> Trip:
    trip = session.get(Trip, trip_id)
    if trip is None:
        raise WorkflowInputError(f"Trip not found: {trip_id}")
    return trip


def _get_photo(session: Session, photo_id: int) -> Photo:
    photo = session.get(Photo, photo_id)
    if photo is None:
        raise WorkflowInputError(f"Photo not found: {photo_id}")
    return photo


def _load_image_payload(photo: Photo, settings: Settings) -> bytes:
    image_path = _stored_photo_path(photo, settings)
    if not image_path.exists():
        raise WorkflowInputError(f"Stored image is missing: {photo.stored_path}")

    try:
        with Image.open(image_path) as image:
            image.thumbnail(
                (settings.workflow_max_image_edge_px, settings.workflow_max_image_edge_px)
            )
            output = BytesIO()
            if image.mode not in {"RGB", "L"}:
                image = image.convert("RGB")
            save_format = "JPEG" if image.mode == "RGB" else "PNG"
            image.save(output, format=save_format)
            return output.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        raise WorkflowInputError(f"Stored image is not readable: {photo.stored_path}") from exc


def _stored_photo_path(photo: Photo, settings: Settings) -> Path:
    upload_root = settings.upload_dir.resolve()
    candidate = (upload_root / photo.stored_path).resolve()
    try:
        candidate.relative_to(upload_root)
    except ValueError as exc:
        raise WorkflowInputError("Stored image path escapes upload directory") from exc
    return candidate


def _photo_context(photo: Photo) -> PhotoContext:
    if photo.id is None:
        raise WorkflowInputError("Photo must be persisted before analysis")
    return PhotoContext(
        id=int(photo.id),
        filename=photo.filename,
        captured_at=photo.captured_at.isoformat() if photo.captured_at else None,
        latitude=photo.latitude,
        longitude=photo.longitude,
        exif_json=photo.exif_json,
    )


def _analyzed_photo_contexts(session: Session, trip_id: int) -> list[AnalyzedPhotoContext]:
    photos = session.exec(
        select(Photo).where(Photo.trip_id == trip_id).order_by(Photo.created_at)
    ).all()
    contexts: list[AnalyzedPhotoContext] = []
    for photo in photos:
        if photo.id is None or photo.analysis is None:
            continue
        memory_payload = photo.analysis.raw_model_json.get("photo_memory")
        if memory_payload is None:
            continue
        contexts.append(
            AnalyzedPhotoContext(
                **_photo_context(photo).model_dump(),
                analysis=PhotoMemoryAnalysis.model_validate(memory_payload),
            )
        )
    return contexts


def _trip_context(trip: Trip) -> dict[str, Any]:
    if trip.id is None:
        raise WorkflowInputError("Trip must be persisted before workflow execution")
    return {
        "id": int(trip.id),
        "title": trip.title,
        "description": trip.description,
        "created_at": trip.created_at.isoformat(),
    }


def _trip_memory_context(memory: TripMemory | None) -> dict[str, Any] | None:
    if memory is None:
        return None
    return {
        "narrative_summary": memory.narrative_summary,
        "inferred_interests": memory.inferred_interests,
        "recurring_themes": memory.recurring_themes,
        "memorable_moments": memory.memorable_moments,
        "evidence_photo_ids": memory.evidence_photo_ids,
        "uncertainty_notes": memory.uncertainty_notes,
        "prompt_version": memory.prompt_version,
    }


def _validate_trip_synthesis_ids(
    synthesis: TripMemorySynthesis,
    valid_ids: set[int],
) -> None:
    _validate_ids(synthesis.evidence_photo_ids, valid_ids)
    for moment in synthesis.memorable_moments:
        _validate_ids(moment.evidence_photo_ids, valid_ids)


def _validate_ids(ids: list[int], valid_ids: set[int]) -> None:
    invalid = sorted(set(ids) - valid_ids)
    if invalid:
        raise WorkflowValidationError(
            f"Model referenced photo IDs outside the supplied context: {invalid}"
        )
