// Self-contained fixture webapp for extraction/validation tests.
// Provides: HTML pages with links/forms, a REST GET endpoint (read-only),
// a mutating POST endpoint (form action), one ambiguous endpoint whose shape a
// heuristic can't fully describe, a robots.txt disallowing /admin, and an
// auth-gated area under /admin that returns 401 without a session cookie.
import http from "node:http";
import { URL } from "node:url";

const PORT = process.env.FIXTURE_PORT ? Number(process.env.FIXTURE_PORT) : 4599;

const html = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Sample App</title></head><body>${body}</body></html>`;

/** A tiny in-memory data set the read-only API reads from. */
const widgets = [
  { id: 1, name: "Alpha", status: "active" },
  { id: 2, name: "Beta", status: "inactive" },
];

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    // robots.txt disallows /admin
    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nDisallow: /admin\n");
      return;
    }

    // Home page links to other pages and shows a mutating form.
    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        html(
          `<h1>Sample App</h1>
           <a href="/widgets">Widgets</a>
           <a href="/reports">Reports</a>
           <a href="/account">Account</a>
           <a href="/admin">Admin</a>
           <form action="/api/widgets" method="post">
             <input name="name"><button type="submit">Create widget</button>
           </form>`,
        ),
      );
      return;
    }

    if (path === "/widgets") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html(`<h1>Widgets</h1><a href="/api/widgets">data</a>`));
      return;
    }

    if (path === "/reports") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html(`<h1>Reports</h1><a href="/api/report">ambiguous</a>`));
      return;
    }

    // Read-only REST endpoint.
    if (path === "/api/widgets" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ widgets }));
      return;
    }

    // Mutating REST endpoint (also the form action target).
    if (path === "/api/widgets" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const id = widgets.length + 1;
        widgets.push({ id, name: `w${id}`, status: "active" });
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ created: id }));
      });
      return;
    }

    // Ambiguous endpoint: returns opaque data with no stable schema.
    if (path === "/api/report") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ blob: Math.random().toString(36), ts: Date.now() }));
      return;
    }

    // Auth-gated area that is NOT robots-disallowed: 401 without a session cookie (FR-011).
    if (path.startsWith("/account")) {
      const cookie = req.headers.cookie || "";
      if (!cookie.includes("session=")) {
        res.writeHead(401, { "content-type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html(`<h1>Account</h1><a href="/api/profile">profile</a>`));
      return;
    }

    // Auth-gated area (also robots-disallowed): 401 without a session cookie.
    if (path.startsWith("/admin")) {
      const cookie = req.headers.cookie || "";
      if (!cookie.includes("session=")) {
        res.writeHead(401, { "content-type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html(`<h1>Admin</h1>`));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });
}

// Allow running standalone: `node server.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`fixture sample-app listening on http://localhost:${PORT}`);
  });
}
