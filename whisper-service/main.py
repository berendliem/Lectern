import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException

from model import get_model

# No CORS middleware on purpose: this service is only ever called server-side
# by the Next.js app, never by a browser, so nothing should be granted
# cross-origin read access to it.
app = FastAPI(title="Lectern Whisper Service")


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
    # toward these spellings (names, acronyms, jargon). Kept short client-side;
    # if over the cap anyway, drop the last (partial) term rather than slicing
    # a word in half.
    hotwords = (hotwords or "").strip()
    if len(hotwords) > 1000:
        hotwords = hotwords[:1000].rsplit(" ", 1)[0]
    hotwords = hotwords or None

    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(contents)
        tmp.flush()

        try:
            model = get_model()
            # VAD filtering skips long silences (pauses, slide changes), which
            # are a known cause of Whisper hallucinating repeated/fabricated
            # text in lecture recordings. Disable with WHISPER_VAD_FILTER=0.
            vad_filter = os.environ.get("WHISPER_VAD_FILTER", "1") != "0"
            segments_iter, info = model.transcribe(
                tmp.name, word_timestamps=True, hotwords=hotwords, vad_filter=vad_filter
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
