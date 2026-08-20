import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from model import get_model

app = FastAPI(title="AI Notetaker Whisper Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), hotwords: str | None = Form(None)) -> dict:
    suffix = Path(file.filename or "").suffix or ".bin"
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    # hotwords: space-separated personal-dictionary terms; biases decoding
    # toward these spellings (names, acronyms, jargon). Kept short client-side.
    hotwords = (hotwords or "").strip()[:1000] or None

    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(contents)
        tmp.flush()

        try:
            model = get_model()
            segments_iter, info = model.transcribe(
                tmp.name, word_timestamps=True, hotwords=hotwords
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")

        segments = []
        full_text_parts = []
        for segment in segments_iter:
            text = segment.text.strip()
            full_text_parts.append(text)
            segments.append(
                {
                    "start": segment.start,
                    "end": segment.end,
                    "text": text,
                    "words": [
                        {
                            "word": w.word,
                            "start": w.start,
                            "end": w.end,
                            "probability": w.probability,
                        }
                        for w in (segment.words or [])
                    ],
                }
            )

    return {
        "language": info.language,
        "text": " ".join(full_text_parts),
        "segments": segments,
    }
