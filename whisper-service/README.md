# whisper-service

A small FastAPI sidecar that wraps [faster-whisper](https://github.com/SYSTRAN/faster-whisper) for local, offline transcription. The Next.js app calls this over HTTP on `localhost` — it's never exposed to the browser directly.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Requires **ffmpeg** on your system PATH (used to decode whatever audio format gets uploaded/recorded into the PCM format faster-whisper expects).

## Running

```bash
uvicorn main:app --port 8000
```

## Model download

The first transcription request triggers a download of the configured model (`WHISPER_MODEL_SIZE`, default `small`, ~465MB) from Hugging Face, cached under `~/.cache/huggingface`. This can take a minute or two depending on your connection; subsequent requests reuse the cached model and are fast.

Model size options (set via `WHISPER_MODEL_SIZE` in `.env`):

| Size | Approx. download | Notes |
|---|---|---|
| `tiny` | ~75MB | Fastest, least accurate |
| `base` | ~145MB | Good for low-resource machines |
| `small` | ~465MB | Default — good accuracy/speed balance on CPU |
| `medium` | ~1.5GB | Better accuracy, slower on CPU; consider if you have a GPU |

Set `WHISPER_DEVICE=cuda` and an appropriate `WHISPER_COMPUTE_TYPE` (e.g. `float16`) if you have an NVIDIA GPU available.

## API

`POST /transcribe` — multipart form upload with a `file` field. Returns:

```json
{
  "language": "en",
  "text": "...",
  "segments": [
    { "start": 0.0, "end": 4.2, "text": "...", "words": [{ "word": "...", "start": 0.0, "end": 0.3, "probability": 0.98 }] }
  ]
}
```

`GET /health` — returns `{"status": "ok"}`.
