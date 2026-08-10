import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const requestedPort = Number.parseInt(process.env.PORT ?? "4173", 10);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(projectRoot, relativePath);
  if (filePath !== projectRoot && !filePath.startsWith(`${projectRoot}${path.sep}`)) {
    return null;
  }
  return filePath;
}

const server = createServer(async (request, response) => {
  let filePath;
  try {
    filePath = resolveRequestPath(request.url ?? "/");
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (!filePath || !["GET", "HEAD"].includes(request.method ?? "GET")) {
    response.writeHead(filePath ? 405 : 403).end();
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error("Not a file");
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": fileStat.size,
      "content-type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream"
    });
    if (request.method === "HEAD") {
      response.end();
    } else {
      createReadStream(filePath).pipe(response);
    }
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  throw new RangeError("PORT must be an integer from 0 to 65535");
}

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  console.log(`Energy Workbench: http://127.0.0.1:${port}`);
});
