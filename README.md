# Gator Karaoke Club 🐊🎤

Live sing-along lyrics synced to whatever song you're playing. Lines light up orange word by word as you sing.

Lyrics come from [LRCLIB](https://lrclib.net), an open database with millions of time-synced songs. They're fetched live in the browser, so there's no API key, no backend, and nothing to download.

## Audio sources

- **Audio file**: drop in an MP3 / M4A / FLAC / WAV. The title and artist are read from its ID3 tags (or the file name), and the synced lyrics whose length best matches the audio are loaded automatically.
- **YouTube**: paste a link. Lyrics are found from the video title. The video can play behind the lyrics, in a corner, or hidden.
- **Other device**: playing from Spotify or a speaker? Press <kbd>Space</kbd> as you hit play there, then <kbd>T</kbd> the moment the next line starts to lock the sync.

## Features

- Word-by-word highlight (real word timings when the song has them, estimated otherwise)
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
