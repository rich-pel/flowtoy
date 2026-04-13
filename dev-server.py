#!/usr/bin/env python3
"""Dev server with shader hot-reload support.

Run:  python3 dev-server.py
Open: http://localhost:8000

Optional:
  --port N          Port to bind (default: 8000)
  --log /path/file  Append profiler/app logs from POST /api/log to a file

Features:
  - Serves files with no-cache headers
  - GET /api/shader-mtime  returns max mtime of all .glsl files
  - GET /api/shaders       returns folder structure of shaders/
  - POST /api/save-shader  writes a fragment shader to shaders/fragment/
  - POST /api/log          appends a JSON log entry to --log file
"""

import http.server
import json
import os
import argparse
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = None


def _append_log(entry):
    if not LOG_PATH:
        return
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    except Exception:
        pass
    with open(LOG_PATH, 'a') as f:
        f.write(entry + '\n')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path == '/api/shader-mtime':
            max_mtime = 0
            shader_dir = os.path.join(ROOT, 'shaders')
            for dirpath, _, files in os.walk(shader_dir):
                for f in files:
                    if f.endswith('.glsl'):
                        mt = os.path.getmtime(os.path.join(dirpath, f))
                        max_mtime = max(max_mtime, mt)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'mtime': max_mtime}).encode())
        elif self.path == '/api/shaders':
            sections = self._get_shader_sections()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'sections': sections}).encode())
        else:
            super().do_GET()

    def _get_shader_sections(self):
        """Walk shaders/ and group fragment shaders by their real folder path.

        Returns list of { folder, label, shaders } where:
          folder='fragment'       → files directly in shaders/fragment/
          folder='fragment/foo'   → files in shaders/fragment/foo/
          folder='core'    → files in shaders/core/

        Sections and shaders are sorted alphabetically.
        """
        shader_root = os.path.join(ROOT, 'shaders')
        if not os.path.isdir(shader_root):
            return []

        buckets = {}
        for dirpath, dirnames, filenames in os.walk(shader_root):
            dirnames.sort()
            rel_dir = os.path.relpath(dirpath, shader_root).replace('\\', '/')
            shaders = [
                name[:-len('.frag.glsl')]
                for name in sorted(filenames)
                if name.endswith('.frag.glsl')
            ]
            if shaders:
                buckets[rel_dir] = shaders

        return [
            {'folder': folder, 'label': folder, 'shaders': buckets[folder]}
            for folder in sorted(buckets)
        ]

    def do_POST(self):
        if self.path == '/api/save-shader':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            name = body.get('name', '').strip().lower()
            src = body.get('src', '')
            if not name or not all(c.isalnum() or c == '_' for c in name):
                self._json_response(400, {'error': 'Invalid shader name (alphanumeric and underscores only)'})
                return
            path = os.path.join(ROOT, 'shaders', 'fragment', name + '.frag.glsl')
            exists = os.path.exists(path)
            with open(path, 'w') as f:
                f.write(src)
            self._json_response(200, {
                'ok': True,
                'path': f'shaders/fragment/{name}.frag.glsl',
                'created': not exists,
            })
        elif self.path == '/api/log':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length) or b'{}')
            entry = {
                'ts': body.get('ts') or datetime.utcnow().isoformat() + 'Z',
                'kind': body.get('kind', 'app'),
                'level': body.get('level', 'info'),
                'message': body.get('message', ''),
                'ua': self.headers.get('User-Agent', ''),
            }
            _append_log(json.dumps(entry, ensure_ascii=True))
            self._json_response(200, {'ok': True, 'logged': bool(LOG_PATH)})
        else:
            self.send_error(404)

    def _json_response(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, fmt, *args):
        import sys
        print(f'{self.command} {self.path} → {fmt % args}', file=sys.stderr, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='DanceCam dev server')
    parser.add_argument('--port', type=int, default=8000, help='Port to bind (default: 8000)')
    parser.add_argument('--log', type=str, default='', help='Optional log file path for /api/log events')
    args = parser.parse_args()

    port = args.port
    LOG_PATH = args.log.strip() or None

    server = http.server.HTTPServer(('', port), Handler)
    print(f'Dev server running at http://localhost:{port}')
    print('Shader auto-reload active — edit any .glsl file and save')
    if LOG_PATH:
        print(f'Logging enabled: {LOG_PATH}')
        print('Profiler logs via POST /api/log')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
