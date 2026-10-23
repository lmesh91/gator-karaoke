# Gator Karaoke Club 🐊🎤

Live sing-along lyrics synced to whatever song you're playing. Lines light up orange word by word as you sing.

Lyrics are found through [LRCLIB](https://lrclib.net). When available for the matching recording, real word and syllable timestamps come from [BiniLyrics](https://lyrics.binimum.org/). Both are fetched in the browser without an API key or backend.

## Audio sources

- **Audio file**: drop in an MP3 / M4A / FLAC / WAV. The title and artist are read from its ID3 tags (or the file name), and the synced lyrics whose length best matches the audio are loaded automatically.
- **YouTube**: paste a link. Lyrics are found from the video title. The video can play behind the lyrics, in a corner, or hidden.
- **Other device**: playing from Spotify or a speaker? Press <kbd>Space</kbd> as you hit play there, then <kbd>T</kbd> the moment the next line starts to lock the sync.

## Features

- Word-by-word highlight (real word timings when the song has them, estimated otherwise)
- Held notes at any position follow the supplied word/syllable timestamps. Adjacent syllables keep their original spacing, so “newborn” stays one word.
- A label on stage shows whether word timing comes from BiniLyrics/LRCLIB or is estimated. Missing word timings, a different recording length, or an unavailable provider leave the LRCLIB fallback in place.
- Countdown dots before a line that follows an instrumental break
- Click any line to jump to it
- Tap sync and ±0.1s nudges, remembered per song
- Warning when the lyrics and your audio look like different versions
- Singer queue with "Next singer up"
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

The workflow publishes only `index.html`, `style.css`, `app.js`, and `word-timing.js`; no build tools, API keys, or extra secrets are needed. Assets use relative URLs so repository subpaths work. See [GitHub's Pages setup guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) for the repository setting.

## Checking changes

With Node.js 18+ and Google Chrome installed, run (set `CHROME_BIN` if Chrome has another executable name):

```bash
node --check app.js
node --check word-timing.js
node --test tests/*.test.cjs
```

Open `tests/word-timing.html` through the same local server to run the TTML parsing regressions in your browser. These use a short timing fixture, not network requests. Word timing coverage varies by song and edition; a word-synced version with a different title, artist, or a duration more than five seconds away is not substituted automatically.
