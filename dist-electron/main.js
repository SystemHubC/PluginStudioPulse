import { app, BrowserWindow, ipcMain, shell, dialog, Menu } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
const rendererUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL || "";
const isDev = !!rendererUrl;
let win = null;
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-http-cache");
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();
const STUDIO_ROOT = path.join(app.getPath("userData"), "projects");
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const SESSION_ID = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
const SDK_WHEEL_NAME = "funpay_pulse_sdk-0.1.0-py3-none-any.whl";
const SDK_CACHE_DIR = path.join(app.getPath("userData"), "sdk-cache");
const PULSE_API_BASE = "https://funpaypulse.com";
const AUTH_COOKIE_SETTING_KEY = "authCookies";
const DEFAULT_UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/SystemHubC/PluginStudioPulse/main/updates/latest.json";
const UPDATE_CACHE_DIR = path.join(app.getPath("userData"), "updates");
async function loadSettings() {
  return await readJson(SETTINGS_FILE, { theme: "pulse", python: pythonCmd() });
}
async function saveSettingsPatch(patch) {
  const current = await loadSettings();
  await writeJson(SETTINGS_FILE, { ...current, ...patch });
}
function splitSetCookieHeader(value) {
  return value.split(/,(?=\s*[^;,\s]+=)/g).map((x) => x.trim()).filter(Boolean);
}
function getSetCookieHeaders(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const raw = typeof headers.get === "function" ? headers.get("set-cookie") : "";
  return raw ? splitSetCookieHeader(raw) : [];
}
function mergeCookieJar(existing, setCookies) {
  const jar = /* @__PURE__ */ new Map();
  for (const part of String(existing || "").split(";")) {
    const item = part.trim();
    if (!item || !item.includes("=")) continue;
    const idx = item.indexOf("=");
    jar.set(item.slice(0, idx), item.slice(idx + 1));
  }
  for (const cookie of setCookies) {
    const first = cookie.split(";")[0]?.trim();
    if (!first || !first.includes("=")) continue;
    const idx = first.indexOf("=");
    const name = first.slice(0, idx);
    const value = first.slice(idx + 1);
    if (!value) jar.delete(name);
    else jar.set(name, value);
  }
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}
async function rememberAuthCookieFromResponse(response) {
  const setCookies = getSetCookieHeaders(response.headers);
  if (!setCookies.length) return;
  const settings = await loadSettings();
  const current = String(settings[AUTH_COOKIE_SETTING_KEY] || "");
  const next = mergeCookieJar(current, setCookies);
  await saveSettingsPatch({ [AUTH_COOKIE_SETTING_KEY]: next });
}
async function clearAuthSession() {
  const settings = await loadSettings();
  const next = { ...settings };
  delete next[AUTH_COOKIE_SETTING_KEY];
  delete next.authProfileCache;
  await writeJson(SETTINGS_FILE, next);
}
function normalizeVersion(value) {
  return String(value || "0.0.0").trim().replace(/^v/i, "").split(/[.+-]/).map((x) => Number.parseInt(x, 10)).filter((n) => Number.isFinite(n));
}
function compareVersions(a, b) {
  const av = normalizeVersion(a);
  const bv = normalizeVersion(b);
  const len = Math.max(av.length, bv.length, 3);
  for (let i = 0; i < len; i++) {
    const x = av[i] || 0;
    const y = bv[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
function safeUpdateUrl(url) {
  const clean = String(url || "").trim();
  if (!/^https:\/\//i.test(clean)) throw new Error("Updater принимает только HTTPS-ссылки.");
  return clean;
}
function updateManifestUrlFromSettings(settings) {
  return String(settings.updateManifestUrl || DEFAULT_UPDATE_MANIFEST_URL).trim() || DEFAULT_UPDATE_MANIFEST_URL;
}
function updaterEmit(payload) {
  win?.webContents.send("updater:event", payload);
}
async function fetchUpdateManifest(manifestUrl) {
  const url = safeUpdateUrl(manifestUrl);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": `PulsePluginStudio/${app.getVersion()}`,
      Origin: PULSE_API_BASE,
      Referer: `${PULSE_API_BASE}/`
    }
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!response.ok || !json) {
    return { success: false, status: response.status, error: json?.error || json?.detail || text || "Не удалось прочитать update manifest." };
  }
  const version = String(json.version || json.tag_name || "").replace(/^v/i, "");
  const installerUrl = json.url || json.installer_url || json.download_url || json.assets?.windows?.url;
  if (!version || !installerUrl) {
    return { success: false, error: "В update manifest должны быть поля version и url/installer_url.", manifest: json };
  }
  const currentVersion = app.getVersion();
  const available = compareVersions(version, currentVersion) > 0;
  return {
    success: true,
    currentVersion,
    latestVersion: version,
    available,
    manifestUrl: url,
    manifest: {
      version,
      url: String(installerUrl),
      sha256: json.sha256 || json.assets?.windows?.sha256 || null,
      size: json.size || json.assets?.windows?.size || null,
      notes: json.notes || json.body || json.changelog || "",
      mandatory: !!json.mandatory,
      published_at: json.published_at || json.date || null,
      installer_name: json.installer_name || null
    }
  };
}
function filenameFromUpdate(manifest) {
  const explicit = String(manifest.installer_name || "").trim();
  if (explicit && explicit.toLowerCase().endsWith(".exe")) return explicit.replace(/[^\w .()+\-а-яА-ЯёЁ]/g, "_");
  try {
    const u = new URL(String(manifest.url || ""));
    const name = path.basename(decodeURIComponent(u.pathname));
    if (name.toLowerCase().endsWith(".exe")) return name.replace(/[^\w .()+\-а-яА-ЯёЁ]/g, "_");
  } catch {
  }
  return `Pulse Plugin Studio Setup ${manifest.version || "latest"}.exe`;
}
async function downloadInnoUpdate(manifest) {
  const url = safeUpdateUrl(manifest?.url);
  await ensureDir(UPDATE_CACHE_DIR);
  const filename = filenameFromUpdate(manifest);
  const dest = path.join(UPDATE_CACHE_DIR, filename);
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": `PulsePluginStudio/${app.getVersion()}`
    }
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    return { success: false, status: response.status, error: text || "Не удалось скачать установщик обновления." };
  }
  const total = Number(response.headers.get("content-length") || manifest.size || 0);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  const hash = crypto.createHash("sha256");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    hash.update(chunk);
    received += chunk.length;
    updaterEmit({ type: "download-progress", received, total, percent: total ? Math.round(received / total * 100) : null });
  }
  const sha256 = hash.digest("hex");
  const expected = String(manifest.sha256 || "").trim().toLowerCase();
  if (expected && expected !== sha256.toLowerCase()) {
    return { success: false, error: "SHA-256 установщика не совпал. Скачивание остановлено ради безопасности.", expected, actual: sha256 };
  }
  await fs.writeFile(dest, Buffer.concat(chunks), { mode: 384 });
  const result = { success: true, path: dest, filename, sha256, size: received, version: manifest.version, verified: !!expected };
  await saveSettingsPatch({ downloadedUpdate: result });
  updaterEmit({ type: "downloaded", result });
  return result;
}
async function installDownloadedInnoUpdate(installerPath) {
  const settings = await loadSettings();
  const file = String(installerPath || settings.downloadedUpdate?.path || "").trim();
  if (!file || !await exists(file)) return { success: false, error: "Скачанный установщик не найден." };
  if (process.platform !== "win32") {
    await shell.openPath(file);
    return { success: true, opened: true, path: file, hint: "На этой ОС Studio открыла файл установщика вместо автозапуска." };
  }
  const child = spawn(file, ["/SP-", "/NORESTART"], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
  setTimeout(() => app.quit(), 800);
  return { success: true, started: true, path: file };
}
async function pulseApi(pathname, options = {}) {
  const settings = await loadSettings();
  const headers = {
    Accept: "application/json",
    "User-Agent": "PulsePluginStudio/1.20",
    Origin: PULSE_API_BASE,
    Referer: `${PULSE_API_BASE}/`
  };
  const cookie = String(settings[AUTH_COOKIE_SETTING_KEY] || "");
  if (options.auth !== false && cookie) headers.Cookie = cookie;
  let body;
  if (options.body !== void 0) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${PULSE_API_BASE}${pathname}`, {
    method: options.method || "GET",
    headers,
    body,
    redirect: "manual"
  });
  await rememberAuthCookieFromResponse(response);
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { ok: response.ok, status: response.status, json, text };
}
function publicProfileShape(profile) {
  if (!profile || typeof profile !== "object") return null;
  return {
    telegram_id_masked: profile.telegram_id_masked || null,
    username: profile.username || null,
    photo_url: profile.photo_url || null,
    created_at: profile.created_at || null,
    subscription: profile.subscription || null,
    tier: profile.tier || "standard",
    max_accounts: profile.max_accounts ?? null,
    beta_access: !!profile.beta_access,
    has_referrer: !!profile.has_referrer
  };
}
async function fetchAndStoreProfile() {
  const response = await pulseApi("/api/v2/profile/me", { method: "GET" });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      const settings = await loadSettings();
      const next = { ...settings };
      delete next.authProfileCache;
      await writeJson(SETTINGS_FILE, next);
      return { success: true, authenticated: false, status: response.status, profile: null };
    }
    return { success: false, authenticated: false, status: response.status, error: response.json?.detail || response.json?.error || response.text || "Не удалось получить профиль." };
  }
  const profile = publicProfileShape(response.json);
  await saveSettingsPatch({ authProfileCache: profile });
  return { success: true, authenticated: !!profile, profile };
}
async function fetchAuthorProfile() {
  const response = await pulseApi("/api/v2/plugin-marketplace/publisher/author-profile", { method: "GET" });
  if (!response.ok) {
    return {
      success: false,
      status: response.status,
      error: response.json?.detail || response.json?.error || response.text || "Не удалось получить профиль разработчика.",
      response: response.json
    };
  }
  const authorProfile = response.json?.profile ?? response.json ?? null;
  if (authorProfile?.slug) {
    await saveSettingsPatch({ authorProfileSlug: authorProfile.slug, authorProfileCache: authorProfile });
  }
  return { success: true, profile: authorProfile, raw: response.json };
}
function cleanNullableUrl(value) {
  const s = String(value ?? "").trim();
  return s ? s : null;
}
function cleanAuthorProfilePayload(payload) {
  return {
    slug: String(payload?.slug || "").trim(),
    display_name: String(payload?.display_name || "").trim(),
    avatar_url: cleanNullableUrl(payload?.avatar_url),
    website_url: cleanNullableUrl(payload?.website_url),
    telegram_url: cleanNullableUrl(payload?.telegram_url),
    bio: String(payload?.bio || "").trim(),
    publish: !!payload?.publish
  };
}
async function readMarketplaceStats() {
  const read = async (name, pathname) => {
    const response = await pulseApi(pathname, { method: "GET" });
    if (!response.ok) {
      return {
        ok: false,
        name,
        status: response.status,
        error: response.json?.detail || response.json?.error || response.text || `Не удалось получить ${name}.`,
        response: response.json
      };
    }
    return { ok: true, name, data: response.json };
  };
  const [installations, developerTokens, ledger, products] = await Promise.all([
    read("installations", "/api/v2/plugin-marketplace/installations"),
    read("developerTokens", "/api/v2/plugin-marketplace/publisher/developer-tokens"),
    read("ledger", "/api/v2/plugin-marketplace/publisher/ledger?limit=50&offset=0"),
    read("products", "/api/v2/plugin-marketplace/products/private")
  ]);
  const errors = [installations, developerTokens, ledger, products].filter((x) => !x.ok);
  return {
    success: errors.length === 0,
    partial: errors.length > 0,
    fetched_at: (/* @__PURE__ */ new Date()).toISOString(),
    installations: installations.ok ? installations.data : null,
    developerTokens: developerTokens.ok ? developerTokens.data : null,
    ledger: ledger.ok ? ledger.data : null,
    products: products.ok ? products.data : null,
    errors
  };
}
async function scanProjectSecurity(projectId) {
  const { actualRoot } = await getProject(projectId);
  const warnings = [];
  const riskyNames = [/\.env$/i, /secret/i, /token/i, /cookie/i, /credential/i, /private[_-]?key/i];
  const tokenPatterns = [
    { level: "critical", label: "Pulse Broker token", regex: /fppb_[A-Za-z0-9_\-]{12,}/g },
    { level: "critical", label: "Pulse developer token", regex: /fppd_[A-Za-z0-9_\-]{12,}/g },
    { level: "critical", label: "Pulse invite/install token", regex: /fppi_[A-Za-z0-9_\-]{12,}/g },
    { level: "critical", label: "Private key block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    { level: "warning", label: "Bearer token", regex: /Bearer\s+[A-Za-z0-9._\-]{20,}/g },
    { level: "warning", label: "OpenAI-like key", regex: /sk-[A-Za-z0-9_\-]{20,}/g },
    { level: "warning", label: "GitHub-like token", regex: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
    { level: "warning", label: "Possible password assignment", regex: /(password|passwd|secret|api[_-]?key|golden[_-]?key)\s*[:=]\s*['\"][^'\"]{8,}['\"]/ig },
    { level: "info", label: "localhost runtime/reference", regex: /localhost|127\.0\.0\.1|example\.com|example\.org|example\.net/g }
  ];
  const skipDirs = /* @__PURE__ */ new Set([".venv", "node_modules", "__pycache__", ".git", "dist", ".plugin-studio"]);
  const textExt = /* @__PURE__ */ new Set([".py", ".json", ".md", ".txt", ".yml", ".yaml", ".toml", ".ini", ".env", ".js", ".ts", ".tsx", ".jsx", ".html", ".css"]);
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(actualRoot, full).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (riskyNames.some((r) => r.test(entry.name))) {
        warnings.push({ level: "warning", file: rel, title: "Подозрительное имя файла", detail: "Перед pack/upload проверь, что тут нет токенов, cookies, паролей или приватных ключей." });
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!textExt.has(ext)) continue;
      const stat = await fs.stat(full);
      if (stat.size > 1024 * 1024) continue;
      const content = await fs.readFile(full, "utf8").catch(() => "");
      for (const pat of tokenPatterns) {
        const matches = content.match(pat.regex);
        if (!matches?.length) continue;
        warnings.push({ level: pat.level, file: rel, title: pat.label, detail: `Найдено совпадений: ${matches.length}. Значения скрыты ради безопасности.` });
      }
    }
  }
  await visit(actualRoot);
  const critical = warnings.filter((w) => w.level === "critical").length;
  const warning = warnings.filter((w) => w.level === "warning").length;
  return {
    success: critical === 0,
    root: actualRoot,
    counts: { critical, warning, info: warnings.filter((w) => w.level === "info").length, total: warnings.length },
    warnings: warnings.slice(0, 80),
    hint: critical ? "Критические секреты нужно удалить до pack/upload." : warning ? "Есть предупреждения. Проверь их перед публикацией." : "Критических проблем безопасности не найдено."
  };
}
const REVIEW_EXCLUDED_DIRS = /* @__PURE__ */ new Set([
  ".venv",
  "node_modules",
  "__pycache__",
  ".git",
  ".idea",
  ".vscode",
  "dist",
  "build",
  "out",
  "coverage",
  ".plugin-studio",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".cache"
]);
const REVIEW_EXCLUDED_FILES = [
  /^\.env(\..*)?$/i,
  /^desktop\.ini$/i,
  /^Thumbs\.db$/i,
  /^\.DS_Store$/i,
  /\.log$/i,
  /\.tmp$/i,
  /\.bak$/i,
  /\.old$/i,
  /\.zip$/i,
  /\.7z$/i,
  /\.rar$/i,
  /\.fppkg$/i,
  /plugin[-_ ]?studio/i
];
function shouldExcludeFromReviewPackage(name) {
  if (REVIEW_EXCLUDED_DIRS.has(name)) return true;
  return REVIEW_EXCLUDED_FILES.some((r) => r.test(name));
}
async function packageGuard(projectId) {
  const { actualRoot } = await getProject(projectId);
  const excluded = [];
  const included = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(actualRoot, full).replaceAll("\\", "/");
      if (shouldExcludeFromReviewPackage(entry.name)) {
        excluded.push({
          path: rel,
          type: entry.isDirectory() ? "directory" : "file",
          reason: entry.isDirectory() ? "служебная/build/cache папка не должна попадать в review-пакет" : "служебный архив/лог/секретный или временный файл не должен попадать в review-пакет"
        });
        continue;
      }
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        included.push(rel);
      }
    }
  }
  await visit(actualRoot);
  const required = ["funpay-pulse.plugin.json", "app.py"];
  const missing = [];
  for (const f of required) if (!included.includes(f)) missing.push(f);
  return {
    success: missing.length === 0,
    root: actualRoot,
    clean: true,
    included_count: included.length,
    excluded_count: excluded.length,
    missing,
    excluded: excluded.slice(0, 120),
    hint: missing.length ? `Не хватает обязательных файлов: ${missing.join(", ")}` : excluded.length ? "Studio опубликует через временную clean-staging папку: лишние файлы будут исключены из review-пакета." : "Лишних файлов для review-пакета не найдено."
  };
}
async function copyCleanProjectForReview(srcRoot, destRoot) {
  await ensureDir(destRoot);
  async function copy(currentSrc, currentDest) {
    await ensureDir(currentDest);
    for (const entry of await fs.readdir(currentSrc, { withFileTypes: true })) {
      if (shouldExcludeFromReviewPackage(entry.name)) continue;
      const from = path.join(currentSrc, entry.name);
      const to = path.join(currentDest, entry.name);
      if (entry.isDirectory()) await copy(from, to);
      else if (entry.isFile()) await fs.copyFile(from, to);
    }
  }
  await copy(srcRoot, destRoot);
}
async function runPulseUsingVenv(venvProjectRoot, cwd, args, env = {}, timeoutMs = 12e4) {
  const inv = await pulseInvocation(venvProjectRoot);
  const r = await spawnCollect(inv.cmd, [...inv.argsPrefix, ...args], cwd, env, timeoutMs);
  return { ...r, runner: inv.display, cwd };
}
const COMMON_IMPORT_PACKAGES = {
  requests: "requests",
  aiohttp: "aiohttp",
  httpx: "httpx",
  bs4: "beautifulsoup4",
  yaml: "PyYAML",
  pydantic: "pydantic",
  dotenv: "python-dotenv",
  PIL: "Pillow",
  lxml: "lxml"
};
async function scanPythonImports(projectRoot) {
  const found = /* @__PURE__ */ new Set();
  const skipDirs = /* @__PURE__ */ new Set([".venv", "__pycache__", ".git", ".plugin-studio", "dist", "build", "node_modules"]);
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) await visit(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".py")) continue;
      const full = path.join(dir, entry.name);
      const stat = await fs.stat(full);
      if (stat.size > 1024 * 1024) continue;
      const source = await fs.readFile(full, "utf8").catch(() => "");
      for (const match of source.matchAll(/^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
        const mod = match[1];
        if (COMMON_IMPORT_PACKAGES[mod]) found.add(mod);
      }
    }
  }
  await visit(projectRoot);
  return Array.from(found);
}
async function moduleAvailable(py, moduleName, cwd, env) {
  const r = await spawnCollect(py, ["-c", `import ${moduleName}`], cwd, env, 3e4);
  return r.success;
}
async function ensureProjectRuntimeDependencies(projectId, actualRoot, sslEnv = {}) {
  const { py } = venvPaths(actualRoot);
  if (!await exists(py)) {
    return { success: false, step: "runtime-deps", hint: "Для установки зависимостей нужен .venv. Нажми “Установить SDK” и повтори команду." };
  }
  const steps = [];
  const requirements = path.join(actualRoot, "requirements.txt");
  if (await exists(requirements)) {
    const reqInstall = await spawnCollect(py, ["-m", "pip", "install", "-r", requirements], actualRoot, sslEnv, 24e4);
    steps.push({ step: "requirements.txt", success: reqInstall.success, command: reqInstall.command, stdout: reqInstall.stdout, stderr: reqInstall.stderr, code: reqInstall.code });
    if (!reqInstall.success) {
      return {
        success: false,
        step: "install-requirements",
        steps,
        hint: (reqInstall.stderr || "").includes("CERTIFICATE_VERIFY_FAILED") ? "pip не смог скачать зависимости из-за SSL. Нажми “Исправить SSL / certifi” и повтори test/doctor." : "Не удалось установить зависимости из requirements.txt. Проверь stderr выше."
      };
    }
  }
  const imports = await scanPythonImports(actualRoot);
  const missingPackages = [];
  for (const mod of imports) {
    if (!await moduleAvailable(py, mod, actualRoot, sslEnv)) {
      missingPackages.push(COMMON_IMPORT_PACKAGES[mod]);
    }
  }
  const uniquePackages = Array.from(new Set(missingPackages));
  if (uniquePackages.length) {
    const autoInstall = await spawnCollect(py, ["-m", "pip", "install", ...uniquePackages], actualRoot, sslEnv, 24e4);
    steps.push({ step: "auto-install-common-imports", packages: uniquePackages, success: autoInstall.success, command: autoInstall.command, stdout: autoInstall.stdout, stderr: autoInstall.stderr, code: autoInstall.code });
    if (!autoInstall.success) {
      return {
        success: false,
        step: "auto-install-common-imports",
        packages: uniquePackages,
        steps,
        hint: `Не удалось поставить зависимости: ${uniquePackages.join(", ")}. Добавь их в requirements.txt или проверь интернет/pip.`
      };
    }
  }
  return {
    success: true,
    step: "runtime-deps",
    installedFromRequirements: await exists(requirements),
    autoInstalled: uniquePackages,
    steps,
    hint: uniquePackages.length || steps.length ? "Зависимости проекта установлены в .venv." : "Дополнительные зависимости не найдены."
  };
}
function shouldRunInCleanStaging(preset) {
  return ["validate", "check", "test", "doctor", "pack", "dry-run", "run-fixtures"].includes(preset);
}
function shouldEnsureRuntimeDeps(preset) {
  return ["test", "doctor", "run-fixtures"].includes(preset);
}
function isInside(base, target) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === "" || !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}
async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
async function readJson(p, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJson(p, value) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(value, null, 2), "utf8");
}
async function appendSessionEvent(projectId, event) {
  try {
    const { actualRoot } = await getProject(projectId);
    const dir = path.join(actualRoot, ".plugin-studio", "sessions");
    await ensureDir(dir);
    const file = path.join(dir, `${SESSION_ID}.jsonl`);
    const row = {
      time: (/* @__PURE__ */ new Date()).toISOString(),
      session_id: SESSION_ID,
      ...event
    };
    await fs.appendFile(file, JSON.stringify(row) + "\n", "utf8");
  } catch {
  }
}
async function listSessionReports(projectId) {
  const { actualRoot } = await getProject(projectId);
  const dir = path.join(actualRoot, ".plugin-studio", "sessions");
  if (!await exists(dir)) return [];
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort().reverse();
  const rows = [];
  for (const f of files) {
    const full = path.join(dir, f);
    const stat = await fs.stat(full);
    rows.push({ name: f, path: full, size: stat.size, modified: stat.mtime.toISOString() });
  }
  return rows;
}
async function copyDir(src, dest) {
  await ensureDir(dest);
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".venv" || entry.name === "__pycache__") continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else if (entry.isFile()) await fs.copyFile(s, d);
  }
}
async function walk(root, dir = root) {
  const items = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
    if (entry.name === ".venv" || entry.name === "__pycache__" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      items.push({ name: entry.name, path: rel, type: "directory", children: await walk(root, full) });
    } else {
      items.push({ name: entry.name, path: rel, type: "file" });
    }
  }
  return items;
}
function resourcePath(...parts) {
  if (app.isPackaged) return path.join(process.resourcesPath, ...parts);
  return path.join(app.getAppPath(), ...parts);
}
function pythonCmd() {
  return process.platform === "win32" ? "python" : "python3";
}
function pythonLaunchers() {
  return process.platform === "win32" ? [{ cmd: "python", args: [] }, { cmd: "py", args: ["-3"] }, { cmd: "python3", args: [] }] : [{ cmd: "python3", args: [] }, { cmd: "python", args: [] }];
}
async function createVenv(cwd) {
  let last = null;
  for (const launcher of pythonLaunchers()) {
    const r = await spawnCollect(launcher.cmd, [...launcher.args, "-m", "venv", ".venv"], cwd, {}, 12e4);
    if (r.success) return { ...r, launcher: [launcher.cmd, ...launcher.args].join(" ") };
    last = { ...r, launcher: [launcher.cmd, ...launcher.args].join(" ") };
  }
  return last || { success: false, error: "Python launcher not found" };
}
function sanitizePluginId(value) {
  let id = String(value || "plugin").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(id)) id = `plugin_${id}`;
  if (id.length < 3) id = `${id}_plugin`;
  return id.slice(0, 64);
}
async function repairLegacyManifest(projectRoot) {
  const manifestPath = path.join(projectRoot, "funpay-pulse.plugin.json");
  const manifest = await readJson(manifestPath, null);
  if (!manifest || typeof manifest !== "object") return null;
  let changed = false;
  if (!manifest.manifest_version) {
    manifest.manifest_version = "1.0";
    changed = true;
  }
  if (!manifest.plugin_id) {
    manifest.plugin_id = sanitizePluginId(manifest.id || path.basename(projectRoot));
    changed = true;
  }
  if (!manifest.id || manifest.id !== manifest.plugin_id) {
    manifest.id = manifest.plugin_id;
    changed = true;
  }
  if (!manifest.name) {
    manifest.name = manifest.plugin_id;
    changed = true;
  }
  if (!manifest.version) {
    manifest.version = "0.1.0";
    changed = true;
  }
  if (!manifest.runtime || typeof manifest.runtime !== "object") {
    manifest.runtime = { type: "broker-poller", url: "http://localhost:8787/funpay-pulse/broker-poller" };
    changed = true;
  } else {
    if (!manifest.runtime.type) {
      manifest.runtime.type = "broker-poller";
      changed = true;
    }
    if (!manifest.runtime.url) {
      manifest.runtime.url = "http://localhost:8787/funpay-pulse/broker-poller";
      changed = true;
    }
  }
  if (!Array.isArray(manifest.events)) {
    manifest.events = [];
    changed = true;
  }
  if (!Array.isArray(manifest.scopes)) {
    manifest.scopes = [];
    changed = true;
  }
  if (manifest.config_schema && typeof manifest.config_schema !== "object") {
    manifest.config_schema = {};
    changed = true;
  }
  if (manifest.ui_schema && typeof manifest.ui_schema !== "object") {
    manifest.ui_schema = {};
    changed = true;
  }
  if (changed) await writeJson(manifestPath, manifest);
  return manifest;
}
async function ensureDefaultFixtures(projectRoot) {
  const fixturesPath = path.join(projectRoot, "fixtures", "events.json");
  const existing = await readJson(fixturesPath, null);
  if (existing && Array.isArray(existing.items)) return;
  await ensureDir(path.dirname(fixturesPath));
  await writeJson(fixturesPath, {
    items: [
      {
        delivery_id: "del_studio_message_1",
        event_id: "evt_studio_message_1",
        event_type: "events:new_message",
        payload: {
          schema_version: "broker.events.v1",
          event_type: "events:new_message",
          occurred_at: "2026-05-02T10:00:00Z",
          account_id: "42",
          account_username: "seller",
          chat_id: "100",
          message_id: "200",
          buyer_id: "300",
          buyer_username: "buyer",
          author_id: "300",
          author_username: "buyer",
          text: "Здравствуйте, товар есть?",
          is_own: false,
          is_system: false,
          sender_type: "buyer"
        },
        created_at: "fixture:now",
        delivered_at: null
      }
    ],
    count: 1
  });
}
async function extractZipNode(zipPath, dest) {
  const buf = await fs.readFile(zipPath);
  const maxComment = Math.min(buf.length, 65535 + 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxComment; i--) {
    if (i >= 0 && buf.readUInt32LE(i) === 101010256) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP: end of central directory not found");
  const total = buf.readUInt16LE(eocd + 10);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  let ptr = centralOffset;
  await ensureDir(dest);
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(ptr) !== 33639248) throw new Error("ZIP: central directory is corrupted");
    const flags = buf.readUInt16LE(ptr + 8);
    const compression = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const rawName = buf.subarray(ptr + 46, ptr + 46 + nameLen);
    const name = rawName.toString(flags & 2048 ? "utf8" : "utf8").replace(/\\/g, "/");
    ptr += 46 + nameLen + extraLen + commentLen;
    if (!name || name.startsWith("__MACOSX/") || name.endsWith("/")) continue;
    if (compressedSize === 4294967295 || localOffset === 4294967295) throw new Error("ZIP64 archives are not supported yet");
    const normalized = path.normalize(name).replace(/^([/\\])+/, "");
    if (!normalized || normalized.startsWith("..") || path.isAbsolute(normalized)) continue;
    const out = path.join(dest, normalized);
    if (!isInside(dest, out)) continue;
    if (buf.readUInt32LE(localOffset) !== 67324752) throw new Error("ZIP: local file header is corrupted");
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    const data = compression === 0 ? compressed : compression === 8 ? zlib.inflateRawSync(compressed) : (() => {
      throw new Error(`ZIP: unsupported compression method ${compression} for ${name}`);
    })();
    await ensureDir(path.dirname(out));
    await fs.writeFile(out, data);
  }
}
async function extractArchive(src, dest) {
  const errors = [];
  try {
    await extractZipNode(src, dest);
    return;
  } catch (e) {
    errors.push(`Node unzip: ${e?.message || String(e)}`);
  }
  const pyScript = `import zipfile, sys
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`;
  const py = await spawnCollect(pythonCmd(), ["-c", pyScript, src, dest], STUDIO_ROOT, {}, 12e4);
  if (py.success) return;
  errors.push(`Python unzip: ${py.stderr || py.error || "failed"}`);
  if (process.platform === "win32") {
    const ps = await spawnCollect("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force", src, dest], STUDIO_ROOT, {}, 12e4);
    if (ps.success) return;
    errors.push(`PowerShell Expand-Archive: ${ps.stderr || ps.error || "failed"}`);
  }
  throw new Error(`Не удалось распаковать архив. ${errors.join(" | ")}`);
}
function venvPaths(projectRoot) {
  const win2 = process.platform === "win32";
  return {
    py: path.join(projectRoot, ".venv", win2 ? "Scripts/python.exe" : "bin/python"),
    pulse: path.join(projectRoot, ".venv", win2 ? "Scripts/pulse-plugin.exe" : "bin/pulse-plugin")
  };
}
function isAsarVirtualPath(p) {
  return p.includes(`${path.sep}app.asar${path.sep}`) || p.endsWith(`${path.sep}app.asar`);
}
async function fileSize(p) {
  try {
    return (await fs.stat(p)).size;
  } catch {
    return 0;
  }
}
async function copyAsarWheelToRealFile(source) {
  await ensureDir(SDK_CACHE_DIR);
  const cached = path.join(SDK_CACHE_DIR, SDK_WHEEL_NAME);
  const srcSize = await fileSize(source);
  const dstSize = await fileSize(cached);
  if (srcSize > 0 && dstSize === srcSize) return cached;
  await fs.copyFile(source, cached);
  const copiedSize = await fileSize(cached);
  if (!copiedSize) throw new Error("SDK wheel был найден внутри app.asar, но не смог скопироваться в реальную папку userData/sdk-cache.");
  return cached;
}
async function resolveInstallableSdkWheel() {
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath || "";
  const candidates = [
    { label: "packaged extraResources: resources/sdk", path: path.join(resourcesPath, "resources", "sdk", SDK_WHEEL_NAME) },
    { label: "packaged extraResources: sdk", path: path.join(resourcesPath, "sdk", SDK_WHEEL_NAME) },
    { label: "asarUnpack: resources/sdk", path: path.join(resourcesPath, "app.asar.unpacked", "resources", "sdk", SDK_WHEEL_NAME) },
    { label: "dev/source: resources/sdk", path: path.join(appPath, "resources", "sdk", SDK_WHEEL_NAME) },
    { label: "dev/source: cwd resources/sdk", path: path.join(process.cwd(), "resources", "sdk", SDK_WHEEL_NAME) },
    { label: "dist sibling: resources/sdk", path: path.join(__dirname$1, "..", "resources", "sdk", SDK_WHEEL_NAME) }
  ];
  const tried = [];
  for (const candidate of candidates) {
    tried.push(candidate.path);
    if (!candidate.path || !await exists(candidate.path)) continue;
    if (isAsarVirtualPath(candidate.path)) {
      const installPath = await copyAsarWheelToRealFile(candidate.path);
      return {
        success: true,
        sourcePath: candidate.path,
        installPath,
        source: candidate.label,
        copiedFromAsar: true,
        note: "Wheel лежал внутри app.asar, поэтому Studio скопировала его в реальную папку userData/sdk-cache перед pip install."
      };
    }
    return {
      success: true,
      sourcePath: candidate.path,
      installPath: candidate.path,
      source: candidate.label,
      copiedFromAsar: false,
      note: ""
    };
  }
  return {
    success: false,
    tried,
    error: `SDK wheel не найден: ${SDK_WHEEL_NAME}`,
    hint: "В сборке должен быть файл resources/sdk/funpay_pulse_sdk-0.1.0-py3-none-any.whl. В electron-builder он теперь дополнительно кладётся во внешнюю resources/sdk и в asarUnpack."
  };
}
async function pulseInvocation(projectRoot) {
  const { py, pulse } = venvPaths(projectRoot);
  if (await exists(pulse)) return { cmd: pulse, argsPrefix: [], display: pulse };
  return { cmd: py, argsPrefix: ["-m", "funpay_pulse_sdk.cli"], display: `${py} -m funpay_pulse_sdk.cli` };
}
async function runPulse(projectRoot, args, env = {}, timeoutMs = 12e4) {
  const inv = await pulseInvocation(projectRoot);
  const r = await spawnCollect(inv.cmd, [...inv.argsPrefix, ...args], projectRoot, env, timeoutMs);
  return { ...r, runner: inv.display };
}
function sdkInstallHint(stderr, wheelInfo) {
  const text = String(stderr || "");
  if (text.includes("app.asar") || text.includes("No such file or directory") || text.includes("file does not exist")) {
    return "SDK wheel был недоступен как обычный файл. В v10 Studio копирует wheel из app.asar во внешнюю папку userData/sdk-cache и ставит SDK оттуда. Пересобери .exe этой версией и нажми “Установить SDK”.";
  }
  if (text.includes("CERTIFICATE_VERIFY_FAILED")) return "SSL мешает pip. Нажми “Исправить SSL / certifi” и повтори установку SDK.";
  if (text.includes("No module named pip")) return "В .venv нет pip. Studio уже запускает ensurepip; если ошибка осталась, переустанови Python с модулем venv/pip.";
  if (text.includes("Permission denied") || text.includes("Access is denied")) return "Нет доступа к файлам .venv или Program Files. Закрой вторую копию Studio, запусти от обычного пользователя и проверь антивирус/права проекта.";
  if (wheelInfo?.copiedFromAsar) return "SDK wheel был скопирован из app.asar в реальную папку, но pip всё равно упал. См. stderr выше; чаще всего причина в повреждённом Python/pip.";
  return "SDK не установился в .venv. См. stderr выше. Studio ставит SDK из локального wheel и не требует интернет-зависимостей.";
}
function spawnCollect(command, args, cwd, env = {}, timeoutMs = 12e4) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let killed = false;
    let child;
    try {
      child = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell: false, windowsHide: true });
    } catch (e) {
      resolve({ success: false, error: e.message || String(e), command: [command, ...args].join(" ") });
      return;
    }
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ success: false, error: e.message, stdout, stderr, durationMs: Date.now() - started, command: [command, ...args].join(" ") });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, code, stdout, stderr, killed, durationMs: Date.now() - started, command: [command, ...args].join(" ") });
    });
  });
}
async function inferProjectRoot(root) {
  const candidates = [root];
  async function scan(dir, depth = 0) {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === "funpay-pulse.plugin.json")) candidates.push(dir);
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") await scan(path.join(dir, e.name), depth + 1);
  }
  await scan(root);
  const scored = await Promise.all(candidates.map(async (c) => ({
    c,
    score: (await exists(path.join(c, "funpay-pulse.plugin.json")) ? 10 : 0) + (await exists(path.join(c, "app.py")) ? 5 : 0) + (await exists(path.join(c, "fixtures")) ? 2 : 0)
  })));
  return scored.sort((a, b) => b.score - a.score)[0]?.c || root;
}
async function getProject(projectId) {
  const projectRoot = path.join(STUDIO_ROOT, projectId);
  if (!isInside(STUDIO_ROOT, projectRoot)) throw new Error("Invalid project id");
  const actualRoot = await inferProjectRoot(projectRoot);
  return { projectRoot, actualRoot };
}
function resolvePreloadPath() {
  const candidates = [
    path.join(__dirname$1, "preload.js"),
    path.join(__dirname$1, "preload.mjs"),
    path.join(app.getAppPath(), "dist-electron", "preload.js"),
    path.join(app.getAppPath(), "dist-electron", "preload.mjs"),
    path.join(app.getAppPath(), "electron", "preload.js"),
    path.join(app.getAppPath(), "electron", "preload.mjs")
  ];
  const found = candidates.find((candidate) => fssync.existsSync(candidate));
  if (!found) {
    console.error("Pulse Plugin Studio preload was not found. Checked:", candidates);
  }
  return found || candidates[0];
}
function createWindow() {
  Menu.setApplicationMenu(null);
  const iconPath = resourcePath("assets", process.platform === "win32" ? "icon.ico" : "icon.png");
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#050706",
    title: "Pulse Plugin Studio",
    show: false,
    // Keep the native OS window frame/controls. The old frameless window used
    // custom HTML buttons, which are unreliable on some Windows builds.
    frame: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#050706",
      symbolColor: "#d7e0da",
      height: 38
    },
    autoHideMenuBar: true,
    icon: fssync.existsSync(iconPath) ? iconPath : void 0,
    webPreferences: {
      preload: resolvePreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  win.setMenu(null);
  win.setMenuBarVisibility(false);
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("Pulse Plugin Studio preload failed:", preloadPath, error);
  });
  win.once("ready-to-show", () => win?.show());
  if (isDev) {
    win.loadURL(rendererUrl);
  } else {
    const distIndex = path.join(__dirname$1, "../dist/index.html");
    win.loadFile(distIndex);
  }
}
if (singleInstanceLock) {
  app.whenReady().then(async () => {
    await ensureDir(STUDIO_ROOT);
    createWindow();
  });
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
function senderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender) || win;
}
ipcMain.handle("window:minimize", (event) => {
  const w = senderWindow(event);
  w?.minimize();
  return true;
});
ipcMain.handle("window:maximize", (event) => {
  const w = senderWindow(event);
  if (!w) return false;
  w.maximize();
  return true;
});
ipcMain.handle("window:unmaximize", (event) => {
  const w = senderWindow(event);
  if (!w) return false;
  w.unmaximize();
  return true;
});
ipcMain.handle("window:maximizeToggle", (event) => {
  const w = senderWindow(event);
  if (!w) return false;
  w.isMaximized() ? w.unmaximize() : w.maximize();
  return w.isMaximized();
});
ipcMain.handle("window:close", (event) => {
  const w = senderWindow(event);
  w?.close();
  return true;
});
ipcMain.handle("window:isMaximized", (event) => {
  const w = senderWindow(event);
  return w?.isMaximized() || false;
});
ipcMain.handle("studio:getSettings", async () => readJson(SETTINGS_FILE, { theme: "pulse", python: pythonCmd(), updateManifestUrl: DEFAULT_UPDATE_MANIFEST_URL }));
ipcMain.handle("studio:setSettings", async (_e, s) => {
  await writeJson(SETTINGS_FILE, s);
  return true;
});
ipcMain.handle("updater:getInfo", async () => {
  const settings = await loadSettings();
  return {
    success: true,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    manifestUrl: updateManifestUrlFromSettings(settings),
    downloadedUpdate: settings.downloadedUpdate || null,
    platform: process.platform
  };
});
ipcMain.handle("updater:setManifestUrl", async (_e, url) => {
  const clean = safeUpdateUrl(url);
  await saveSettingsPatch({ updateManifestUrl: clean });
  return { success: true, manifestUrl: clean };
});
ipcMain.handle("updater:checkInno", async (_e, manifestUrl) => {
  const settings = await loadSettings();
  const url = manifestUrl ? safeUpdateUrl(manifestUrl) : updateManifestUrlFromSettings(settings);
  const result = await fetchUpdateManifest(url);
  updaterEmit({ type: "checked", result });
  return result;
});
ipcMain.handle("updater:downloadInno", async (_e, manifest) => {
  const result = await downloadInnoUpdate(manifest);
  return result;
});
ipcMain.handle("updater:installInno", async (_e, installerPath) => installDownloadedInnoUpdate(installerPath));
ipcMain.handle("auth:getState", async () => {
  const settings = await loadSettings();
  if (!settings[AUTH_COOKIE_SETTING_KEY]) {
    return { success: true, authenticated: false, profile: null, cachedProfile: settings.authProfileCache || null };
  }
  return await fetchAndStoreProfile();
});
ipcMain.handle("auth:telegramInit", async () => {
  const response = await pulseApi("/api/v2/auth/telegram/init", { method: "POST", body: {}, auth: false });
  if (!response.ok) {
    return { success: false, status: response.status, error: response.json?.detail || response.json?.error || response.text || "Не удалось начать вход через Telegram." };
  }
  return {
    success: true,
    code: response.json?.code,
    expires_in: response.json?.expires_in || 180,
    bot_username: response.json?.bot_username || "pulse_funpaybot"
  };
});
ipcMain.handle("auth:telegramPoll", async (_e, code) => {
  const cleanCode = String(code || "").trim();
  if (!cleanCode) return { success: false, verified: false, error: "Код авторизации пустой." };
  let response = await pulseApi("/api/v2/auth/telegram/web-code", { method: "POST", body: { code: cleanCode } });
  if (!response.ok && (response.status === 400 || response.status === 404 || response.status === 422)) {
    response = await pulseApi("/api/v2/auth/telegram/web-code", { method: "POST", body: { web_code: cleanCode } });
  }
  if (!response.ok && (response.status === 400 || response.status === 404 || response.status === 422)) {
    response = await pulseApi("/api/v2/auth/telegram/web-code", { method: "POST", body: {} });
  }
  if (!response.ok) {
    return { success: false, verified: false, status: response.status, error: response.json?.detail || response.json?.error || response.text || "Не удалось проверить Telegram-код." };
  }
  const verified = !!response.json?.verified;
  if (!verified) return { success: true, verified: false, expires_in: response.json?.expires_in };
  const profile = await fetchAndStoreProfile();
  return { success: profile.success, verified: true, profile: profile.profile, profileResult: profile };
});
ipcMain.handle("auth:getProfile", async () => fetchAndStoreProfile());
ipcMain.handle("auth:getAuthorProfile", async () => fetchAuthorProfile());
ipcMain.handle("auth:saveAuthorProfile", async (_e, payload) => {
  const body = cleanAuthorProfilePayload(payload);
  if (!body.slug) return { success: false, error: "Slug не может быть пустым." };
  if (!body.display_name) return { success: false, error: "Имя автора не может быть пустым." };
  const response = await pulseApi("/api/v2/plugin-marketplace/publisher/author-profile", { method: "PUT", body });
  if (!response.ok) {
    return { success: false, status: response.status, error: response.json?.detail || response.json?.error || response.text || "Не удалось сохранить профиль разработчика.", response: response.json };
  }
  const authorProfile = response.json?.profile ?? response.json ?? body;
  const slug = authorProfile?.slug || body.slug;
  await saveSettingsPatch({ authorProfileSlug: slug, authorProfileCache: authorProfile });
  return { success: true, profile: authorProfile, slug, raw: response.json };
});
ipcMain.handle("marketplace:getStats", async () => readMarketplaceStats());
ipcMain.handle("developerTokens:create", async (_e, payload) => {
  const body = { name: String(payload?.name || "SDK CLI").trim() || "SDK CLI" };
  const response = await pulseApi("/api/v2/plugin-marketplace/publisher/developer-tokens", { method: "POST", body });
  if (!response.ok) {
    return { success: false, status: response.status, error: response.json?.detail || response.json?.error || response.text || "Не удалось создать developer token.", response: response.json };
  }
  return { success: true, ...response.json };
});
ipcMain.handle("developerTokens:revoke", async (_e, publicId) => {
  const id = String(publicId || "").trim();
  if (!id) return { success: false, error: "Token public_id пустой." };
  const response = await pulseApi(`/api/v2/plugin-marketplace/publisher/developer-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) {
    return { success: false, status: response.status, error: response.json?.detail || response.json?.error || response.text || "Не удалось отозвать developer token.", response: response.json };
  }
  return { success: true, ...response.json };
});
ipcMain.handle("studio:securityScan", async (_e, projectId) => scanProjectSecurity(projectId));
ipcMain.handle("studio:packageGuard", async (_e, projectId) => packageGuard(projectId));
ipcMain.handle("studio:openExternal", async (_e, url) => {
  const clean = String(url || "").trim();
  if (!/^https:\/\//i.test(clean)) return { success: false, error: "Можно открывать только HTTPS-ссылки." };
  await shell.openExternal(clean);
  return { success: true, url: clean };
});
ipcMain.handle("auth:openTelegram", async (_e, payload) => {
  const code = encodeURIComponent(String(payload?.code || "").trim());
  const bot = String(payload?.bot_username || "pulse_funpaybot").replace(/^@/, "").trim() || "pulse_funpaybot";
  if (!code) return { success: false, error: "Код авторизации пустой." };
  const url = `https://t.me/${encodeURIComponent(bot)}?start=web_${code}`;
  await shell.openExternal(url);
  return { success: true, url };
});
ipcMain.handle("auth:openAuthorProfile", async () => {
  const settings = await loadSettings();
  const response = await pulseApi("/api/v2/plugin-marketplace/publisher/author-profile", { method: "GET" });
  if (!response.ok) {
    const cachedSlug = settings.authorProfileSlug;
    if (cachedSlug) {
      const url2 = `${PULSE_API_BASE}/plugins/authors/${encodeURIComponent(cachedSlug)}`;
      await shell.openExternal(url2);
      return { success: true, cached: true, slug: cachedSlug, url: url2, warning: "Не удалось обновить профиль разработчика, открыт сохранённый slug." };
    }
    return { success: false, status: response.status, error: response.json?.detail || response.json?.error || response.text || "Не удалось получить профиль разработчика.", response: response.json };
  }
  const authorProfile = response.json?.profile ?? response.json;
  const slug = authorProfile?.slug || settings.authorProfileSlug;
  if (!slug) {
    return {
      success: false,
      error: "У профиля разработчика пока нет slug. Возможно, профиль ещё не создан или не опубликован.",
      response: response.json
    };
  }
  await saveSettingsPatch({ authorProfileSlug: slug, authorProfileCache: authorProfile });
  const url = `${PULSE_API_BASE}/plugins/authors/${encodeURIComponent(slug)}`;
  await shell.openExternal(url);
  return { success: true, slug, url, profile: authorProfile };
});
ipcMain.handle("auth:logout", async () => {
  try {
    await pulseApi("/api/v2/auth/logout", { method: "POST" });
  } catch {
  }
  await clearAuthSession();
  return { success: true, authenticated: false, profile: null };
});
ipcMain.handle("studio:listProjects", async () => {
  await ensureDir(STUDIO_ROOT);
  const rows = [];
  for (const e of await fs.readdir(STUDIO_ROOT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const root = path.join(STUDIO_ROOT, e.name);
    const actualRoot = await inferProjectRoot(root);
    const manifest = await readJson(path.join(actualRoot, "funpay-pulse.plugin.json"), null);
    rows.push({ id: e.name, root, actualRoot, name: manifest?.name || manifest?.plugin_id || manifest?.id || e.name, manifest });
  }
  return rows;
});
ipcMain.handle("studio:createProject", async (_e, payload) => {
  const id = sanitizePluginId(payload.id || payload.name || "plugin");
  const root = path.join(STUDIO_ROOT, `${id}_${Date.now()}`);
  await ensureDir(path.join(root, "fixtures"));
  const trusted = payload.template === "trusted-actions";
  const events = payload.events?.length ? payload.events : ["events:new_message", "events:new_order", "events:order_confirmed", "events:new_review"];
  const scopes = trusted ? ["logs:write", "messages:send"] : [];
  const manifest = {
    manifest_version: "1.0",
    plugin_id: id,
    id,
    name: payload.title || id,
    description: "Local-first Broker polling plugin",
    version: "1.0.0",
    runtime: { type: "broker-poller", url: "http://localhost:8787/funpay-pulse/broker-poller" },
    events,
    scopes,
    config_schema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", title: "Enabled", default: true }
      }
    },
    ui_schema: {}
  };
  const appTemplate = '"""Local-first FunPay Pulse Broker polling plugin template."""\n\nfrom __future__ import annotations\n\nimport argparse\nimport logging\nimport os\nfrom pathlib import Path\n\nfrom funpay_pulse_sdk import (\n    BrokerClient,\n    FixtureBrokerClient,\n    NewMessageEvent,\n    NewOrderEvent,\n    NewReviewEvent,\n    OrderConfirmedEvent,\n    PluginApp,\n)\n\n\nLOG = logging.getLogger("__PLUGIN_ID__")\n\n\ndef read_broker_token() -> str:\n    token_file = os.environ.get("FPP_BROKER_TOKEN_FILE", "").strip()\n    if token_file:\n        return Path(token_file).read_text(encoding="utf-8").strip()\n    return os.environ["FPP_BROKER_TOKEN"]\n\n\ndef build_client(args: argparse.Namespace):\n    if args.fixtures:\n        return FixtureBrokerClient.from_file(args.fixtures)\n\n    base_url = os.environ.get("FPP_BASE_URL", "https://funpaypulse.com")\n    broker_token = read_broker_token()\n    allow_localhost = os.environ.get("FPP_ALLOW_INSECURE_LOCALHOST") == "1"\n    return BrokerClient(\n        base_url=base_url,\n        broker_token=broker_token,\n        allow_insecure_localhost=allow_localhost,\n    )\n\n\ndef create_app(client) -> PluginApp:\n    app = PluginApp(client, logger=LOG)\n\n    @app.on(NewMessageEvent)\n    def handle_new_message(event: NewMessageEvent) -> None:\n        LOG.info(\n            "new message chat=%s author=%s text=%r",\n            event.chat_id,\n            event.author_username or event.buyer_username,\n            event.text,\n        )\n\n    @app.on(NewOrderEvent)\n    def handle_new_order(event: NewOrderEvent) -> None:\n        LOG.info("new order id=%s buyer=%s title=%r", event.order_id, event.buyer_username, event.title)\n\n    @app.on(OrderConfirmedEvent)\n    def handle_order_confirmed(event: OrderConfirmedEvent) -> None:\n        LOG.info("order confirmed id=%s status=%s", event.order_id, event.new_status)\n\n    @app.on(NewReviewEvent)\n    def handle_new_review(event: NewReviewEvent) -> None:\n        LOG.info("new review id=%s rating=%s text=%r", event.review_id, event.rating, event.text)\n\n    return app\n\n\ndef run_once(client, *, limit: int, write_log_actions: bool = False) -> int:\n    return create_app(client).process_once(\n        limit=limit,\n        write_log_actions=write_log_actions,\n    )\n\n\ndef main(argv: list[str] | None = None) -> int:\n    parser = argparse.ArgumentParser(prog="__PLUGIN_ID__")\n    parser.add_argument("--fixtures", help="Run against local Broker event fixtures instead of the real API")\n    parser.add_argument("--limit", type=int, default=50)\n    parser.add_argument("--once", action="store_true", help="Process one poll batch and exit")\n    parser.add_argument("--poll-interval", type=float, default=3.0, help="Seconds between empty production polls")\n    parser.add_argument(\n        "--write-log-actions",\n        action="store_true",\n        help="Submit logs.write actions after each processed event; requires logs:write in production",\n    )\n    args = parser.parse_args(argv)\n\n    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")\n    client = build_client(args)\n    app = create_app(client)\n    if args.fixtures or args.once:\n        processed = app.process_once(\n            limit=args.limit,\n            write_log_actions=args.write_log_actions,\n        )\n        LOG.info("processed %s event(s)", processed)\n    else:\n        LOG.info("starting production poller")\n        app.run_forever(\n            limit=args.limit,\n            poll_interval_seconds=args.poll_interval,\n            write_log_actions=args.write_log_actions,\n        )\n    return 0\n\n\nif __name__ == "__main__":\n    raise SystemExit(main())\n';
  const readmeTemplate = "# __PLUGIN_NAME__\n\nLocal-first FunPay Pulse Broker polling plugin template.\n\nRun against bundled fixtures:\n\n```bash\npython app.py --fixtures fixtures/events.json\n```\n\nRun fixtures and record local `logs.write` actions:\n\n```bash\npython app.py --fixtures fixtures/events.json --write-log-actions\n```\n\nRun against the real Broker API after installing the plugin in FunPay Pulse:\n\n```bash\nexport FPP_BASE_URL=https://funpaypulse.com\nexport FPP_BROKER_TOKEN_FILE=/etc/funpay-pulse/plugins/__PLUGIN_ID__/broker-token\npython app.py\n```\n\nProduction mode keeps polling. For a one-shot production smoke check:\n\n```bash\npython app.py --once\n```\n\n`--write-log-actions` requires `logs:write` in the installed manifest when used\nagainst production. The template reads install config through `client.get_config()`\nand skips processing when `enabled` is `false`.\n\nAck events only after your plugin has durably processed them. Do not commit raw\n`fppb_...` tokens.\n";
  const marketplaceTemplate = {
    "pricing_type": "free",
    "price_rub": 0,
    "category": "automation",
    "summary": "Replace with a short marketplace description before public review.",
    "publisher": {
      "name": "Your public author name",
      "url": "https://your-domain.ru"
    },
    "support_url": "https://your-domain.ru/support",
    "privacy_url": "https://your-domain.ru/privacy",
    "refund_policy": "Replace with your refund terms before public review."
  };
  await writeJson(path.join(root, "funpay-pulse.plugin.json"), manifest);
  await fs.writeFile(path.join(root, "app.py"), appTemplate.replaceAll("__PLUGIN_ID__", id), "utf8");
  await ensureDefaultFixtures(root);
  await writeJson(path.join(root, "funpay-pulse.marketplace.json"), marketplaceTemplate);
  await fs.writeFile(path.join(root, "README.md"), readmeTemplate.replaceAll("__PLUGIN_ID__", id).replaceAll("__PLUGIN_NAME__", manifest.name), "utf8");
  return { id: path.basename(root), root, actualRoot: root };
});
ipcMain.handle("studio:importFolder", async () => {
  const picked = await dialog.showOpenDialog(win, { title: "Импорт папки плагина", properties: ["openDirectory"] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const src = picked.filePaths[0];
  const name = path.basename(src).replace(/[^a-zA-Z0-9_-]+/g, "_") || "imported";
  const dest = path.join(STUDIO_ROOT, `${name}_${Date.now()}`);
  await copyDir(src, dest);
  const actualRoot = await inferProjectRoot(dest);
  await repairLegacyManifest(actualRoot);
  await ensureDefaultFixtures(actualRoot);
  return { id: path.basename(dest), root: dest, actualRoot };
});
ipcMain.handle("studio:importArchive", async () => {
  const picked = await dialog.showOpenDialog(win, {
    title: "Импорт архива плагина",
    filters: [{ name: "Plugin archives", extensions: ["zip", "fppkg", "fqq"] }],
    properties: ["openFile"]
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const src = picked.filePaths[0];
  const name = path.basename(src, path.extname(src)).replace(/[^a-zA-Z0-9_-]+/g, "_") || "imported";
  const dest = path.join(STUDIO_ROOT, `${name}_${Date.now()}`);
  await ensureDir(dest);
  try {
    await extractArchive(src, dest);
    const actualRoot = await inferProjectRoot(dest);
    await repairLegacyManifest(actualRoot);
    await ensureDefaultFixtures(actualRoot);
    return { id: path.basename(dest), root: dest, actualRoot };
  } catch (e) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => void 0);
    throw e;
  }
});
ipcMain.handle("studio:getTree", async (_e, projectId) => {
  const { actualRoot } = await getProject(projectId);
  return { root: actualRoot, tree: await walk(actualRoot) };
});
ipcMain.handle("studio:readFile", async (_e, projectId, rel) => {
  const { actualRoot } = await getProject(projectId);
  const full = path.join(actualRoot, rel);
  if (!isInside(actualRoot, full)) throw new Error("Invalid path");
  return await fs.readFile(full, "utf8");
});
ipcMain.handle("studio:writeFile", async (_e, projectId, rel, content) => {
  const { actualRoot } = await getProject(projectId);
  const full = path.join(actualRoot, rel);
  if (!isInside(actualRoot, full)) throw new Error("Invalid path");
  await ensureDir(path.dirname(full));
  await fs.writeFile(full, content, "utf8");
  return true;
});
ipcMain.handle("studio:createEntry", async (_e, projectId, rel, type) => {
  const { actualRoot } = await getProject(projectId);
  const full = path.join(actualRoot, rel);
  if (!isInside(actualRoot, full)) throw new Error("Invalid path");
  if (type === "directory") await ensureDir(full);
  else {
    await ensureDir(path.dirname(full));
    await fs.writeFile(full, "", "utf8");
  }
  return true;
});
ipcMain.handle("studio:renameEntry", async (_e, projectId, rel, nextRel) => {
  const { actualRoot } = await getProject(projectId);
  const oldPath = path.join(actualRoot, rel);
  const newPath = path.join(actualRoot, nextRel);
  if (!isInside(actualRoot, oldPath) || !isInside(actualRoot, newPath)) throw new Error("Invalid path");
  await ensureDir(path.dirname(newPath));
  await fs.rename(oldPath, newPath);
  return true;
});
ipcMain.handle("studio:deleteEntry", async (_e, projectId, rel) => {
  const { actualRoot } = await getProject(projectId);
  const full = path.join(actualRoot, rel);
  if (!isInside(actualRoot, full) || path.resolve(full) === path.resolve(actualRoot)) throw new Error("Invalid path");
  await fs.rm(full, { recursive: true, force: true });
  return true;
});
ipcMain.handle("studio:openPath", async (_e, p) => {
  await shell.openPath(p);
  return true;
});
async function ensureSdkForProject(projectId) {
  const { actualRoot } = await getProject(projectId);
  await repairLegacyManifest(actualRoot);
  await ensureDefaultFixtures(actualRoot);
  const { py, pulse } = venvPaths(actualRoot);
  if (!await exists(py)) {
    const venv = await createVenv(actualRoot);
    if (!venv.success) {
      const result2 = {
        ...venv,
        step: "create-venv",
        hint: "Не найден Python или не удалось создать .venv. Установи Python 3.10+ и включи Add Python to PATH, затем повтори “Установить SDK”."
      };
      await appendSessionEvent(projectId, { type: "sdk", title: "ensure SDK", result: result2 });
      return result2;
    }
  }
  const ensurePip = await spawnCollect(py, ["-m", "ensurepip", "--upgrade"], actualRoot, {}, 12e4);
  if (!ensurePip.success) {
    const result2 = { ...ensurePip, step: "ensurepip", python: py, hint: "В .venv не удалось включить pip. Проверь установку Python и модуль venv." };
    await appendSessionEvent(projectId, { type: "sdk", title: "ensure SDK", result: result2 });
    return result2;
  }
  const wheelInfo = await resolveInstallableSdkWheel();
  if (!wheelInfo.success || !wheelInfo.installPath) {
    const result2 = { ...wheelInfo, success: false, step: "find-sdk-wheel", hint: wheelInfo.hint || "SDK wheel не найден или путь к wheel пустой." };
    await appendSessionEvent(projectId, { type: "sdk", title: "ensure SDK", result: result2 });
    return result2;
  }
  const installPath = wheelInfo.installPath;
  const pip = await spawnCollect(py, ["-m", "pip", "install", "--upgrade", "--no-deps", installPath], actualRoot, {}, 18e4);
  if (!pip.success) {
    const result2 = {
      ...pip,
      step: "install-sdk-wheel",
      python: py,
      wheel: installPath,
      wheelSource: wheelInfo.sourcePath,
      wheelSourceKind: wheelInfo.source,
      copiedFromAsar: wheelInfo.copiedFromAsar,
      hint: sdkInstallHint(pip.stderr || pip.error || "", wheelInfo)
    };
    await appendSessionEvent(projectId, { type: "sdk", title: "ensure SDK", result: result2 });
    return result2;
  }
  const help = await runPulse(actualRoot, ["--help"], {}, 6e4);
  const importCheck = await spawnCollect(py, ["-c", "import funpay_pulse_sdk; print(funpay_pulse_sdk.__name__)"], actualRoot, {}, 6e4);
  const result = {
    success: help.success && importCheck.success,
    step: "ensure-sdk",
    python: py,
    pulsePlugin: pulse,
    runner: help.runner,
    wheel: wheelInfo.installPath,
    wheelSource: wheelInfo.sourcePath,
    wheelSourceKind: wheelInfo.source,
    copiedFromAsar: wheelInfo.copiedFromAsar,
    note: wheelInfo.note,
    pip,
    importCheck,
    stdout: help.stdout,
    stderr: help.stderr || importCheck.stderr,
    code: help.code || importCheck.code,
    hint: help.success && importCheck.success ? "SDK установлен в .venv, CLI pulse-plugin доступен." : "SDK установлен, но CLI/import check не прошёл. Проверь stdout/stderr выше; попробуй удалить .venv и нажать “Установить SDK”."
  };
  await appendSessionEvent(projectId, { type: "sdk", title: "ensure SDK", result });
  return result;
}
ipcMain.handle("studio:ensureSdk", async (_e, projectId) => ensureSdkForProject(projectId));
ipcMain.handle("studio:fixSsl", async (_e, projectId) => {
  const { actualRoot } = await getProject(projectId);
  const { py } = venvPaths(actualRoot);
  const r = await spawnCollect(py, ["-c", "import certifi; print(certifi.where())"], actualRoot, {}, 6e4);
  if (!r.success) return r;
  const cert = r.stdout.trim().split(/\r?\n/).pop();
  await writeJson(path.join(actualRoot, ".plugin-studio-ssl-env.json"), { SSL_CERT_FILE: cert, REQUESTS_CA_BUNDLE: cert });
  const result = { success: true, cert };
  await appendSessionEvent(projectId, { type: "ssl", title: "fix SSL / certifi", result });
  return result;
});
ipcMain.handle("studio:runCommand", async (_e, projectId, preset, extra) => {
  const { actualRoot } = await getProject(projectId);
  await repairLegacyManifest(actualRoot);
  await ensureDefaultFixtures(actualRoot);
  const { pulse, py } = venvPaths(actualRoot);
  const manifest = await readJson(path.join(actualRoot, "funpay-pulse.plugin.json"), {});
  const trustedScopes = ["messages:send", "orders:refund", "orders:review", "lots:active", "lots:price", "lots:raise", "blacklist:add", "blacklist:remove"];
  const trusted = !!extra?.trusted || (manifest.scopes || []).some((scope) => trustedScopes.includes(scope));
  const sslEnv = await readJson(path.join(actualRoot, ".plugin-studio-ssl-env.json"), {});
  let cmd = pulse;
  let args = [];
  if (preset === "validate") args = ["validate", "funpay-pulse.plugin.json", "--allow-localhost"];
  else if (preset === "check") args = ["check", ".", "--allow-localhost", "--require-fixtures"];
  else if (preset === "test") args = ["test", ".", "--allow-localhost"];
  else if (preset === "doctor") args = ["doctor", ".", "--allow-localhost", "--require-fixtures"];
  else if (preset === "pack") args = ["pack", ".", "--allow-localhost"];
  else if (preset === "dry-run") args = ["publish", ".", "--dry-run", "--offline", "--allow-localhost", "--api", extra?.api || "https://funpaypulse.com"];
  else if (preset === "run-fixtures") {
    cmd = py;
    args = ["app.py", "--fixtures", "fixtures/events.json"];
  } else if (preset === "custom") {
    const raw = String(extra?.command || "").trim();
    if (!raw.startsWith("pulse-plugin ") && !raw.startsWith("python ")) throw new Error("Only pulse-plugin/python commands are allowed");
    const parts = raw.split(/\s+/);
    cmd = parts[0] === "python" ? py : pulse;
    args = parts.slice(1);
  } else {
    throw new Error(`Unknown command preset: ${preset}`);
  }
  if (trusted && cmd === pulse && !args.includes("--trusted")) args.push("--trusted");
  if (preset === "pack" && cmd === pulse && !args.includes("--out")) {
    const pluginId = sanitizePluginId(manifest.plugin_id || manifest.id || "plugin");
    const version = String(manifest.version || "1.0.0").replace(/[^a-zA-Z0-9._-]+/g, "_");
    const outDir = path.join(actualRoot, "dist");
    await ensureDir(outDir);
    args.push("--out", path.join(outDir, `${pluginId}-${version}.fppkg`));
  }
  if (cmd === pulse && !await exists(pulse)) {
    const setup = await ensureSdkForProject(projectId);
    if (!setup.success) {
      const result2 = {
        success: false,
        step: `auto-ensure-sdk-before-${preset}`,
        setup,
        hint: setup.hint || "Перед проверкой нужно установить SDK. Нажми “Установить SDK” и повтори команду."
      };
      await appendSessionEvent(projectId, { type: "command", title: preset, result: result2 });
      return result2;
    }
  }
  if (cmd === py && !await exists(py)) {
    const setup = await ensureSdkForProject(projectId);
    if (!setup.success) {
      const result2 = {
        success: false,
        step: `auto-ensure-sdk-before-${preset}`,
        setup,
        hint: setup.hint || "Для запуска fixtures нужен Python/.venv. Нажми “Установить SDK” и повтори команду."
      };
      await appendSessionEvent(projectId, { type: "command", title: preset, result: result2 });
      return result2;
    }
  }
  let deps = null;
  if (shouldEnsureRuntimeDeps(String(preset))) {
    deps = await ensureProjectRuntimeDependencies(projectId, actualRoot, sslEnv);
    if (!deps.success) {
      const result2 = {
        success: false,
        step: `auto-install-runtime-deps-before-${preset}`,
        deps,
        hint: deps.hint || "Не удалось установить зависимости проекта в .venv."
      };
      await appendSessionEvent(projectId, { type: "command", title: preset, result: result2 });
      return result2;
    }
  }
  let r;
  let cleanStaging = null;
  if (shouldRunInCleanStaging(String(preset))) {
    const guard = await packageGuard(projectId);
    if (!guard.success) {
      const result2 = { success: false, step: `clean-staging-before-${preset}`, guard, hint: guard.hint };
      await appendSessionEvent(projectId, { type: "command", title: preset, result: result2 });
      return result2;
    }
    const stagingParent = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-command-clean-"));
    const stagingRoot = path.join(stagingParent, path.basename(actualRoot));
    try {
      await copyCleanProjectForReview(actualRoot, stagingRoot);
      cleanStaging = { used: true, included_count: guard.included_count, excluded_count: guard.excluded_count, cwd: stagingRoot };
      r = cmd === pulse ? await runPulseUsingVenv(actualRoot, stagingRoot, args, sslEnv, 18e4) : await spawnCollect(cmd, args, stagingRoot, sslEnv, 18e4);
    } finally {
      await fs.rm(stagingParent, { recursive: true, force: true }).catch(() => {
      });
    }
  } else {
    r = cmd === pulse ? await runPulse(actualRoot, args, sslEnv, 18e4) : await spawnCollect(cmd, args, actualRoot, sslEnv, 18e4);
  }
  const stderr = r.stderr || r.error || "";
  const hint = stderr.includes("CERTIFICATE_VERIFY_FAILED") ? "Нажми Исправить SSL / certifi и повтори команду." : stderr.includes("ModuleNotFoundError") ? "В app.py не хватает Python-зависимости. Studio теперь ставит requirements.txt и частые импорты вроде requests автоматически; если модуль нестандартный — добавь его в requirements.txt." : stderr.includes("hidden files are not allowed") ? "SDK увидел hidden-файл. В v21 команды запускаются через clean-staging без .plugin-studio/dist/.venv; повтори команду после обновления." : stderr.includes("trusted plugin review") ? "Плагин просит trusted-права. Studio добавляет --trusted автоматически; проверь manifest." : stderr.includes("No module named pip") ? "В .venv нет pip. Нажми Установить SDK, Studio попробует ensurepip." : stderr.includes("manifest_version") || stderr.includes("plugin_id") ? "Manifest был приведён к SDK v1 перед запуском. Если ошибка осталась — открой funpay-pulse.plugin.json и проверь обязательные поля manifest_version/plugin_id/name/version/runtime." : stderr.includes("fixtures: invalid") ? "fixtures/events.json должен быть в формате SDK: объект с items[]. Studio создаёт валидный fixture для новых проектов." : stderr.includes("app.asar") || stderr.includes("file does not exist") ? "Команда увидела путь внутри app.asar. В v10 SDK wheel копируется во внешнюю папку; нажми “Установить SDK” и повтори команду." : stderr.includes("ENOENT") ? "Исполняемый файл не найден. Нажми “Установить SDK” и повтори команду." : r.killed ? "Команда превысила лимит времени. Проверь, не завис ли app.py или сеть." : "";
  const result = { ...r, hint, cleanStaging, deps };
  await appendSessionEvent(projectId, { type: "command", title: preset === "custom" ? String(extra?.command || "custom") : preset, result });
  return result;
});
ipcMain.handle("studio:getManifest", async (_e, projectId) => {
  const { actualRoot } = await getProject(projectId);
  await repairLegacyManifest(actualRoot);
  return await readJson(path.join(actualRoot, "funpay-pulse.plugin.json"), {});
});
ipcMain.handle("studio:saveManifest", async (_e, projectId, manifest) => {
  const { actualRoot } = await getProject(projectId);
  await writeJson(path.join(actualRoot, "funpay-pulse.plugin.json"), manifest);
  await appendSessionEvent(projectId, { type: "manifest", title: "save manifest/config schema", result: { success: true } });
  return true;
});
ipcMain.handle("studio:getSessionReports", async (_e, projectId) => listSessionReports(projectId));
ipcMain.handle("studio:openSessionFolder", async (_e, projectId) => {
  const { actualRoot } = await getProject(projectId);
  const dir = path.join(actualRoot, ".plugin-studio", "sessions");
  await ensureDir(dir);
  await shell.openPath(dir);
  return true;
});
ipcMain.handle("studio:packageInfo", async (_e, projectId) => {
  const { actualRoot } = await getProject(projectId);
  const dist = path.join(actualRoot, "dist");
  if (!await exists(dist)) return [];
  const files = await fs.readdir(dist);
  const rows = [];
  for (const f of files.filter((f2) => f2.endsWith(".fppkg"))) {
    const full = path.join(dist, f);
    const buf = await fs.readFile(full);
    rows.push({ name: f, path: full, size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") });
  }
  return rows;
});
ipcMain.handle("studio:publishPackage", async (_e, projectId, payload) => {
  const { actualRoot } = await getProject(projectId);
  const token = String(payload?.token || "").trim();
  if (!token) {
    return { success: false, error: "Developer token пустой. Вставь fppd_... токен." };
  }
  const manifest = await readJson(path.join(actualRoot, "funpay-pulse.plugin.json"), {});
  const trustedScopes = ["messages:send", "orders:refund", "orders:review", "lots:active", "lots:price", "lots:raise", "blacklist:add", "blacklist:remove"];
  const trusted = !!payload?.trusted || (manifest.scopes || []).some((s) => trustedScopes.includes(s));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-developer-token-"));
  const tokenFile = path.join(tmp, "token.txt");
  try {
    await fs.writeFile(tokenFile, token + "\n", { encoding: "utf8", mode: 384 });
    const sslEnv = await readJson(path.join(actualRoot, ".plugin-studio-ssl-env.json"), {});
    const setup = await ensureSdkForProject(projectId);
    if (!setup.success) {
      const result2 = { success: false, step: "auto-ensure-sdk-before-publish", setup, hint: setup.hint || "Перед публикацией нужно установить SDK в .venv." };
      await appendSessionEvent(projectId, { type: "publish", title: "setup before publish", result: result2 });
      return result2;
    }
    const guard = await packageGuard(projectId);
    if (!guard.success) {
      const result2 = { success: false, step: "review-package-guard", guard, hint: guard.hint };
      await appendSessionEvent(projectId, { type: "publish", title: "review package guard", result: result2 });
      return result2;
    }
    const stagingParent = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-review-clean-"));
    const stagingRoot = path.join(stagingParent, path.basename(actualRoot));
    await copyCleanProjectForReview(actualRoot, stagingRoot);
    const marketplace = await readJson(path.join(actualRoot, "funpay-pulse.marketplace.json"), {});
    const args = ["publish", ".", "--upload", "--token-file", tokenFile, "--api", payload?.api || "https://funpaypulse.com"];
    if (payload?.publicReview !== false) {
      args.push("--public-review");
      if (marketplace.pricing_type) args.push("--pricing-type", String(marketplace.pricing_type));
      if (marketplace.price_rub != null) args.push("--price-rub", String(marketplace.price_rub));
      if (marketplace.access_duration_days != null) args.push("--access-duration-days", String(marketplace.access_duration_days));
      if (marketplace.trial_days != null) args.push("--trial-days", String(marketplace.trial_days));
    }
    if (trusted) args.push("--trusted");
    if (payload?.productId) args.push("--product-id", String(payload.productId).trim());
    const r = await runPulseUsingVenv(actualRoot, stagingRoot, args, sslEnv, 24e4);
    await fs.rm(stagingParent, { recursive: true, force: true }).catch(() => {
    });
    const result = {
      ...r,
      command: r.command ? String(r.command).replace(tokenFile, "<token-file>") : "pulse-plugin publish . --upload",
      mode: payload?.productId ? "update-existing-product" : "new-product",
      productId: payload?.productId || null,
      reviewPackageGuard: guard,
      cleanStaging: { used: true, excluded_count: guard.excluded_count, included_count: guard.included_count },
      hint: r.success ? "Пакет отправлен на review через clean-staging: dist, .plugin-studio, .venv, архивы, логи и мусор не попали в review-пакет." : (r.stderr || "").includes("CERTIFICATE_VERIFY_FAILED") ? "Нажми Исправить SSL / certifi и повтори публикацию." : ""
    };
    await appendSessionEvent(projectId, { type: "publish", title: result.mode, result });
    return result;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {
    });
  }
});
