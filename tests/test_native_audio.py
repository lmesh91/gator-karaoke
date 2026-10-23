"""Exercise real Firefox decoding and Web Audio without screen capture."""
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import wave
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


@unittest.skipUnless(shutil.which('firefox'), 'Firefox is not installed')
class FirefoxAudioTests(unittest.TestCase):
    def test_native_audio_reaches_visualizer_and_supports_seeking(self):
        result = {}
        received = threading.Event()

        class FixtureHandler(server.KaraokeHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == '/wait-until-result':
                    received.wait(18)
                    self.send_response(204)
                    self.end_headers()
                elif self.path == '/native-audio-test':
                    body = Path(__file__).with_name('native-audio.html').read_bytes()
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    super().do_GET()

            def do_POST(self):
                if self.path != '/test-result':
                    self.send_error(404)
                    return
                result.update(json.loads(self.rfile.read(min(4096, int(self.headers['Content-Length'])))))
                self.send_response(200)
                self.end_headers()
                received.set()

        # Snap Firefox has a private /tmp, so put its disposable profile under
        # the workspace where both the test runner and browser can see it.
        with tempfile.TemporaryDirectory(prefix='gkc-firefox-test-', dir=server.ROOT) as folder:
            audio = Path(folder) / 'tone.wav'
            with wave.open(str(audio), 'wb') as fixture:
                fixture.setparams((1, 2, 44100, 0, 'NONE', 'not compressed'))
                fixture.writeframes(b''.join(struct.pack('<h', int(12000 * math.sin(i * 2 * math.pi * 440 / 44100)))
                                             for i in range(44100 * 3)))
            if shutil.which('ffmpeg'):
                # The helper prefers AAC/M4A, so exercise that decoder too.
                converted = Path(folder) / 'tone.m4a'
                subprocess.run(['ffmpeg', '-y', '-i', str(audio), '-c:a', 'aac', '-b:a', '128k', str(converted)],
                               capture_output=True, check=True, timeout=15)
                audio = converted
            profile = Path(folder) / 'profile'
            profile.mkdir()
            (profile / 'user.js').write_text('user_pref("media.autoplay.default", 0);\n'
                                           'user_pref("media.autoplay.block-webaudio", false);\n'
                                           'user_pref("browser.shell.checkDefaultBrowser", false);\n')
            http = server.ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
            worker = threading.Thread(target=http.serve_forever, daemon=True)
            worker.start()
            try:
                with patch.dict(server.AUDIO_CACHE, {'abcdefghijk': audio}), patch('server.prepare_audio', return_value=audio):
                    with open(Path(folder) / 'browser.log', 'w+') as log:
                        browser = subprocess.Popen(['firefox', '--headless', '--no-remote', '--profile', str(profile),
                                                    '--screenshot', str(Path(folder) / 'result.png'),
                                                    f'http://127.0.0.1:{http.server_port}/native-audio-test'], stdout=log, stderr=log)
                        try:
                            completed = received.wait(25)
                            if not completed:
                                log.seek(0)
                                self.fail('Firefox did not finish the native-audio check: ' + log.read()[-2000:])
                            self.assertTrue(result.get('ok'), result)
                            self.assertIn('Firefox/', result['userAgent'])
                        finally:
                            try:
                                browser.wait(timeout=25)
                            except subprocess.TimeoutExpired:
                                browser.terminate()
                                browser.wait(timeout=5)
            finally:
                http.shutdown()
                http.server_close()
                worker.join()
