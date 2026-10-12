import re
import shutil
import subprocess
import sys
import json

import torch
import whisperx
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.align import Align

from src.config import DOWNLOADS_DIR
from src import settings as settings_store
from src.align import build_karaoke, choose_alignment
from src.enrich import enrich_metadata
from src.romanize import romanize_lines
from src.stems import encode_stems
from src.translate import translate_song
from src.status import read_status, write_json_atomic
from src.lang import detect_lyrics_language
from src.lyrics import LyricsServiceError, search_synced_lyrics, parse_lrc, strip_lrc_timestamps
from src.youtube import extract_video_id, download_audio

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

console = Console()

# tqdm progress bars (used by Demucs) print "<percent>%|".
TQDM_PERCENT = re.compile(rb"(\d{1,3})%\|")



NO_LYRICS_MESSAGES = {
    "no_results": ("⚠ No lyrics found on LRCLIB.", "Step 2: No Lyrics"),
    "no_duration_match": ("⚠ No close duration match found on LRCLIB.", "Step 2: No Match"),
    "not_synced": ("⚠ Synced lyrics not available in the best match.", "Step 2: No Synced Lyrics"),
}


class KaraokePipeline:
    def __init__(self, url):
        self.url = url
        self.video_id = extract_video_id(url)
        if not self.video_id:
            raise ValueError("Invalid YouTube URL")

        self.work_dir = DOWNLOADS_DIR / self.video_id
        self.work_dir.mkdir(exist_ok=True)

        self.status_path = self.work_dir / "status.json"
        self.metadata_path = self.work_dir / "metadata.json"
        self.audio_path = self.work_dir / "audio.mp3"
        self.lrc_path = self.work_dir / "synced.lrc"
        self.karaoke_path = self.work_dir / "karaoke.json"
        self.vocals_path = self.work_dir / "vocals.wav"
        self.instrumental_path = self.work_dir / "instrumental.wav"
        self.translations_path = self.work_dir / "translations.json"

        self._last_progress = None

    def get_status(self):
        return read_status(self.status_path)

    def save_status(self, updates):
        status = self.get_status()
        status.update(updates)
        write_json_atomic(self.status_path, status)

    def report_progress(self, fraction):
        """Persist step progress (0-1) whenever the whole percentage changes."""
        percent = max(0, min(100, int(fraction * 100)))
        if percent != self._last_progress:
            self._last_progress = percent
            self.save_status({"progress": percent / 100})

    def process(self):
        console.print(Panel(
            Align.center(f"[bold magenta]🎤 SingAlongSync CLI 🎤[/bold magenta]\n[cyan]Video ID: {self.video_id}[/cyan]"),
            border_style="magenta",
            title="[bold yellow]Processing Startup[/bold yellow]"
        ))

        # 1. Check Cache
        if self.karaoke_path.exists():
            console.print(Panel(
                f"[bold green]✨ Already fully processed! Skipping. ✨[/bold green]\n"
                f"[dim]Output files located in: [italic]{self.work_dir}[/italic][/dim]",
                border_style="green",
                title="[bold green]Cache Hit[/bold green]"
            ))
            self._print_summary_table()
            return

        # Clear leftovers from a previous failed or cancelled run
        self.save_status({"stage": "starting", "progress": None, "error": None, "lyrics_found": None, "lyrics_error": None})

        # 2. Download Audio & Metadata
        if not self.audio_path.exists() or not self.metadata_path.exists():
            self.download_step()

        # 3. Fetch Lyrics
        if not self.lrc_path.exists():
            self.fetch_lyrics_step()

        # Without lyrics the song is still downloaded and separated (so it plays, and karaoke
        # works); lyrics can be added later from the player, which re-runs alignment.
        has_lyrics = self.lrc_path.exists()

        # 3b. Translate + romanise (optional). Runs before alignment, which can use the
        # romanised lines, and only needs the lyrics text.
        if has_lyrics and settings_store.translation_ready(settings_store.load()) and not self.translations_path.exists():
            self.translate_step()

        # 4. Separate Vocals (Demucs)
        if not self.vocals_path.exists():
            self.separate_step()
        # MP3 copies of the stems for the web player's karaoke mode
        encode_stems(self.work_dir, log=lambda message: console.print(f"[dim]  {message}[/dim]"))

        # 5. Align (WhisperX)
        if has_lyrics and not self.karaoke_path.exists():
            self.align_step()

        self.save_status({"processed": True, "stage": "complete", "no_lyrics": not has_lyrics})
        if has_lyrics:
            console.print(Panel(
                Align.center("[bold green]🌟 Pipeline Successfully Completed! 🌟[/bold green]\n[cyan]All audio stems and timing data have been built and saved.[/cyan]"),
                border_style="green",
                title="[bold green]Success[/bold green]"
            ))
        else:
            console.print(Panel(
                Align.center("[bold yellow]Saved without lyrics[/bold yellow]\n[cyan]The song plays (karaoke mode too). Add lyrics later from the player.[/cyan]"),
                border_style="yellow",
                title="[bold yellow]Done, No Lyrics[/bold yellow]"
            ))
        self._print_summary_table()

    def download_step(self):
        self.save_status({"stage": "downloading", "progress": 0})

        with console.status("[bold cyan]📥 Downloading audio & metadata via yt-dlp...[/bold cyan]", spinner="dots"):
            try:
                download_audio(
                    self.url,
                    self.work_dir,
                    self.video_id,
                    on_progress=self.report_progress,
                    on_retry=lambda message: console.print(f"[yellow]  {message}[/yellow]"),
                    # Written before the audio arrives so the web UI can show the title early
                    on_metadata=self._write_metadata,
                )
                # yt-dlp gave the basics; YouTube Music and iTunes fill in the rest (never fatal)
                metadata = self._read_metadata()
                log = lambda message: console.print(f"[dim]  {message}[/dim]")
                thumbnail = next((p.name for p in self.work_dir.glob("audio.*") if p.suffix != ".mp3"), "none")
                log(f"yt-dlp: \"{metadata['title']}\" by {metadata['artist']}, {metadata['duration']}s; thumbnail {thumbnail}")
                metadata = enrich_metadata(metadata, self.work_dir, log=log)
                self._write_metadata(metadata)
                self.save_status({"downloaded": True, "stage": "metadata_saved"})
            except Exception as e:
                console.print(f"[bold red]✗ Download failed: {e}[/bold red]")
                raise

        console.print(Panel(
            f"[bold green]✓ Download Completed Successfully![/bold green]\n"
            f"[yellow]Title:[/yellow] {metadata['title']}\n"
            f"[yellow]Artist:[/yellow] {metadata['artist']}\n"
            f"[yellow]Duration:[/yellow] {metadata['duration']} seconds\n"
            f"[yellow]Genre:[/yellow] {metadata.get('genre') or 'Unknown'}",
            border_style="green",
            title="[bold green]Step 1: Download Complete[/bold green]"
        ))

    def _write_metadata(self, metadata):
        write_json_atomic(self.metadata_path, metadata)

    def _read_metadata(self):
        with open(self.metadata_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def fetch_lyrics_step(self):
        self.save_status({"stage": "fetching_lyrics"})
        with open(self.metadata_path, "r") as f:
            meta = json.load(f)

        with console.status(f"[bold magenta]🔍 Fetching synced lyrics for '[italic]{meta['title']}[/italic]'...[/bold magenta]", spinner="dots"):
            try:
                synced_lyrics, reason = search_synced_lyrics(
                    meta["title"],
                    meta.get("artists") or [meta["artist"]],
                    meta["duration"],
                    log=lambda message: console.print(f"[dim]  {message}[/dim]"),
                )
            except LyricsServiceError as e:
                # LRCLIB being down: carry on without lyrics; they can be fetched later
                console.print(f"[bold yellow]⚠ {e} Continuing without lyrics.[/bold yellow]")
                self.save_status({"lyrics_found": False, "lyrics_error": str(e)})
                return
            except Exception as e:
                console.print(f"[bold red]✗ Lyrics search failed: {e}[/bold red]")
                self.save_status({"lyrics_found": False})
                return

        if not synced_lyrics:
            message, title = NO_LYRICS_MESSAGES[reason]
            console.print(Panel(
                f"[bold yellow]{message}[/bold yellow]\n"
                "[dim]Continuing without lyrics; you can add them later from the player.[/dim]",
                border_style="yellow",
                title=f"[bold yellow]{title}[/bold yellow]"
            ))
            self.save_status({"lyrics_found": False})
            return

        with open(self.lrc_path, "w", encoding="utf-8") as f:
            f.write(synced_lyrics)
        self.save_status({"lyrics_found": True})

        preview_text = ""
        preview_items = [f"  [italic]“{line['text']}”[/italic]" for line in parse_lrc(synced_lyrics)[:3] if line["text"].strip()]
        if preview_items:
            preview_text = "\n\n[yellow]Lyrics Preview:[/yellow]\n" + "\n".join(preview_items)

        console.print(Panel(
            f"[bold green]✓ Lyrics Fetched & Synced![/bold green]\n"
            f"[dim]Saved synced lyrics (.lrc) successfully.[/dim]{preview_text}",
            border_style="green",
            title="[bold green]Step 2: Lyrics Fetched[/bold green]"
        ))

    def separate_step(self):
        self.save_status({"stage": "separating_vocals", "progress": 0})

        console.print(Panel(
            "[bold yellow]⚡ Splitting Audio into Vocals & Instrumentals (Demucs)...[/bold yellow]\n"
            "[dim]Running Demucs high-quality stem separation. This uses heavy AI computation.[/dim]",
            border_style="yellow",
            title="[bold yellow]Step 3: Vocal Separation[/bold yellow]"
        ))

        out_dir = self.work_dir / "separated"
        cmd = [
            sys.executable, "-m", "demucs",
            "-n", "htdemucs",
            "--two-stems=vocals",
            "-o", str(out_dir),
            str(self.audio_path)
        ]
        self._run_with_progress(cmd)

        sep_dir = out_dir / "htdemucs" / self.audio_path.stem

        if (sep_dir / "vocals.wav").exists():
            shutil.move(str(sep_dir / "vocals.wav"), str(self.vocals_path))
            shutil.move(str(sep_dir / "no_vocals.wav"), str(self.instrumental_path))
            # Cleanup the empty demucs folder
            shutil.rmtree(out_dir)
            self.save_status({"separated": True, "stage": "separation_complete"})
            console.print(Panel(
                "[bold green]✓ Audio successfully split into Vocals and Instrumental stems![/bold green]\n"
                f"[yellow]Vocals:[/yellow] {self.vocals_path.name}\n"
                f"[yellow]Instrumental:[/yellow] {self.instrumental_path.name}",
                border_style="green",
                title="[bold green]Step 3 Complete[/bold green]"
            ))
        else:
            console.print("[bold red]✗ Separation failed: Output files not found where expected.[/bold red]")
            raise FileNotFoundError("Demucs output files not found.")

    def align_step(self):
        if not self.lrc_path.exists():
            console.print("[yellow]⚠ Skipping Step 4: No synced lyrics (.lrc) available for alignment.[/yellow]")
            return

        self.save_status({"stage": "aligning_lyrics", "progress": None})

        console.print(Panel(
            "[bold blue]🎙 Aligning Synced Lyrics (WhisperX)...[/bold blue]\n"
            "[dim]Matching vocal recordings with lyrics text down to the word level.[/dim]",
            border_style="blue",
            title="[bold blue]Step 4: Lyric Alignment[/bold blue]"
        ))

        with open(self.lrc_path, "r", encoding="utf-8") as f:
            lrc_raw = f.read()

        lines = [line for line in parse_lrc(lrc_raw) if line["text"].strip()]
        original_tokens = [line["text"].split() for line in lines]

        # Detect the script, then pick native or romanised alignment (Settings > Lyrics alignment)
        detection = detect_lyrics_language(strip_lrc_timestamps(lrc_raw))
        mode = settings_store.load().get("alignmentMode") or "auto"
        use_romanized, language_code = choose_alignment(detection["script"], mode)

        source_note = "lyrics as written"
        align_tokens = original_tokens
        if use_romanized:
            ai_romanized = self._read_translations().get("romanized") or {}
            align_tokens, stats = romanize_lines(original_tokens, ai_romanized)
            source_note = (
                f"romanised ({stats['ai']} lines from AI, {stats['rules']} by transliteration, "
                f"{stats['latin']} already Latin)"
            )

        console.print(Panel(
            f"[bold cyan]Detected Script:[/bold cyan] {detection['script'] or 'Unknown'}\n"
            f"[bold cyan]Likely Language:[/bold cyan] {detection['language']}\n"
            f"[bold cyan]Alignment:[/bold cyan] {mode} mode, {source_note}\n"
            f"[bold cyan]WhisperX Align Code:[/bold cyan] {language_code}",
            border_style="cyan",
            title="[bold cyan]Language Detection[/bold cyan]"
        ))
        self.save_status({
            "detected_script": detection["script"],
            "align_language_code": language_code,
            "alignment_mode": mode,
            "aligned_romanized": use_romanized,
        })

        segments = [
            {"start": line["start"], "end": line["end"], "text": " ".join(tokens)}
            for line, tokens in zip(lines, align_tokens)
        ]

        with console.status("[bold blue]Loading WhisperX model and alignment weights...[/bold blue]", spinner="aesthetic") as status:
            audio = whisperx.load_audio(str(self.vocals_path))
            status.update(f"[bold blue]Initializing '{language_code}' alignment model...[/bold blue]")
            model_a, metadata = whisperx.load_align_model(language_code=language_code, device=DEVICE)

            status.update("[bold blue]Executing millisecond-level word alignment...[/bold blue]")
            result = whisperx.align(segments, model_a, metadata, audio, DEVICE)

        # One entry per lyric line with the original words, even when romanised text was aligned
        karaoke_data = build_karaoke(lines, original_tokens, align_tokens, result["segments"])

        with open(self.karaoke_path, "w", encoding="utf-8") as f:
            json.dump(karaoke_data, f, indent=2, ensure_ascii=False)

        self.save_status({"aligned": True, "stage": "complete"})

        console.print(Panel(
            f"[bold green]✓ Word-level lyric alignment successfully completed![/bold green]\n"
            f"[dim]Generated timings for [yellow]{len(karaoke_data)}[/yellow] lyric lines.[/dim]",
            border_style="green",
            title="[bold green]Step 4 Complete[/bold green]"
        ))

    def _read_translations(self):
        try:
            return json.loads(self.translations_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def translate_step(self):
        settings = settings_store.load()
        self.save_status({"stage": "translating", "progress": None, "translation_error": None})
        with console.status(f"[bold magenta]🌐 Translating lyrics with {settings['model']}...[/bold magenta]", spinner="dots"):
            try:
                count = translate_song(self.work_dir, settings)
            except Exception as e:
                self.save_status({"translation_error": str(e)})
                console.print(Panel(
                    f"[bold yellow]⚠ Translation failed: {e}[/bold yellow]\n"
                    "[dim]The song is ready without translations.[/dim]",
                    border_style="yellow",
                    title="[bold yellow]Translation Skipped[/bold yellow]"
                ))
                return
        message = f"Translated {count} line(s) into English." if count else "Lyrics are already in English."
        console.print(Panel(
            f"[bold green]✓ {message}[/bold green]",
            border_style="green",
            title="[bold green]Translation Complete[/bold green]"
        ))

    def _run_with_progress(self, cmd):
        """Run a command, echoing its stderr while reading tqdm percentages from it."""
        proc = subprocess.Popen(cmd, stderr=subprocess.PIPE)
        out = sys.stderr.buffer
        while chunk := proc.stderr.read1(4096):
            out.write(chunk)
            out.flush()
            matches = TQDM_PERCENT.findall(chunk)
            if matches:
                self.report_progress(int(matches[-1]) / 100)
        if proc.wait() != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd)

    def _print_summary_table(self):
        table = Table(title="Generated Outputs Summary", border_style="cyan")
        table.add_column("File Type", style="bold yellow")
        table.add_column("File Name", style="white")
        table.add_column("Status", style="bold green")
        table.add_column("Size", style="dim")

        files_to_check = [
            ("Original Audio", self.audio_path),
            ("Metadata JSON", self.metadata_path),
            ("Synced LRC", self.lrc_path),
            ("Separated Vocals", self.vocals_path),
            ("Instrumental Track", self.instrumental_path),
            ("Aligned Timing Data", self.karaoke_path),
        ]

        for desc, path in files_to_check:
            if path.exists():
                size_kb = path.stat().st_size / 1024
                size_str = f"{size_kb:.1f} KB" if size_kb < 1024 else f"{size_kb/1024:.2f} MB"
                table.add_row(desc, path.name, "✓ Found", size_str)
            else:
                table.add_row(desc, path.name, "✗ Missing", "-", style="dim red")

        console.print(table)
