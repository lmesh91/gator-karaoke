# Gator Karaoke Club 🐊🎤

Live sing-along lyrics synced to whatever song you're playing. Lines light up orange word by word as you sing.

No API key is needed. The local launcher adds direct YouTube search with yt-dlp; a static-hosted version also works using public search mirrors:

| What | Where it comes from |
| --- | --- |
| Word-by-word lyrics | [BiniLyrics](https://lyrics.binimum.org/) search, with timed files from [lrc.red](https://lrc.red/) |
| Line-by-line lyrics | [LRCLIB](https://lrclib.net) |
| Official music videos | [Wikidata](https://www.wikidata.org/) (the "YouTube video ID" property) |
| Other videos and instrumentals | Direct YouTube search with [yt-dlp](https://github.com/yt-dlp/yt-dlp) when using the local launcher; public [Invidious](https://invidious.io/) mirrors as a fallback |

## How it works

1. **Find the song.** Search by title, artist, or both. Every word-by-word result is listed above every line-by-line result, even when a line-by-line one is a closer text match. The Find card also says which timing is on stage.
2. **Video & backing track.** Picking a result finds its video automatically and cues the one whose length best matches the recording the lyrics were timed against, preferring the official music video when it lines up. Other matches are listed with how much longer or shorter they are. Videos that can't be embedded are skipped automatically.
3. **Instrumental.** On by default: when a backing track is found for the same song, you sing over it. It drives the lyrics, while the music video keeps playing muted behind them and follows along. Switch it off to hear the original vocals; the setting carries over to the next song.

### Using your own audio

Under **Use your own audio instead**:

- **Audio file**: drop in an MP3 / M4A / FLAC / WAV. The title and artist are read from its ID3 tags (or the file name), and the synced lyrics whose length best matches the audio are loaded automatically.
- **YouTube link**: paste a link. Lyrics are found as soon as the video title is available, without waiting for playback, duration, or word timing.
- **Other device**: playing from Spotify or a speaker? Press <kbd>Space</kbd> as you hit play there, then <kbd>T</kbd> the moment the next line starts to lock the sync.

Your own audio is never replaced by an automatically found video. Under **Background**, choose the video behind the lyrics, a MilkDrop visualizer, or a hidden video.

### Visualizer backgrounds

**Visualizer** replaces the corner video option with full-opacity [Butterchurn](https://github.com/jberg/butterchurn) MilkDrop backgrounds. Pick a preset, shuffle, or let presets blend every 30 seconds during playback. Your selection is remembered. Lyrics always use white with orange highlights, with dark outlines for readability on every background. Highlighted words keep their orange color after singing. The output canvas and renderer resize together, so fullscreen shows the entire visualizer without cropping.

Audio files react automatically. When using the local launcher, selecting a YouTube song in visualizer mode prepares native song audio automatically. Playback and word timing switch to that audio at the current position; the music video stays muted and follows along. Play/pause, seeking, and instrumental selection work with the native track. This works in Firefox without any screen-sharing permission. Initial audio preparation may take a few seconds; failure leaves the embedded player available and offers a retry.

On a static-hosted version, Chrome/Edge can use **Connect tab audio…**, selecting the current browser tab with **Share tab audio** enabled. The browser uses its screen-sharing dialog; the app ignores video and only analyzes audio locally. Firefox does not support audio through that capture API, so its screen picker is never opened: use the local launcher or an audio file instead. Ambient visualizations remain available in every browser. No microphone is requested, and nothing captured is uploaded.

Visualizers need WebGL 2. If graphics or audio sharing are unavailable, ordinary playback stays available. The engine and three official preset packs are pinned and hosted in `vendor/`, with upstream licenses. See [vendor/README.md](vendor/README.md).

### Video search

The local launcher runs a loopback-only Python server and searches YouTube directly through yt-dlp. It returns video IDs, titles, channels, and durations; ranking and the existing YouTube embedded player handle playback, including instrumentals. It does not use browser cookies or require an API key. For visualizers, it temporarily caches up to six audio tracks (at most 40 MB and 30 minutes per track) so browsers can play and analyze them directly. The temporary cache is removed when the server exits. Results are cached for five minutes. The video card identifies when direct search is connected. YouTube can still block or rate-limit extraction; keep yt-dlp updated if search stops working. Native song audio makes YouTube visualizers work without tab capture, including Firefox.

If the helper is absent or a direct lookup fails, search tries public HTTPS mirrors from the Invidious directory, preferring entries advertised as API/CORS compatible but also trying entries with false or unknown flags. HTTP failures (including 530), network/CORS errors, timeouts, and invalid responses advance to another mirror. Successful mirrors are preferred; failures cool down for one minute. The directory refreshes every ten minutes (one minute after a directory failure), with several bundled backups if it cannot be fetched. Search can still fail if every reachable instance disables its API or blocks browser requests. A manual fallback is available as soon as media search starts: **Find song on YouTube** and **Instrumental** open searches for the selected artist and song in a new tab. Paste the chosen video link into the field below; check **Use as instrumental backing track** when appropriate. The selected lyrics and timing stay on stage, and late automatic results cannot replace the pasted choice. The version-length hint helps find a recording that matches the lyrics.

## Features

- Word-by-word highlight (real word timings when the song has them, estimated otherwise)
- Held notes at any position follow the supplied word/syllable timestamps. Adjacent syllables keep their original spacing, so “newborn” stays one word.
- A label in the Find card identifies the timing source or says when timing is estimated. Missing word timings, a different recording length, or unavailable providers leave the LRCLIB fallback in place. Use “Retry word timing” to recover from a temporary failure.
- Word timing loads in the background. Late YouTube artist details can refine that lookup without reloading the song or resetting playback and sync. Channel names from ordinary uploads are not treated as recording artists.
- Countdown dots before a line that follows an instrumental break
- Click any line to jump to it
- Tap sync and ±0.1s nudges, remembered per song and per video or instrumental
- Warning when the lyrics and your audio look like different versions
- Singer queue with "Next singer up", which remembers each song's video and instrumental choice
- Full-screen stage for a TV or projector; controls and key hints fade after 2.5 seconds of inactivity and return on movement, touch, or keyboard activity. Controls stay visible while dragging or using them with the keyboard. Works on phones too.

## Keys

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> <kbd>→</kbd> | Seek 5s |
| <kbd>[</kbd> <kbd>]</kbd> | Nudge sync 0.1s (hold Shift for 0.5s) |
| <kbd>T</kbd> | Tap sync |
| <kbd>F</kbd> | Full screen |

## Running it

For reliable automatic search, start the local app (Python 3.10+):

```bash
./start.sh
```

The first launch creates `.venv/` and installs yt-dlp. Open [http://localhost:8765](http://localhost:8765). Use `./start.sh --port 8767` if that port is occupied. The server binds only to your computer and serves only app assets. Stop it with Ctrl+C.

To update yt-dlp after YouTube changes:

```bash
.venv/bin/python -m pip install --upgrade -r requirements.txt
```

A plain static server or any static host (GitHub Pages, Netlify, etc.) still works, but uses public mirrors for automatic search. The local helper is not included in GitHub Pages hosting; pasted YouTube links and audio files work on either version. The YouTube player requires HTTP rather than `file://`.

## GitHub Pages

1. Push this project, including `.github/workflows/pages.yml`, to a GitHub repository.
2. In the repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions → Deploy to GitHub Pages → Run workflow** and select the default branch. Future pushes to that branch deploy automatically after the syntax and timing checks pass.
4. Open the site link shown by the deployment. For a repository named `gator-karaoke`, this is normally `https://YOUR-USERNAME.github.io/gator-karaoke/`.

The workflow publishes the HTML, CSS, application scripts, and `vendor/` visualizer assets; no build tools, API keys, or extra secrets are needed. Assets use relative URLs so repository subpaths work. See [GitHub's Pages setup guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) for the repository setting.

## Checking changes

With Node.js 18+ and Google Chrome installed, run (set `CHROME_BIN` if Chrome has another executable name):

```bash
node --check app.js
node --check word-timing.js
node --check media-finder.js
node --check visualizer.js
node --check direct-audio.js
node --check fullscreen-controls.js
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

Open `tests/word-timing.html` through the same local server to run the TTML parsing regressions in your browser. These use a short timing fixture, not network requests. Word timing coverage varies by song and edition; a word-synced version with a different title, artist, or a duration more than five seconds away is not substituted automatically.
