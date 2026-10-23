#!/usr/bin/env python3
"""Local karaoke app with direct YouTube search via yt-dlp; no API key."""
import argparse
from collections import OrderedDict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import mimetypes
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parent
VIDEO_ID = re.compile(r'^[\w-]{11}$', re.ASCII)
SEARCH_SLOTS = threading.BoundedSemaphore(3)
CACHE = OrderedDict()
CACHE_LOCK = threading.Lock()
ASSETS = {'index.html', 'style.css', 'app.js', 'word-timing.js', 'media-finder.js', 'visualizer.js'}
ASSETS.add('direct-audio.js')
ASSETS.add('fullscreen-controls.js')
AUDIO_DIR = tempfile.TemporaryDirectory(prefix='gkc-audio-')
AUDIO_CACHE = OrderedDict()
AUDIO_LOCK = threading.Lock()
AUDIO_BUILDS = {}
AUDIO_SLOTS = threading.BoundedSemaphore(2)


def prepare_audio(video_id):
    if not VIDEO_ID.fullmatch(video_id):
        raise ValueError('Invalid video ID')
    with AUDIO_LOCK:
        build = AUDIO_BUILDS.setdefault(video_id, threading.Lock())
    with build:
        with AUDIO_LOCK:
            cached = AUDIO_CACHE.get(video_id)
            if cached and cached.is_file():
                AUDIO_CACHE.move_to_end(video_id)
                return cached
        if not AUDIO_SLOTS.acquire(timeout=2):
            raise RuntimeError('Song audio is still preparing. Please retry in a moment.')
        try:
            target = str(Path(AUDIO_DIR.name) / (video_id + '.%(ext)s'))
            subprocess.run([
                sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-playlist',
                '--no-warnings', '--no-progress', '--no-cache-dir', '--socket-timeout', '8',
                '--retries', '1', '--extractor-retries', '1', '--max-filesize', '40M',
                '--match-filter', 'duration <= 1800 & !is_live',
                '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]', '-o', target,
                '--', 'https://www.youtube.com/watch?v=' + video_id,
            ], capture_output=True, text=True, timeout=120, check=True)
            path = next((Path(AUDIO_DIR.name) / (video_id + ext) for ext in ('.m4a', '.webm')
                         if (Path(AUDIO_DIR.name) / (video_id + ext)).is_file()), None)
            if not path or not 0 < path.stat().st_size <= 40 * 1024 * 1024:
                raise ValueError('No playable audio was returned')
            with AUDIO_LOCK:
                AUDIO_CACHE[video_id] = path
                while len(AUDIO_CACHE) > 6:
                    _, old = AUDIO_CACHE.popitem(last=False)
                    old.unlink(missing_ok=True)
            return path
        finally:
            with AUDIO_LOCK:
                keep = AUDIO_CACHE.get(video_id)
            for leftover in Path(AUDIO_DIR.name).glob(video_id + '.*'):
                if leftover != keep:
                    leftover.unlink(missing_ok=True)
            AUDIO_SLOTS.release()


def search_youtube(query):
    with CACHE_LOCK:
        cached = CACHE.get(query)
        if cached and time.monotonic() - cached[0] < 300:
            CACHE.move_to_end(query)
            return cached[1]
    if not SEARCH_SLOTS.acquire(timeout=2):
        raise RuntimeError('Search is busy. Please try again in a moment.')
    try:
        result = subprocess.run([
            sys.executable, '-m', 'yt_dlp', '--ignore-config', '--flat-playlist',
            '--dump-single-json', '--skip-download', '--no-warnings',
            '--socket-timeout', '8', '--retries', '1', '--extractor-retries', '1',
            '--', 'ytsearch15:' + query,
        ], capture_output=True, text=True, timeout=30, check=True)
        data = json.loads(result.stdout)
        entries = data.get('entries')
        if not isinstance(entries, list):
            raise ValueError('Unexpected search response')
        videos = []
        for entry in entries:
            if not isinstance(entry, dict) or not VIDEO_ID.fullmatch(str(entry.get('id', ''))):
                continue
            if entry.get('live_status') in ('is_live', 'is_upcoming') or entry.get('is_live'):
                continue
            videos.append({'id': entry['id'], 'title': entry.get('title') or '',
                           'author': entry.get('channel') or entry.get('uploader') or '',
                           'length': entry.get('duration') or 0})
        with CACHE_LOCK:
            CACHE[query] = (time.monotonic(), videos)
            CACHE.move_to_end(query)
            while len(CACHE) > 128:
                CACHE.popitem(last=False)
        return videos
    finally:
        SEARCH_SLOTS.release()


class KaraokeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def json_response(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A different song was selected while the lookup was running.

    def audio_response(self, path, head=False):
        # Native media seeking requires byte-range responses in Firefox.
        with path.open('rb') as audio:
            size = path.stat().st_size
            start, end = 0, size - 1
            request_range = self.headers.get('Range')
            if request_range:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', request_range)
                if not match or not any(match.groups()):
                    start = size
                elif match[1]:
                    start = int(match[1])
                    end = min(int(match[2]), end) if match[2] else end
                else:
                    start = max(0, size - int(match[2]))
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.end_headers()
                    return
            self.send_response(206 if request_range else 200)
            self.send_header('Content-Type', mimetypes.guess_type(path.name)[0] or 'audio/mp4')
            self.send_header('Content-Length', str(end - start + 1))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'private, max-age=300')
            if request_range:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            if head:
                return
            audio.seek(start)
            remaining = end - start + 1
            try:
                while remaining:
                    chunk = audio.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def handle_request(self, head=False):
        # Loopback-only service. Reject DNS rebinding and cross-origin API calls.
        host = urlsplit('http://' + self.headers.get('Host', '')).hostname
        if host not in ('localhost', '127.0.0.1', '::1'):
            self.send_error(403)
            return
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + self.headers.get('Host'):
            self.send_error(403)
            return
        path = urlsplit(self.path).path
        if path == '/api/media/status':
            if head:
                self.send_error(405)
                return
            self.json_response(200, {'provider': 'yt-dlp', 'available': importlib.util.find_spec('yt_dlp') is not None, 'directAudio': True})
            return
        if path in ('/api/media/prepare', '/api/media/audio'):
            video_id = parse_qs(urlsplit(self.path).query).get('id', [''])[0]
            if not VIDEO_ID.fullmatch(video_id):
                self.json_response(400, {'error': 'Invalid video ID.'})
                return
            try:
                if path.endswith('/prepare'):
                    if head:
                        self.send_error(405)
                        return
                    prepare_audio(video_id)
                    self.json_response(200, {'url': 'api/media/audio?id=' + video_id})
                else:
                    with AUDIO_LOCK:
                        cached = AUDIO_CACHE.get(video_id)
                        if cached:
                            AUDIO_CACHE.move_to_end(video_id)
                    if not cached or not cached.is_file():
                        self.json_response(404, {'error': 'Song audio has expired. Please retry.'})
                        return
                    self.audio_response(cached, head)
            except subprocess.TimeoutExpired:
                self.json_response(504, {'error': 'Preparing song audio timed out. Please retry.'})
            except RuntimeError as error:
                self.json_response(503, {'error': str(error)})
            except (subprocess.CalledProcessError, ValueError, OSError):
                self.json_response(502, {'error': 'Could not prepare song audio. Update yt-dlp and retry, or use an audio file.'})
            return
        if path == '/api/media/search':
            if head:
                self.send_error(405)
                return
            query = parse_qs(urlsplit(self.path).query).get('q', [''])[0].strip()
            if not query or len(query) > 300:
                self.json_response(400, {'error': 'Search must contain 1–300 characters.'})
                return
            if importlib.util.find_spec('yt_dlp') is None:
                self.json_response(503, {'error': 'Install yt-dlp with the local launcher, then retry.'})
                return
            try:
                self.json_response(200, {'videos': search_youtube(query), 'provider': 'yt-dlp'})
            except subprocess.TimeoutExpired:
                self.json_response(504, {'error': 'YouTube search timed out. Please retry.'})
            except RuntimeError as error:
                self.json_response(503, {'error': str(error)})
            except (subprocess.CalledProcessError, ValueError, OSError):
                self.json_response(502, {'error': 'Direct YouTube search failed. Update yt-dlp and retry, or paste a YouTube link.'})
            return
        relative = unquote(path).lstrip('/') or 'index.html'
        candidate = (ROOT / relative).resolve()
        if not candidate.is_relative_to(ROOT) or not candidate.is_file() or not (
            relative in ASSETS or (relative.startswith('vendor/') and candidate.is_relative_to(ROOT / 'vendor'))
        ):
            self.send_error(404)
            return
        if head:
            super().do_HEAD()
        else:
            super().do_GET()

    def do_GET(self):
        self.handle_request()

    def do_HEAD(self):
        self.handle_request(head=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), KaraokeHandler)
    print(f'Gator Karaoke Club: http://localhost:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
