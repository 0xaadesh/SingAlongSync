"""
SingAlongSync CLI: turn a YouTube / YouTube Music URL into a downloads/<video_id>/ karaoke bundle.

Usage (from server/):
    uv run src/cli.py "https://music.youtube.com/watch?v=..."
"""
import os
import sys
from pathlib import Path

# Allow running as a script (`uv run src/cli.py`): put server/ on the path so `src.*` imports resolve.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rich.panel import Panel
from rich.align import Align

from src.pipeline import KaraokePipeline, console


def main():
    # Beautiful welcome header
    console.print(Panel(
        Align.center("[bold magenta]🎤 Welcome to SingAlongSync 🎤[/bold magenta]\n[cyan]Separate vocals & align word-level timings with deep-learning precision.[/cyan]"),
        border_style="magenta"
    ))

    if os.getenv("HF_TOKEN"):
        console.print("[bold green]✓ HF TOKEN LOADED[/bold green]")
    else:
        console.print("[bold yellow]⚠ HF_TOKEN not found in .env — using unauthenticated Hugging Face requests.[/bold yellow]")

    if len(sys.argv) > 1:
        url = sys.argv[1]
    else:
        url = console.input("[bold yellow]🔗 Enter YouTube URL:[/bold yellow] ")

    pipeline = None
    try:
        pipeline = KaraokePipeline(url)
        pipeline.process()
    except Exception as e:
        # Record the failure so the web UI can show why the job stopped
        if pipeline:
            pipeline.save_status({"stage": "failed", "error": str(e)})
        console.print(Panel(
            f"[bold red]FATAL ERROR: {e}[/bold red]",
            border_style="red",
            title="[bold red]Execution Failed[/bold red]"
        ))
        sys.exit(1)


if __name__ == "__main__":
    main()
