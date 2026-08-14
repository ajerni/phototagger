# macOS Setup Guide

## Step 1 — Python virtual environment

```bash
cd /Users/andi/projekte/photoprocess/private-memory-map-gemma4
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## Step 2 — Frontend dependencies

```bash
cd /Users/andi/projekte/photoprocess/private-memory-map-gemma4/frontend
npm install
cd ..
```

## Step 3 — Set the correct Ollama model name

```bash
echo "PMM_GEMMA_MODEL=gemma4:e4b" > /Users/andi/projekte/photoprocess/private-memory-map-gemma4/.env
```

## Step 4 — Run backend and frontend (two terminals)

**Terminal 1 — backend:**
```bash
cd /Users/andi/projekte/photoprocess/private-memory-map-gemma4
source .venv/bin/activate
python -m uvicorn backend.app.main:app --reload --port 8000
```

**Terminal 2 — frontend:**
```bash
cd /Users/andi/projekte/photoprocess/private-memory-map-gemma4/frontend
npm run dev
```

Open `http://localhost:5173` in your browser.

Your photos are at `/Users/andi/projekte/photoprocess/photos` — import them through the UI after creating a trip.
