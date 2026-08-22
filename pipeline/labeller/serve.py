"""Serve the viewer with caching off.

The browser held a stale index.html twice in this session - once long enough to
send me looking for a bug in code the page had never loaded. The files here
change every time the labels are re-exported, so no-store is the only sane
policy for a scratch viewer.
"""
import functools, http.server, socketserver, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

directory, port = sys.argv[1], int(sys.argv[2])
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", port),
                            functools.partial(Handler, directory=directory)) as httpd:
    print(f"serving {directory} on 127.0.0.1:{port} with no-store", flush=True)
    httpd.serve_forever()
