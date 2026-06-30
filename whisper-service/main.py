from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

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
async def transcribe(file: UploadFile = File(...)) -> dict:
    # Stub: proves the Next.js <-> sidecar wiring before faster-whisper is wired in.
    await file.read()
    return {
        "language": "en",
        "text": "This is a stub transcript. Replace with real faster-whisper output.",
        "segments": [
            {
                "start": 0.0,
                "end": 3.0,
                "text": "This is a stub transcript.",
                "words": [],
            }
        ],
    }
