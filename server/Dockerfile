# SingAlongSync API + pipeline (Demucs, WhisperX, key/chord/beat analysis) on the GPU.
# PyTorch's CUDA 12.6 wheels bring their own CUDA libraries; the GPU itself comes from the
# NVIDIA container runtime (Docker Desktop with WSL 2 on Windows has it built in).
FROM python:3.11-slim

# ffmpeg for yt-dlp and the audio models, git for the beat_this dependency
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp needs a JavaScript runtime for YouTube's challenge
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PYTHONUNBUFFERED=1

# Dependencies first so code changes don't reinstall PyTorch
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project

COPY app.py ./
COPY src ./src

ENV PATH=/opt/venv/bin:$PATH \
    HOST=0.0.0.0 \
    PORT=8000
EXPOSE 8000
CMD ["python", "app.py"]
