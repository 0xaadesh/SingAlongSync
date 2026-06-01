/**
 * Apple Music - YouLy+ Timed Karaoke Lyrics Player
 * Core Sync Engine & UI Controller
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const audio = document.getElementById('audio-player');
    const playBtn = document.getElementById('play-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const albumCard = document.getElementById('album-card');
    const albumArtwork = document.getElementById('album-artwork');
    const trackTitle = document.getElementById('track-title');
    const trackArtist = document.getElementById('track-artist');
    const trackAlbum = document.getElementById('track-album');
    
    // SPA View Elements
    const libraryView = document.getElementById('library-view');
    const playerView = document.getElementById('player-view');
    const songGrid = document.getElementById('song-grid');
    const backLibraryBtn = document.getElementById('back-library-btn');
    
    // Custom Scrubber Elements
    const scrubberBar = document.getElementById('scrubber-bar');
    const scrubberProgress = document.getElementById('scrubber-progress');
    const scrubberThumb = document.getElementById('scrubber-thumb');
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');

    // Volume Elements
    const volumeToggle = document.getElementById('volume-toggle');
    const volumeBar = document.getElementById('volume-bar');
    const volumeProgress = document.getElementById('volume-progress');
    const volumeThumb = document.getElementById('volume-thumb');

    // Lyrics Elements
    const lyricsPanel = document.getElementById('lyrics-panel');
    const lyricsScroller = document.getElementById('lyrics-scroller');

    // Settings Elements
    const settingsTrigger = document.getElementById('settings-trigger');
    const settingsSidebar = document.getElementById('settings-sidebar');
    const closeSidebar = document.getElementById('close-sidebar');
    const fontSizeDecrease = document.getElementById('font-decrease');
    const fontSizeIncrease = document.getElementById('font-increase');
    const fontSizeIndicator = document.getElementById('font-size-indicator');
    const translationSelect = document.getElementById('translation-select');
    const bgSpeedSelect = document.getElementById('bg-speed');
    const interactiveSeekingCheck = document.getElementById('interactive-seeking');
    const wordByWordToggle = document.getElementById('word-by-word-toggle');

    // Player State
    let songMetadata = null;
    let karaokeData = null;
    let currentLineIndex = -1;
    let lyricScale = 1.0;
    let isDraggingScrubber = false;
    let isDraggingVolume = false;
    let savedVolume = 0.8;
    let activeAnimationFrameId = null;
    let isSeeking = false;

    // Spanish & Japanese Translations Dictionary for stateside song lines
    const mockTranslations = {
        "es": {
            "(Ah-ah-ah)": "(Ah-ah-ah)",
            "I'm freezing outside, I feel my skin tight": "Me estoy congelando afuera, siento mi piel tensa",
            "My coat is inside, but I look up at you": "Mi abrigo está adentro, pero te miro a ti",
            "I tracked your plane ride, for when you're in tonight": "Rastreé el vuelo de tu avión, para cuando llegues esta noche",
            "Tell me, when is the next time I'll run into you?": "Dime, ¿cuándo será la próxima vez que me tope contigo?",
            "It sounds insane, right?": "Suena una locura, ¿verdad?",
            "I'll take the same flight": "Tomaré el mismo vuelo",
            "Wait at your bedside": "Esperaré al lado de tu cama",
            "I'll land right next to you": "Aterrizaré justo al lado tuyo",
            "I'm going stateside": "Me voy al otro lado del océano",
            "Where I'll see you tonight": "Donde te veré esta noche",
            "Tell me, how did a girl like me get into you?": "Dime, ¿cómo se enamoró una chica como yo de ti?",
            "(Into you)": "(De ti)",
            "Ah-ah-ah-ah": "Ah-ah-ah-ah",
            "You can be my American, ha, ha (ha, ha)": "Puedes ser mi americano, ja, ja (ja, ja)",
            "Ha, ha, ha, ha": "Ja, ja, ja, ja",
            "Is it right?": "¿Está bien?",
            "I don't know": "No lo sé",
            "But you're taking my control": "Pero estás tomando mi control",
            "Never been abroad before": "Nunca antes he estado en el extranjero",
            "Now I'm knocking through your door": "Ahora estoy tocando a tu puerta",
            "But you're nice, so I'll stay": "Pero eres amable, así que me quedaré",
            "Never met a British girl, you say?": "¿Dices que nunca conociste a una chica británica?"
        },
        "ja": {
            "(Ah-ah-ah)": "(ア、ア、ア)",
            "I'm freezing outside, I feel my skin tight": "外は凍えるほど寒くて、肌が強張るのを感じるの",
            "My coat is inside, but I look up at you": "コートは中にあるけれど、私はあなたを見上げている",
            "I tracked your plane ride, for when you're in tonight": "今夜あなたが戻る時のために、飛行機の便を追跡していたの",
            "Tell me, when is the next time I'll run into you?": "ねえ教えて、次にあなたと偶然出会うのはいつ？",
            "It sounds insane, right?": "狂っているように聞こえるよね？",
            "I'll take the same flight": "同じ飛行機に乗るわ",
            "Wait at your bedside": "あなたの枕元で待つから",
            "I'll land right next to you": "あなたのすぐ隣に着陸する",
            "I'm going stateside": "アメリカに向かっているの",
            "Where I'll see you tonight": "今夜そこであなたに会える場所へ",
            "Tell me, how did a girl like me get into you?": "教えて、私みたいな女の子がどうしてあなたに夢中になったの？",
            "(Into you)": "(あなたに夢中)",
            "Ah-ah-ah-ah": "ア、ア、ア、ア",
            "You can be my American, ha, ha (ha, ha)": "あなたは私のアメリカンになれるわ、ハ・ハ",
            "Ha, ha, ha, ha": "ハ、ハ、ハ、ハ",
            "Is it right?": "これでいいのかな？",
            "I don't know": "分からないけれど",
            "But you're taking my control": "でもあなたは私の心を奪っていく",
            "Never been abroad before": "これまで海外に行ったことなんてなかったのに",
            "Now I'm knocking through your door": "今はあなたのドアを叩いているの",
            "But you're nice, so I'll stay": "でもあなたは優しいから、ここにいるわ",
            "Never met a British girl, you say?": "イギリスの女の子には会ったことがないって言った？"
        }
    };

    // ==========================================================================
    // INITIALIZATION & DATA FETCHING
    // ==========================================================================

    async function loadSongs() {
        try {
            const res = await fetch('/api/songs');
            const songs = await res.json();
            
            if (!songs || songs.length === 0) {
                songGrid.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
                        <i data-lucide="music" style="width: 48px; height: 48px; margin-bottom: 16px; opacity: 0.5; margin-inline: auto;"></i>
                        <p style="font-size: 1.1rem; font-weight: 600; margin-bottom: 4px;">No Songs Found</p>
                        <p style="font-size: 0.9rem; opacity: 0.7;">Run SingAlongSync CLI on a YouTube URL to populate your library!</p>
                    </div>
                `;
                lucide.createIcons();
                return;
            }
            
            songGrid.innerHTML = songs.map(song => `
                <div class="song-card" data-id="${song.videoId}">
                    <div class="card-artwork-wrapper">
                        <img src="${song.thumbnail || 'https://i.ytimg.com/vi/iHsObIWkM-s/maxresdefault.jpg'}" alt="${song.title}" crossorigin="anonymous">
                    </div>
                    <div class="card-title">${song.title || "Unknown Title"}</div>
                    <div class="card-artist">${song.artist || "Unknown Artist"}</div>
                </div>
            `).join('');
            
            // Bind card selection
            document.querySelectorAll('.song-card').forEach(card => {
                card.addEventListener('click', () => {
                    const videoId = card.dataset.id;
                    playSong(videoId);
                });
            });
            
            lucide.createIcons();
        } catch (err) {
            console.error("SingAlongSync: Error loading catalog", err);
            songGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--accent);">Failed to load library catalog.</div>`;
        }
    }

    async function playSong(videoId) {
        try {
            // Smooth view transition
            libraryView.classList.add('hidden');
            playerView.classList.remove('hidden');
            
            // Clean visual state while fetching assets
            trackTitle.textContent = "Loading...";
            trackArtist.textContent = "";
            trackAlbum.textContent = "";
            albumArtwork.src = "";
            lyricsScroller.innerHTML = `
                <div class="lyrics-loading">
                    <div class="pulse-bar"></div>
                    <div class="pulse-bar"></div>
                    <div class="pulse-bar"></div>
                </div>
            `;
            
            // 1. Fetch Metadata
            const metaRes = await fetch(`/downloads/${videoId}/metadata.json`);
            songMetadata = await metaRes.json();
            
            // 2. Fetch word aligned timed lyrics
            const lyricsRes = await fetch(`/downloads/${videoId}/karaoke.json`);
            karaokeData = await lyricsRes.json();
            
            // 3. Fetch Audio track
            try {
                const audioRes = await fetch(`/downloads/${videoId}/audio.mp3`);
                const audioBlob = await audioRes.blob();
                const audioUrl = URL.createObjectURL(audioBlob);
                audio.src = audioUrl;
            } catch (audioErr) {
                console.warn("SingAlongSync: Falling back to direct audio stream URL.", audioErr);
                audio.src = `/downloads/${videoId}/audio.mp3`;
            }
            
            // 4. Render track details
            renderSongMetadata();
            
            // 5. Render Lyrics
            renderLyrics();

            // Update Volume visual
            audio.volume = savedVolume;
            updateVolumeUI(savedVolume);

            // Set browser document title
            document.title = `🎤 SingAlongSync - ${songMetadata.title || "Sing Along"}`;

            // Play track
            audio.load();
            audio.play();

            // Load icons
            lucide.createIcons();
            
        } catch (error) {
            console.error("SingAlongSync: Error starting track play", error);
            lyricsScroller.innerHTML = `<div class="lyrics-line" style="text-align:center; color:var(--accent);">Failed to load active track assets.</div>`;
        }
    }

    function backToLibrary() {
        // Stop audio
        audio.pause();
        
        // Reset document title
        document.title = "SingAlongSync - Apple Music Style";
        
        // View transition
        playerView.classList.add('hidden');
        libraryView.classList.remove('hidden');
        
        // Restore standard background colors
        document.documentElement.style.setProperty('--accent', '#ff2d55');
        const fallbackStyle = document.createElement('style');
        fallbackStyle.innerHTML = `
            .blob-1 { background: radial-gradient(circle, rgba(255, 45, 85, 0.8) 0%, rgba(255, 45, 85, 0) 70%) !important; }
            .blob-2 { background: radial-gradient(circle, rgba(88, 86, 214, 0.8) 0%, rgba(88, 86, 214, 0) 70%) !important; }
            .blob-3 { background: radial-gradient(circle, rgba(0, 122, 255, 0.6) 0%, rgba(0, 122, 255, 0) 70%) !important; }
        `;
        document.head.appendChild(fallbackStyle);
        
        // Refresh catalog list
        loadSongs();
    }

    function renderSongMetadata() {
        trackTitle.textContent = songMetadata.title || "Unknown Title";
        trackArtist.textContent = songMetadata.artist || "Unknown Artist";
        trackAlbum.textContent = songMetadata.album ? `Album — ${songMetadata.album}` : "";
        albumArtwork.src = songMetadata.thumbnail || "https://i.ytimg.com/vi/iHsObIWkM-s/maxresdefault.jpg";
        
        // Extract Dominant Colors for Canvas overlay
        albumArtwork.onload = () => {
            extractArtworkPalette(albumArtwork);
        };
        
        // Set timeline duration
        totalTimeEl.textContent = formatTime(songMetadata.duration || 185);
    }

    // ==========================================================================
    // DOMINANT COLOR EXTRACTION (Dynamic Backdrops)
    // ==========================================================================

    function extractArtworkPalette(imgEl) {
        try {
            // Draw image on temporary offscreen canvas to sample pixels
            const canvas = document.createElement('canvas');
            canvas.width = 10;
            canvas.height = 10;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgEl, 0, 0, 10, 10);
            
            const imgData = ctx.getImageData(0, 0, 10, 10).data;
            let rSum = 0, gSum = 0, bSum = 0;
            let sampleColors = [];

            for (let i = 0; i < imgData.length; i += 4) {
                const r = imgData[i];
                const g = imgData[i + 1];
                const b = imgData[i + 2];
                const a = imgData[i + 3];
                
                if (a > 200) {
                    rSum += r;
                    gSum += g;
                    bSum += b;
                    sampleColors.push({ r, g, b });
                }
            }

            const count = sampleColors.length;
            if (count === 0) return;

            // Average color
            const avgR = Math.round(rSum / count);
            const avgG = Math.round(gSum / count);
            const avgB = Math.round(bSum / count);

            // Fetch vibrant highlights
            sampleColors.sort((x, y) => (y.r + y.g + y.b) - (x.r + x.g + x.b));
            
            const vibrant1 = sampleColors[0] || { r: 255, g: 45, b: 85 };
            const vibrant2 = sampleColors[Math.floor(count / 2)] || { r: 88, g: 86, b: 214 };
            const vibrant3 = sampleColors[count - 1] || { r: 0, g: 122, b: 255 };

            // Inject palette variables dynamically into HTML/CSS
            document.documentElement.style.setProperty('--accent', `rgb(${vibrant1.r}, ${vibrant1.g}, ${vibrant1.b})`);
            
            // Re-render ambient background radial blobs with actual song colors!
            const style = document.createElement('style');
            style.innerHTML = `
                .blob-1 { background: radial-gradient(circle, rgba(${vibrant1.r}, ${vibrant1.g}, ${vibrant1.b}, 0.8) 0%, rgba(${vibrant1.r}, ${vibrant1.g}, ${vibrant1.b}, 0) 70%) !important; }
                .blob-2 { background: radial-gradient(circle, rgba(${vibrant2.r}, ${vibrant2.g}, ${vibrant2.b}, 0.8) 0%, rgba(${vibrant2.r}, ${vibrant2.g}, ${vibrant2.b}, 0) 70%) !important; }
                .blob-3 { background: radial-gradient(circle, rgba(${vibrant3.r}, ${vibrant3.g}, ${vibrant3.b}, 0.6) 0%, rgba(${vibrant3.r}, ${vibrant3.g}, ${vibrant3.b}, 0) 70%) !important; }
            `;
            document.head.appendChild(style);

        } catch (e) {
            console.warn("YouLy+: Unable to sample artwork palette due to CORS limitations. Using high-end fallback gradient.", e);
        }
    }

    // ==========================================================================
    // LYRIC RENDERING ENGINE
    // ==========================================================================

    function renderLyrics() {
        lyricsScroller.innerHTML = "";
        
        if (!karaokeData || karaokeData.length === 0) {
            lyricsScroller.innerHTML = `<div class="lyrics-line" style="text-align:center;">No timed lyrics available.</div>`;
            return;
        }

        const isWordByWord = wordByWordToggle.checked;

        karaokeData.forEach((lineObj, lineIdx) => {
            const lineDiv = document.createElement('div');
            lineDiv.classList.add('lyrics-line');
            lineDiv.dataset.index = lineIdx;
            lineDiv.dataset.start = lineObj.start;
            lineDiv.dataset.end = lineObj.end;

            // Generate content
            if (isWordByWord && lineObj.words && lineObj.words.length > 0) {
                // Word-by-word wrapping
                lineObj.words.forEach((wordObj, wordIdx) => {
                    const wordSpan = document.createElement('span');
                    wordSpan.classList.add('lyrics-word');
                    wordSpan.textContent = wordObj.word;
                    wordSpan.dataset.start = wordObj.start;
                    wordSpan.dataset.end = wordObj.end;
                    lineDiv.appendChild(wordSpan);
                });
            } else {
                // Simple static string rendering
                lineDiv.textContent = lineObj.line;
            }

            // Injected mock translations containers
            const transEs = document.createElement('div');
            transEs.classList.add('lyrics-translation');
            transEs.dataset.lang = 'es';
            transEs.textContent = mockTranslations.es[lineObj.line] || "";

            const transJa = document.createElement('div');
            transJa.classList.add('lyrics-translation');
            transJa.dataset.lang = 'ja';
            transJa.textContent = mockTranslations.ja[lineObj.line] || "";

            lineDiv.appendChild(transEs);
            lineDiv.appendChild(transJa);

            // Handle Seek-on-click
            lineDiv.addEventListener('click', (e) => {
                // Prevent trigger if setting checkbox is disabled
                if (!interactiveSeekingCheck.checked) return;
                
                // Seek audio player with synchronous lock
                isSeeking = true;
                audio.currentTime = lineObj.start;
                
                // Immediately align scrolling & class highlights
                syncLyricsVisuals(lineObj.start);
                
                // Force play
                if (audio.paused) {
                    audio.play();
                }
            });

            lyricsScroller.appendChild(lineDiv);
        });

        // Trigger active language layout alignment
        updateLanguageDisplay();
    }

    function updateLanguageDisplay() {
        const selectedLang = translationSelect.value;
        const translations = document.querySelectorAll('.lyrics-translation');
        
        if (selectedLang === 'none') {
            lyricsPanel.classList.remove('show-translations');
            translations.forEach(t => t.style.display = 'none');
        } else {
            lyricsPanel.classList.add('show-translations');
            translations.forEach(t => {
                if (t.dataset.lang === selectedLang && t.textContent.trim() !== "") {
                    t.style.display = 'block';
                } else {
                    t.style.display = 'none';
                }
            });
        }
    }

    // ==========================================================================
    // AUDIO SYNC LOOP & HIGH-PRECISION TICK ENGINE
    // ==========================================================================

    function startSyncLoop() {
        if (activeAnimationFrameId) {
            cancelAnimationFrame(activeAnimationFrameId);
        }
        
        function tick() {
            if (!isDraggingScrubber && !isSeeking) {
                const currentTime = audio.currentTime;
                
                // Update scrubber track progress
                const duration = audio.duration || songMetadata.duration || 185;
                const percent = (currentTime / duration) * 100;
                
                scrubberProgress.style.width = `${percent}%`;
                scrubberThumb.style.left = `${percent}%`;
                currentTimeEl.textContent = formatTime(currentTime);
                
                // Precise lyrics scroll alignment and highlight tracker
                syncLyricsVisuals(currentTime);
            }
            
            if (!audio.paused) {
                activeAnimationFrameId = requestAnimationFrame(tick);
            }
        }
        
        activeAnimationFrameId = requestAnimationFrame(tick);
    }

    function stopSyncLoop() {
        if (activeAnimationFrameId) {
            cancelAnimationFrame(activeAnimationFrameId);
            activeAnimationFrameId = null;
        }
    }

    function syncLyricsVisuals(time) {
        if (!karaokeData) return;

        let activeLineIndex = -1;

        // Find active line
        for (let i = 0; i < karaokeData.length; i++) {
            const line = karaokeData[i];
            if (time >= line.start && time <= line.end) {
                activeLineIndex = i;
                break;
            }
            // Fallback: Catch interval gaps between lines
            if (i < karaokeData.length - 1 && time > line.end && time < karaokeData[i + 1].start) {
                activeLineIndex = i; // keep highlight on previous line during brief gaps
                break;
            }
        }

        // If time is beyond the last line
        if (activeLineIndex === -1 && karaokeData.length > 0 && time > karaokeData[karaokeData.length - 1].end) {
            activeLineIndex = karaokeData.length - 1;
        }

        // Only scroll and transition if index changes
        if (activeLineIndex !== currentLineIndex) {
            currentLineIndex = activeLineIndex;
            
            // Get all line nodes
            const lines = lyricsScroller.querySelectorAll('.lyrics-line');
            lines.forEach((lineNode, idx) => {
                lineNode.classList.remove('active', 'passed');
                
                if (idx === currentLineIndex) {
                    lineNode.classList.add('active');
                } else if (idx < currentLineIndex) {
                    lineNode.classList.add('passed');
                }
            });

            // Smooth Scroll Centering (Apple Music Signature fluid scroll)
            const activeLineNode = lyricsScroller.querySelector(`.lyrics-line[data-index="${currentLineIndex}"]`);
            if (activeLineNode) {
                const containerHeight = lyricsPanel.clientHeight;
                const nodeTop = activeLineNode.offsetTop;
                const nodeHeight = activeLineNode.offsetHeight;
                
                // Perfect vertical centering target
                const scrollOffset = nodeTop - (containerHeight / 2) + (nodeHeight / 2);
                
                lyricsPanel.scrollTo({
                    top: scrollOffset,
                    behavior: 'smooth'
                });
            }
        }

        // SYLLABLE / WORD LEVEL HIGH-PRECISION HIGHLIGHTS
        if (currentLineIndex !== -1) {
            const activeLineNode = lyricsScroller.querySelector(`.lyrics-line[data-index="${currentLineIndex}"]`);
            if (activeLineNode) {
                const words = activeLineNode.querySelectorAll('.lyrics-word');
                words.forEach(wordSpan => {
                    const start = parseFloat(wordSpan.dataset.start);
                    const end = parseFloat(wordSpan.dataset.end);
                    
                    if (time >= start) {
                        wordSpan.classList.add('highlighted');
                    } else {
                        wordSpan.classList.remove('highlighted');
                    }
                });
            }
        }
    }

    // ==========================================================================
    // AUDIO CONTROLS INTERACTIVE BEHAVIOR
    // ==========================================================================

    playBtn.addEventListener('click', togglePlayback);
    
    function togglePlayback() {
        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    }

    // Seeking listeners to prevent race conditions during async audio loads
    audio.addEventListener('seeking', () => {
        isSeeking = true;
    });
    audio.addEventListener('seeked', () => {
        isSeeking = false;
    });

    // Sync on audio player native states (safeguards for browser background suspension)
    audio.addEventListener('play', () => {
        playBtn.classList.add('playing');
        albumCard.classList.add('playing');
        startSyncLoop();
    });

    audio.addEventListener('pause', () => {
        playBtn.classList.remove('playing');
        albumCard.classList.remove('playing');
        stopSyncLoop();
    });

    audio.addEventListener('ended', () => {
        playBtn.classList.remove('playing');
        albumCard.classList.remove('playing');
        stopSyncLoop();
        audio.currentTime = 0;
        scrubberProgress.style.width = '0%';
        scrubberThumb.style.left = '0%';
        currentTimeEl.textContent = '0:00';
        syncLyricsVisuals(0);
    });

    // Skip Back / Skip Forward
    prevBtn.addEventListener('click', () => {
        isSeeking = true;
        // Jump back 10 seconds or restart track
        if (audio.currentTime > 5) {
            audio.currentTime = 0;
        } else {
            audio.currentTime = Math.max(0, audio.currentTime - 10);
        }
        syncLyricsVisuals(audio.currentTime);
    });

    nextBtn.addEventListener('click', () => {
        isSeeking = true;
        // Jump forward 10 seconds
        audio.currentTime = Math.min(audio.duration || songMetadata.duration || 185, audio.currentTime + 10);
        syncLyricsVisuals(audio.currentTime);
    });

    // ==========================================================================
    // TIMELINE SCRUBBING EVENTS (Mouse drag / touch slider)
    // ==========================================================================

    scrubberBar.addEventListener('mousedown', (e) => {
        isDraggingScrubber = true;
        handleScrubberMove(e);
    });

    window.addEventListener('mousemove', (e) => {
        if (isDraggingScrubber) {
            handleScrubberMove(e);
        }
    });

    window.addEventListener('mouseup', () => {
        if (isDraggingScrubber) {
            isDraggingScrubber = false;
        }
    });

    function handleScrubberMove(e) {
        const rect = scrubberBar.getBoundingClientRect();
        let offsetX = e.clientX - rect.left;
        offsetX = Math.max(0, Math.min(offsetX, rect.width));
        
        const percent = offsetX / rect.width;
        scrubberProgress.style.width = `${percent * 100}%`;
        scrubberThumb.style.left = `${percent * 100}%`;
        
        const duration = audio.duration || songMetadata.duration || 185;
        const targetTime = percent * duration;
        currentTimeEl.textContent = formatTime(targetTime);
        
        // Seek audio track with synchronous lock
        isSeeking = true;
        audio.currentTime = targetTime;
        
        // Render alignment visuals instantly
        syncLyricsVisuals(targetTime);
    }

    // ==========================================================================
    // VOLUME SLIDER EVENTS
    // ==========================================================================

    volumeToggle.addEventListener('click', () => {
        if (audio.volume > 0) {
            savedVolume = audio.volume;
            audio.volume = 0;
            updateVolumeUI(0);
        } else {
            audio.volume = savedVolume;
            updateVolumeUI(savedVolume);
        }
    });

    volumeBar.addEventListener('mousedown', (e) => {
        isDraggingVolume = true;
        handleVolumeMove(e);
    });

    window.addEventListener('mousemove', (e) => {
        if (isDraggingVolume) {
            handleVolumeMove(e);
        }
    });

    window.addEventListener('mouseup', () => {
        if (isDraggingVolume) {
            isDraggingVolume = false;
        }
    });

    function handleVolumeMove(e) {
        const rect = volumeBar.getBoundingClientRect();
        let offsetX = e.clientX - rect.left;
        offsetX = Math.max(0, Math.min(offsetX, rect.width));
        
        const volume = offsetX / rect.width;
        audio.volume = volume;
        savedVolume = volume;
        
        updateVolumeUI(volume);
    }

    function updateVolumeUI(volume) {
        volumeProgress.style.width = `${volume * 100}%`;
        volumeThumb.style.left = `${volume * 100}%`;

        // Update Volume classes
        volumeToggle.classList.remove('mute', 'low', 'high');
        if (volume === 0) {
            volumeToggle.classList.add('mute');
        } else if (volume < 0.4) {
            volumeToggle.classList.add('low');
        } else {
            volumeToggle.classList.add('high');
        }
    }

    // ==========================================================================
    // SIDEBAR & ACCESS PANEL EVENTS
    // ==========================================================================

    settingsTrigger.addEventListener('click', () => {
        settingsSidebar.classList.add('open');
    });

    closeSidebar.addEventListener('click', () => {
        settingsSidebar.classList.remove('open');
    });

    // Close when clicking outside of the sidebar
    document.addEventListener('click', (e) => {
        if (!settingsSidebar.contains(e.target) && 
            !settingsTrigger.contains(e.target) && 
            settingsSidebar.classList.contains('open')) {
            settingsSidebar.classList.remove('open');
        }
    });

    // Font Scaling Slider
    fontSizeDecrease.addEventListener('click', () => {
        lyricScale = Math.max(0.6, lyricScale - 0.1);
        updateFontSize();
    });

    fontSizeIncrease.addEventListener('click', () => {
        lyricScale = Math.min(1.5, lyricScale + 0.1);
        updateFontSize();
    });

    function updateFontSize() {
        document.documentElement.style.setProperty('--lyric-scale', lyricScale);
        fontSizeIndicator.textContent = `${Math.round(lyricScale * 100)}%`;
        
        // Re-scroll the active line so it stays aligned at the new sizing
        const activeLineNode = lyricsScroller.querySelector(`.lyrics-line[data-index="${currentLineIndex}"]`);
        if (activeLineNode) {
            lyricsPanel.scrollTop = activeLineNode.offsetTop - (lyricsPanel.clientHeight / 2) + (activeLineNode.offsetHeight / 2);
        }
    }

    translationSelect.addEventListener('change', () => {
        updateLanguageDisplay();
    });

    bgSpeedSelect.addEventListener('change', () => {
        const speed = bgSpeedSelect.value;
        const backdrop = document.getElementById('ambient-backdrop');
        
        backdrop.classList.remove('slow', 'normal', 'fast');
        if (speed !== 'normal') {
            backdrop.classList.add(speed);
        }
    });

    wordByWordToggle.addEventListener('change', () => {
        renderLyrics();
        syncLyricsVisuals(audio.currentTime);
    });

    // ==========================================================================
    // UTILITY HELPER FUNCTIONS
    // ==========================================================================

    function formatTime(seconds) {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    }

    // Bind library back button
    backLibraryBtn.addEventListener('click', backToLibrary);

    // Initial catalog fetch on load
    loadSongs();
});
