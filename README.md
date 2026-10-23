# Gator Karaoke Club 🐊🎤

Live sing-along lyrics synced to whatever song you're playing. Lines light up orange word by word as you sing.

Lyrics come from [LRCLIB](https://lrclib.net), an open database with millions of time-synced songs. They're fetched live in the browser, so there's no API key, no backend, and nothing to download.

## Audio sources

- **Audio file**: drop in an MP3 / M4A / FLAC / WAV. The title and artist are read from its ID3 tags (or the file name), and the synced lyrics whose length best matches the audio are loaded automatically.
- **YouTube**: paste a link. Lyrics are found from the video title. The video can play behind the lyrics, in a corner, or hidden.
- **Other device**: playing from Spotify or a speaker? Press <kbd>Space</kbd> as you hit play there, then <kbd>T</kbd> the moment the next line starts to lock the sync.

## Features

- Word-by-word highlight (real word timings when the song has them, estimated otherwise)
- Held syllables use their tagged duration; with line-only lyrics, extra time is assigned to the final word. Line-only timing remains approximate; a blank timed line marks an instrumental break.
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

It's three static files. Serve the folder over HTTP (the YouTube player won't work from `file://`):

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. Any static host (GitHub Pages, Netlify, etc.) works too.

## GitHub Pages

1. Push this project, including `.github/workflows/pages.yml`, to a GitHub repository.
2. In the repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions → Deploy to GitHub Pages → Run workflow** and select the default branch. Future pushes to that branch deploy automatically after the lyric timing checks pass.
4. Open the site link shown by the deployment. For a repository named `gator-karaoke`, this is normally `https://YOUR-USERNAME.github.io/gator-karaoke/`.

The workflow publishes only `index.html`, `style.css`, and `app.js`; no build tools, API keys, or extra secrets are needed. Assets use relative URLs so repository subpaths work. See [GitHub's Pages setup guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) for the repository setting.

## Checking changes

With Node.js 18 or newer installed, run:

```bash
node --check app.js
node --test tests/*.test.cjs
```
