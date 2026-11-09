#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(process.cwd());
const port = Number.parseInt(process.env.PORT || '3000', 10);
const entry = '/test/index.html';
const url = `http://localhost:${port}${entry}`;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.geojson': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml; charset=utf-8',
    '.osm': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
};

const rootPrefix = root.endsWith(sep) ? root : root + sep;

function send(res, status, body, headers = {}) {
    res.writeHead(status, {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
    });
    res.end(body);
}

const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }

    const rawPath = (req.url || '/').split('?')[0];
    let pathname;
    try {
        pathname = decodeURIComponent(rawPath);
    } catch {
        send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }
    if (!pathname.startsWith('/')) {
        pathname = '/' + pathname;
    }
    // Collapse accidental double slashes such as //test/index.html.
    pathname = pathname.replace(/^\/+/, '/');

    if (pathname === '/') {
        res.writeHead(302, { Location: entry, 'Cache-Control': 'no-store' });
        res.end();
        return;
    }

    let filePath = normalize(join(root, pathname));
    if (filePath !== root && !filePath.startsWith(rootPrefix)) {
        send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }

    let stat;
    try {
        stat = statSync(filePath);
    } catch {
        send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }

    if (stat.isDirectory()) {
        filePath = join(filePath, 'index.html');
        try {
            stat = statSync(filePath);
        } catch {
            send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
            return;
        }
    }

    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    createReadStream(filePath).pipe(res);
});

function openBrowser(target) {
    const platform = process.platform;
    const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', target] : [target];
    try {
        const child = spawn(command, args, { stdio: 'ignore', detached: true });
        child.on('error', () => console.log(`Open ${target} in your browser.`));
        child.unref();
    } catch {
        console.log(`Open ${target} in your browser.`);
    }
}

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Try: PORT=3001 npm run valid`);
    } else {
        console.error(error);
    }
    process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Serving ${root}`);
    console.log(`Open ${url}`);
    if (!process.env.NO_OPEN) {
        openBrowser(url);
    }
});
