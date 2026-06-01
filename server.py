from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json
from pathlib import Path

app = FastAPI(title="SingAlongSync Server")

# Ensure the downloads directory exists to prevent Starlette raising RuntimeError
downloads_dir = Path("downloads")
downloads_dir.mkdir(exist_ok=True)

# Mount downloads directory statically under /downloads
app.mount("/downloads", StaticFiles(directory="downloads"), name="downloads")

# API Endpoint: List all available songs
@app.get("/api/songs")
async def list_songs():
    songs = []
    downloads_dir = Path("downloads")
    if not downloads_dir.exists():
        return []
        
    for song_dir in downloads_dir.iterdir():
        if song_dir.is_dir():
            meta_path = song_dir / "metadata.json"
            karaoke_path = song_dir / "karaoke.json"
            # Ensure the song has both metadata and word alignment timing data
            if meta_path.exists() and karaoke_path.exists():
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                        # Standardize mapping videoId to directory name
                        meta["videoId"] = song_dir.name
                        songs.append(meta)
                except Exception:
                    # Skip folders that have corrupted files
                    continue
    return songs

# Serve the main frontend page at root
@app.get("/")
async def read_index():
    index_path = Path("frontend") / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="index.html not found in frontend directory")
    return FileResponse(index_path)

# Mount the rest of the frontend folder statically at root (handles app.js, styles.css, etc.)
app.mount("/", StaticFiles(directory="frontend"), name="frontend")

if __name__ == "__main__":
    import uvicorn
    # Start uvicorn server on localhost:8000
    uvicorn.run(app, host="127.0.0.1", port=8000)
