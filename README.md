# Private Memory Map

Travel memory is a local-first travel memory app. It helps you turn a
folder of trip photos into a private, searchable memory workspace with a map,
timeline, photo memories, trip synthesis, and grounded Q&A.

The app is built around a simple privacy promise: your photos, metadata,
database, and Gemma workflow run locally. The current implementation uses a
FastAPI backend, SQLite metadata store, local image uploads, a React workspace,
and an Ollama-hosted Gemma vision model.

## What It Does

- Create trips and attach notes.
- Upload travel photos to local storage.
- Skip duplicate imports and report rejected files.
- Extract EXIF timestamps and GPS coordinates when available.
- Show precise map pins only when coordinates exist in metadata.
- Run a fixed Gemma workflow to analyze photos and synthesize trip memory.
- Analyze all photos or only newly imported photos.
- Browse generated captions, scenes, moods, objects, activities, sensory
  details, interest signals, and uncertainty notes.
- Ask trip-level questions and receive answers grounded in evidence photo IDs.
- Search and filter local trip memories.
- Edit trip details, favorite photos, choose a cover, clear analysis, and delete
  local trips or photos.
- Export Markdown or a self-contained ZIP dossier with HTML, metadata, and
  copied photos.

## Product Shape

Private Memory Map is not a social travel app and not a cloud photo library. It
is a private memory workstation for looking back at personal trips.

The core experience is:

```text
Create a trip
  -> Import photos
  -> Skip duplicates and review import results
  -> Review map and timeline
  -> Run local Gemma analysis
  -> Read generated memories
  -> Ask grounded questions about the trip
  -> Refine, search, and export a private dossier
```

The app intentionally avoids guessing precise locations from image content.
Map coordinates come from EXIF/GPS metadata only. Gemma can describe visible
places and scenes, but it should not invent exact dates, events, or coordinates.

## Local LLM Workflow

The Gemma integration is a deterministic workflow, not an agent.

Python controls the sequence:

1. Load stored photo records and metadata.
2. Resize image payloads for local model input.
3. Call Gemma for structured photo analysis.
4. Validate and store the model output.
5. Call Gemma for trip-level synthesis.
6. Call Gemma for grounded Q&A using stored photo analyses and trip memory.

Gemma performs the reasoning at fixed checkpoints. It does not choose tools,
call APIs, or control application flow.

Each LLM step follows the same pattern:

- System instruction
- Prompt builder
- Structured output schema

The workflow code lives in `backend/app/workflows/`.

## Repository Layout

```text
backend/
  app/
    api/routes/       FastAPI route modules
    core/             settings and runtime paths
    db/               SQLModel database setup and tables
    schemas/          request and response models
    services/         upload, EXIF, storage, and model adapters
    workflows/        prompts, schemas, and deterministic Gemma workflow
  tests/              backend tests
frontend/
  src/
    api/              typed API client
    app/              top-level React app
    components/       upload, map, timeline, photo, and insights UI
    pages/            main trip workspace
scripts/              local reset and real-model smoke utilities
ollama_modelfiles/    local model setup assets
```

Runtime files are ignored by git:

```text
backend/local_data/private_memory_map.db
backend/local_data/uploads/
frontend/node_modules/
frontend/dist/
```

## Requirements

- Python 3.12+
- Node.js 20+
- Ollama
- A local Gemma vision model, configured by default as `gemma4:e4b-128k`

The app can be built and tested without running the real local model. Automated
backend tests use fake Gemma clients.

## Setup

Create and activate the Python environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Install frontend dependencies:

```bash
cd frontend
npm install
cd ..
```

## Run Locally

Start the backend:

```bash
.venv/bin/python -m uvicorn backend.app.main:app --reload --port 8000
```

Start the frontend:

```bash
cd frontend
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`.

The Analyze button starts a local background job. The frontend polls job
progress and refreshes the trip when analysis completes.

## Configuration

Common environment variables:

```text
PMM_GEMMA_MODEL=gemma4:e4b-128k
PMM_WORKFLOW_TEMPERATURE=0
PMM_WORKFLOW_NUM_CTX=32768
PMM_WORKFLOW_MAX_IMAGE_EDGE_PX=1280
PMM_WORKFLOW_RETRY_INVALID_JSON=1
PMM_WORKFLOW_MAX_QA_PHOTOS=60
PMM_PROMPT_VERSION=travel-memory-v1
```

Frontend API base URL:

```text
VITE_API_BASE_URL=http://localhost:8000
```

## Test

Backend:

```bash
.venv/bin/python -m pytest backend/tests
```

Frontend:

```bash
cd frontend
npm run build
```

## Local Demo Utilities

Reset the local SQLite database and uploaded files:

```bash
.venv/bin/python scripts/reset_local_data.py --yes
```

Run the real Gemma workflow against one image:

```bash
.venv/bin/python scripts/smoke_test_real_workflow.py /path/to/travel-photo.jpg
```

The smoke script depends on local model availability and hardware speed, so it
is not part of automated tests.

Seed a small synthetic trip without calling Gemma:

```bash
.venv/bin/python scripts/seed_demo_trip.py
```

Use `--replace` to recreate the seeded demo trip.

## API Surface

- `GET /api/health`
- `POST /api/trips`
- `GET /api/trips`
- `GET /api/trips/{trip_id}`
- `POST /api/trips/{trip_id}/photos`
- `POST /api/trips/{trip_id}/photos/import`
- `GET /api/trips/{trip_id}/photos`
- `PATCH /api/photos/{photo_id}`
- `DELETE /api/photos/{photo_id}`
- `POST /api/photos/{photo_id}/analyze`
- `POST /api/trips/{trip_id}/analyze`
- `DELETE /api/trips/{trip_id}/analysis`
- `GET /api/jobs/{job_id}`
- `POST /api/jobs/{job_id}/cancel`
- `POST /api/jobs/{job_id}/retry`
- `GET /api/trips/{trip_id}/jobs/latest`
- `POST /api/trips/{trip_id}/ask`
- `GET /api/trips/{trip_id}/questions`
- `PATCH /api/trips/{trip_id}`
- `DELETE /api/trips/{trip_id}`
- `GET /api/trips/{trip_id}/export.md`
- `GET /api/trips/{trip_id}/export.zip`

## License

MIT
