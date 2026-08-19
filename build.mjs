import fs from "node:fs";
import { execFileSync } from "node:child_process";

const hasFrontend = fs.existsSync("src/main.tsx") || fs.existsSync("src/main.jsx") || fs.existsSync("src/main.ts") || fs.existsSync("src/main.js");

if (hasFrontend) {
  console.log("Frontend source detected; building Vite application...");
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "build"], { stdio: "inherit" });
} else {
  console.log("No frontend source in this deployment; building API-only Render service.");
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync(
    "dist/index.html",
    "<!doctype html><html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>V Shiroya API</title></head><body><h1>V Shiroya API</h1><p>API service is running. Use /api/health.</p></body></html>"
  );
}

execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "esbuild",
  "server-openrouter.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--packages=external",
  "--sourcemap",
  "--outfile=dist/server.cjs"
], { stdio: "inherit" });
