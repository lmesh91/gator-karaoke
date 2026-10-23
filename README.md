# Gator Karaoke Club 🐊🎤

Live sing-along lyrics synced to whatever song you're playing. Lines light up orange word by word as you sing.

Everything runs in the browser from free services, with no API key or backend:

| What | Where it comes from |
| --- | --- |
| Word-by-word lyrics | [BiniLyrics](https://lyrics.binimum.org/) search, with timed files from [lrc.red](https://lrc.red/) |
| Line-by-line lyrics | [LRCLIB](https://lrclib.net) |
| Official music videos | [Wikidata](https://www.wikidata.org/) (the "YouTube video ID" property) |
| Other videos and instrumentals | YouTube search through public [Invidious](https://invidious.io/) instances that allow browser requests |

## How it works

1. **Find the song.** Search by title, artist, or both. Every word-by-word result is listed above every line-by-line result, even when a line-by-line one is a closer text match. The Find card also says which timing is on stage.
2. **Video & backing track.** Picking a result finds its video automatically and cues the one whose length best matches the recording the lyrics were timed against, preferring the official music video when it lines up. Other matches are listed with how much longer or shorter they are. Videos that can't be embedded are skipped automatically.
3. **Instrumental.** Flip the switch to sing over a backing track found for the same song. It drives the lyrics, while the music video keeps playing muted behind them and follows along. The switch setting carries over to the next song.

### Using your own audio

Under **Use your own audio instead**:

- **Audio file**: drop in an MP3 / M4A / FLAC / WAV. The title and artist are read from its ID3 tags (or the file name), and the synced lyrics whose length best matches the audio are loaded automatically.
- **YouTube link**: paste a link. Lyrics are found as soon as the video title is available, without waiting for playback, duration, or word timing.
- **Other device**: playing from Spotify or a speaker? Press <kbd>Space</kbd> as you hit play there, then <kbd>T</kbd> the moment the next line starts to lock the sync.

Your own audio is never replaced by an automatically found video. The video can play behind the lyrics, in a corner, or hidden.

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
- Full-screen stage for a TV or projector; works on phones too

## Keys

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> <kbd>→</kbd> | Seek 5s |
| <kbd>[</kbd> <kbd>]</kbd> | Nudge sync 0.1s (hold Shift for 0.5s) |
| <kbd>T</kbd> | Tap sync |
| <kbd>F</kbd> | Full screen |

## Running it

Serve the folder over HTTP (the YouTube player won't work from `file://`):

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. Any static host (GitHub Pages, Netlify, etc.) works too.

## GitHub Pages

1. Push this project, including `.github/workflows/pages.yml`, to a GitHub repository.
2. In the repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions → Deploy to GitHub Pages → Run workflow** and select the default branch. Future pushes to that branch deploy automatically after the syntax and timing checks pass.
4. Open the site link shown by the deployment. For a repository named `gator-karaoke`, this is normally `https://YOUR-USERNAME.github.io/gator-karaoke/`.

The workflow publishes only `index.html`, `style.css`, `app.js`, `word-timing.js`, and `media-finder.js`; no build tools, API keys, or extra secrets are needed. Assets use relative URLs so repository subpaths work. See [GitHub's Pages setup guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) for the repository setting.

## Checking changes

With Node.js 18+ and Google Chrome installed, run (set `CHROME_BIN` if Chrome has another executable name):

```bash
node --check app.js
node --check word-timing.js
node --check media-finder.js
node --test tests/*.test.cjs
```

Open `tests/word-timing.html` through the same local server to run the TTML parsing regressions in your browser. These use a short timing fixture, not network requests. Word timing coverage varies by song and edition; a word-synced version with a different title, artist, or a duration more than five seconds away is not substituted automatically.
