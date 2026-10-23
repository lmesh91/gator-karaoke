import json
from pathlib import Path
import subprocess
import tempfile
import sys
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class SearchTests(unittest.TestCase):
    def setUp(self):
        server.CACHE.clear()

    @patch('server.subprocess.run')
    def test_search_uses_metadata_only_and_normalizes_candidates(self, run):
        run.return_value.stdout = json.dumps({'entries': [
            {'id': 'abcdefghijk', 'title': 'Example Song', 'channel': 'The Examples', 'duration': 220},
            {'id': 'lmnopqrstuv', 'title': 'Live broadcast', 'live_status': 'is_live'},
            {'id': 'bad'}, None,
        ]})
        query = 'Song; $(echo untrusted)'
        videos = server.search_youtube(query)
        self.assertEqual(videos, [{'id': 'abcdefghijk', 'title': 'Example Song', 'author': 'The Examples', 'length': 220}])
        args, kwargs = run.call_args
        self.assertEqual(args[0][-1], 'ytsearch15:' + query)
        self.assertIn('--ignore-config', args[0])
        self.assertIn('--flat-playlist', args[0])
        self.assertIn('--skip-download', args[0])
        self.assertFalse(kwargs.get('shell', False))
        self.assertEqual(server.search_youtube(query), videos)
        self.assertEqual(run.call_count, 1)

    @patch('server.subprocess.run', side_effect=subprocess.TimeoutExpired('yt-dlp', 30))
    def test_timeout_does_not_poison_the_cache_or_hold_a_search_slot(self, run):
        for _ in range(4):
            with self.assertRaises(subprocess.TimeoutExpired):
                server.search_youtube('song')
        self.assertEqual(len(server.CACHE), 0)
        self.assertEqual(run.call_count, 4)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.KaraokeHandler)
        cls.worker = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.worker.start()
        cls.base = 'http://127.0.0.1:' + str(cls.http.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.worker.join()

    def request(self, path, **headers):
        try:
            response = urlopen(Request(self.base + path, headers=headers))
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

    def test_static_app_and_vendor_assets_are_served(self):
        self.assertEqual(self.request('/')[0], 200)
        self.assertEqual(self.request('/visualizer.js')[0], 200)
        self.assertEqual(self.request('/vendor/butterchurn-2.6.7.min.js')[0], 200)

    def test_private_and_server_files_are_not_served(self):
        for path in ['/.git/config', '/.venv/pyvenv.cfg', '/server.py', '/tests/test_server.py', '/%2e%2e/server.py']:
            self.assertEqual(self.request(path)[0], 404)

    def test_rebinding_and_cross_origin_api_calls_are_rejected(self):
        self.assertEqual(self.request('/api/media/status', Host='untrusted.example')[0], 403)
        self.assertEqual(self.request('/api/media/status', Origin='https://untrusted.example')[0], 403)

    @patch('server.importlib.util.find_spec', return_value=object())
    @patch('server.search_youtube', return_value=[{'id': 'abcdefghijk', 'length': 220}])
    def test_search_and_discovery(self, search, spec):
        status, body = self.request('/api/media/status')
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)['available'])
        status, body = self.request('/api/media/search?q=Example+Song')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['videos'][0]['id'], 'abcdefghijk')
        search.assert_called_once_with('Example Song')

    def test_empty_and_excessive_queries_are_rejected(self):
        self.assertEqual(self.request('/api/media/search?q=')[0], 400)
        self.assertEqual(self.request('/api/media/search?q=' + 'a' * 301)[0], 400)

    @patch('server.importlib.util.find_spec', return_value=None)
    def test_missing_dependency_is_actionable(self, spec):
        status, body = self.request('/api/media/search?q=song')
        self.assertEqual(status, 503)
        self.assertIn('Install yt-dlp', json.loads(body)['error'])

    @patch('server.importlib.util.find_spec', return_value=object())
    @patch('server.search_youtube', side_effect=subprocess.TimeoutExpired('yt-dlp', 30))
    def test_upstream_timeout_is_reported(self, search, spec):
        self.assertEqual(self.request('/api/media/search?q=song')[0], 504)

    @patch('server.prepare_audio')
    def test_audio_preparation_returns_only_a_local_playback_url(self, prepare):
        status, body = self.request('/api/media/prepare?id=abcdefghijk')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['url'], 'api/media/audio?id=abcdefghijk')
        prepare.assert_called_once_with('abcdefghijk')
        self.assertEqual(self.request('/api/media/prepare?id=../private')[0], 400)

    def test_audio_supports_firefox_seeking_with_byte_ranges(self):
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / 'test.m4a'
            audio.write_bytes(b'0123456789')
            with patch.dict(server.AUDIO_CACHE, {'abcdefghijk': audio}):
                status, body = self.request('/api/media/audio?id=abcdefghijk', Range='bytes=2-5')
                self.assertEqual((status, body), (206, b'2345'))
                status, body = self.request('/api/media/audio?id=abcdefghijk', Range='bytes=-3')
                self.assertEqual((status, body), (206, b'789'))
                self.assertEqual(self.request('/api/media/audio?id=abcdefghijk', Range='bytes=100-')[0], 416)
                self.assertEqual(self.request('/api/media/audio?id=abcdefghijk', Range='bytes=0-1,4-5')[0], 416)
                self.assertEqual(self.request('/api/media/audio?id=abcdefghijk'), (200, b'0123456789'))
                with urlopen(Request(self.base + '/api/media/audio?id=abcdefghijk', method='HEAD')) as response:
                    self.assertEqual(response.headers['Content-Length'], '10')
                    self.assertEqual(response.read(), b'')

    def test_expired_audio_does_not_trigger_an_unbounded_download(self):
        self.assertEqual(self.request('/api/media/audio?id=nevercache1')[0], 404)


if __name__ == '__main__':
    unittest.main()
