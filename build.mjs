import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Use the local esbuild binary directly instead of spawning npx.cmd on Windows.
// This avoids Windows spawnSync EINVAL errors caused by npx.cmd invocation.
const runLocalBinary = (name, args) => {
  const bin = process.platform === "win32"
    ? `node_modules/.bin/${name}.cmd`
    : `node_modules/.bin/${name}`;

  if (!fs.existsSync(bin)) {
    throw new Error(
      `Required local binary not found: ${bin}. Run \"npm install\" before building.`
    );
  }

  execFileSync(bin, args, { stdio: "inherit", shell: false });
};

const hasFrontend =
  fs.existsSync("src/main.tsx") ||
  fs.existsSync("src/main.jsx") ||
  fs.existsSync("src/main.ts") ||
  fs.existsSync("src/main.js");

if (hasFrontend) {
  console.log("Frontend source detected; building Vite application...");
  runLocalBinary("vite", ["build"]);
} else {
  console.log("No frontend source in this deployment; building API-only Render service.");
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync(
    "dist/index.html",
    "<!doctype html><html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>V Shiroya API</title></head><body><h1>V Shiroya API</h1><p>API service is running. Use /api/health.</p></body></html>"
  );
}

runLocalBinary("esbuild", [
  "server-openrouter.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--packages=external",
  "--sourcemap",
  "--outfile=dist/server.cjs"
]);
