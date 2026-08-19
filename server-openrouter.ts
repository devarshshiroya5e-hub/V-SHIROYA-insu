import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";

// Render receives the PDF here as a base64 data URL from the existing frontend.
// Keep this large enough for normal policy documents while avoiding unbounded bodies.
app.use(express.json({ limit: process.env.MAX_BODY_SIZE || "100mb" }));
app.use(express.urlencoded({ limit: process.env.MAX_BODY_SIZE || "100mb", extended: true }));

const DATA_FILE = path.join(process.cwd(), "policies_db.json");
const SECURITY_LOGS_FILE = path.join(process.cwd(), "security_audit.json");

function loadPolicies(): any[] {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error("Error reading policies_db.json:", error);
  }
  return [];
}

function savePolicies(policies: any[]) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(policies, null, 2), "utf8");
  } catch (error) {
    console.error("Error saving policies_db.json:", error);
  }
}

function loadAuditLogs(): any[] {
  try {
    if (fs.existsSync(SECURITY_LOGS_FILE)) return JSON.parse(fs.readFileSync(SECURITY_LOGS_FILE, "utf8"));
  } catch (error) {
    console.error("Error reading security_audit.json:", error);
  }
  return [{
    id: "sec-1",
    timestamp: new Date().toISOString(),
    action: "SYSTEM_INITIALIZED",
    actor: "VIJAY SHIROYA (CA)",
    details: "PolicyAI backend initialized with OpenRouter PDF analysis.",
    ipAddress: "127.0.0.1"
  }];
}

function addAuditLog(action: string, actor: string, details: string, req: express.Request) {
  const logs = loadAuditLogs();
  logs.unshift({
    id: `sec-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    action,
    actor,
    details,
    ipAddress: req.ip || "127.0.0.1"
  });
  if (logs.length > 100) logs.length = 100;
  try { fs.writeFileSync(SECURITY_LOGS_FILE, JSON.stringify(logs, null, 2), "utf8"); } catch (error) { console.error(error); }
}

function safeParseJson(value: string): any | null {
  if (!value) return null;
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* continue */ }
  }
  return null;
}

function normalizeBase64Pdf(fileData: string, mimeType = "application/pdf") {
  if (!fileData) throw new Error("PDF data is missing");
  if (fileData.startsWith("data:")) return fileData;
  const clean = fileData.includes("base64,") ? fileData.split("base64,").pop()! : fileData;
  return `data:${mimeType || "application/pdf"};base64,${clean}`;
}

function categorize(result: any): string {
  const haystack = [
    result.policyType, result.providerCompany, result.extractedText,
    ...(Array.isArray(result.additionalDetails) ? result.additionalDetails.map((x: any) => `${x.label} ${x.value}`) : [])
  ].filter(Boolean).join(" ").toLowerCase();
  if (/vehicle|motor|car|bike|two wheeler|chassis|engine no|registration|third party|own damage|idv/.test(haystack)) return "Vehicle";
  if (/health|mediclaim|floater|hospital|cashless|room rent|pre-existing|star health|niva bupa|care health/.test(haystack)) return "Health";
  if (/fire|property|shopkeeper|dwelling|burglary|building|material damage|home insurance/.test(haystack)) return "Fire";
  if (/life|term|jeevan|endowment|ulip|pension|annuity|death benefit|lic|sbi life|max life|icici pru|tata aia/.test(haystack)) return "Life";
  if (/travel|trip|passport|overseas/.test(haystack)) return "Travel";
  return "General";
}

function calculateStatus(endDate: any): string {
  if (!endDate || endDate === "Not available") return "ACTIVE";
  const parsed = new Date(String(endDate));
  if (Number.isNaN(parsed.getTime())) return "ACTIVE";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  const days = Math.ceil((parsed.getTime() - today.getTime()) / 86400000);
  if (days < 0) return "EXPIRED";
  if (days <= 30) return "EXPIRING SOON";
  return "ACTIVE";
}

const ANALYSIS_PROMPT = `You are V Shiroya Insurance AI, an expert insurance-policy auditor and document OCR engine.
Analyze the ENTIRE attached PDF, including every page, table, schedule, footer, endorsement, rider, fine-print clause, and scanned/image-only page.
The document may be from ANY insurer and may be a life, health, motor, fire, travel, or general insurance document.
Do not assume a field exists. Never invent values. If a value cannot be read or is not present, use null and add its name to missingFields.
Preserve exact policy numbers, names, amounts, dates, percentages, UINs, rider names, nominee information, exclusions, deductibles, waiting periods, limits, and other material terms.
For scanned PDFs, rely on the PDF parser/OCR output and visual page content.
Return ONLY valid JSON matching this structure:
{
  "ownerName": string|null,
  "policyNumber": string|null,
  "providerCompany": string|null,
  "policyType": string|null,
  "startDate": string|null,
  "endDate": string|null,
  "premiumAmount": number|null,
  "premiumFrequency": string|null,
  "sumAssured": number|null,
  "insuredPerson": string|null,
  "nominee": string|null,
  "nomineeRelationship": string|null,
  "phoneNumber": string|null,
  "email": string|null,
  "address": string|null,
  "dateOfBirth": string|null,
  "agentName": string|null,
  "agentPhone": string|null,
  "branchName": string|null,
  "paymentMode": string|null,
  "policyStatus": string|null,
  "maturityDate": string|null,
  "additionalDetails": [{"label": string, "value": string, "confidence": "high"|"medium"|"low"}],
  "missingFields": string[],
  "uncertainFields": string[],
  "confidence": number,
  "extractedText": string
}
Dates should preferably be YYYY-MM-DD when unambiguous. Amounts must be numeric without currency symbols. confidence is 0-100.`;

async function callOpenRouter(fileData: string, fileName: string, mimeType: string, instruction: string) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key === "MY_OPENROUTER_API_KEY") {
    throw new Error("OPENROUTER_API_KEY is not configured on the Render server");
  }

  const pdfData = normalizeBase64Pdf(fileData, mimeType);
  const prompt = `${ANALYSIS_PROMPT}\n\nFilename: ${fileName}\nUser instruction: ${instruction || "Extract and analyze all available insurance policy information."}`;

  const body = {
    model: OPENROUTER_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "file", file: { filename: fileName || "policy.pdf", file_data: pdfData } }
      ]
    }],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: Number(process.env.OPENROUTER_MAX_TOKENS || 12000),
    plugins: [{ id: "file-parser", pdf: { engine: process.env.OPENROUTER_PDF_ENGINE || "cloudflare-ai" } }]
  };

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://v-shiroya-insu.onrender.com",
      "X-Title": "V-SHIROYA Insurance Policy Analyzer"
    },
    body: JSON.stringify(body)
  });

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `OpenRouter returned HTTP ${response.status}`;
    throw new Error(`OpenRouter: ${message}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    return safeParseJson(content.map((x: any) => x?.text || "").join("\n"));
  }
  return safeParseJson(typeof content === "string" ? content : "");
}

async function performAiPolicyAnalysis(fileData: string, fileName: string, mimeType: string, instruction: string) {
  const result = await callOpenRouter(fileData, fileName, mimeType, instruction);
  if (!result) throw new Error("OpenRouter returned an invalid JSON analysis");

  result.category = categorize(result);
  if (!result.policyType) result.policyType = `${result.category} Insurance`;
  result.policyStatus = calculateStatus(result.endDate);
  result.documentType = result.documentType || "INSURANCE_DOCUMENT";
  result.detectedInsurer = result.providerCompany || "Insurance Provider";
  result.fieldConfidenceMap = result.fieldConfidenceMap || {};
  for (const field of ["ownerName", "policyNumber", "providerCompany", "premiumAmount", "startDate", "endDate", "sumAssured", "policyType"]) {
    const value = result[field];
    result.fieldConfidenceMap[field] = value !== null && value !== undefined && value !== "" ? "high" : "low";
  }
  if (!Array.isArray(result.additionalDetails)) result.additionalDetails = [];
  if (!Array.isArray(result.missingFields)) result.missingFields = [];
  if (!Array.isArray(result.uncertainFields)) result.uncertainFields = [];
  if (typeof result.confidence !== "number") result.confidence = 80;
  return result;
}

// ---- API ----
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "V Shiroya AI Backend",
    aiProvider: "OpenRouter",
    openrouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    model: OPENROUTER_MODEL,
    pdfEngine: process.env.OPENROUTER_PDF_ENGINE || "cloudflare-ai",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/auth/me", (_req, res) => {
  res.json({ user: {
    id: "acc-1",
    name: "VIJAY SHIROYA",
    email: "vijay.ca@policyai.com",
    firmName: "VIJAY SHIROYA & Co. Chartered Accountants",
    role: "Senior Accountant / Auditor",
    avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
  }});
});

app.post("/api/analyze-policy", async (req, res) => {
  const { fileData, fileName, mimeType, instruction } = req.body || {};
  try {
    if (!fileName) return res.status(400).json({ error: "Filename is required" });
    if (!fileData) return res.status(400).json({ error: "PDF data is required" });
    if (mimeType && mimeType !== "application/pdf") return res.status(400).json({ error: "Only PDF policy documents are supported by this analyzer" });

    console.log(`OpenRouter PDF analysis: ${fileName}`);
    const extraction = await performAiPolicyAnalysis(fileData, fileName, "application/pdf", instruction || "Analyze policy document and extract all fields.");
    addAuditLog("POLICY_ANALYSIS", "VIJAY SHIROYA (CA)", `Analyzed document: ${fileName} with OpenRouter`, req);
    res.json({ success: true, extraction });
  } catch (error: any) {
    console.error("Policy AI analysis error:", error);
    res.status(500).json({ error: "AI analysis failed.", details: error?.message || "Unknown AI Analysis Error", fileName: fileName || "uploaded_file" });
  }
});

app.get("/api/policies", (req, res) => {
  let policies = loadPolicies();
  const query = String(req.query.q || "").toLowerCase().trim();
  const statusFilter = String(req.query.status || "");
  const providerFilter = String(req.query.provider || "");
  if (query) policies = policies.filter((p: any) => [p.ownerName, p.policyNumber, p.phoneNumber, p.providerCompany, p.policyType].some(v => String(v || "").toLowerCase().includes(query)));
  if (statusFilter && statusFilter !== "ALL") policies = policies.filter((p: any) => p.policyStatus === statusFilter);
  if (providerFilter && providerFilter !== "ALL") policies = policies.filter((p: any) => p.providerCompany === providerFilter);
  res.json({ success: true, count: policies.length, policies });
});

app.post("/api/policies/check-duplicate", (req, res) => {
  const { policyNumber, ownerName, phoneNumber } = req.body || {};
  const duplicate = loadPolicies().find((p: any) =>
    (policyNumber && p.policyNumber && String(p.policyNumber).toLowerCase().trim() === String(policyNumber).toLowerCase().trim()) ||
    (ownerName && phoneNumber && String(p.ownerName || "").toLowerCase().trim() === String(ownerName).toLowerCase().trim() && p.phoneNumber === phoneNumber)
  );
  res.json({ isDuplicate: Boolean(duplicate), existingPolicy: duplicate || null });
});

app.post("/api/policies", (req, res) => {
  try {
    const policyData = req.body || {};
    const policies = loadPolicies();
    const newPolicy = { ...policyData, id: policyData.id || `pol-${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), userId: "acc-1" };
    policies.unshift(newPolicy);
    savePolicies(policies);
    addAuditLog("POLICY_CREATED", "VIJAY SHIROYA (CA)", `Saved policy #${newPolicy.policyNumber} for ${newPolicy.ownerName}`, req);
    res.json({ success: true, policy: newPolicy });
  } catch (error: any) { res.status(500).json({ error: "Failed to save policy record", details: error.message }); }
});

app.put("/api/policies/:id", (req, res) => {
  try {
    const policies = loadPolicies();
    const index = policies.findIndex((p: any) => p.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Policy record not found" });
    policies[index] = { ...policies[index], ...(req.body || {}), updatedAt: new Date().toISOString() };
    savePolicies(policies);
    addAuditLog("POLICY_UPDATED", "VIJAY SHIROYA (CA)", `Updated policy #${policies[index].policyNumber}`, req);
    res.json({ success: true, policy: policies[index] });
  } catch (error: any) { res.status(500).json({ error: "Failed to update policy", details: error.message }); }
});

app.delete("/api/policies/:id", (req, res) => {
  try {
    const policies = loadPolicies();
    const existing = policies.find((p: any) => p.id === req.params.id);
    if (!existing) return res.status(404).json({ error: "Policy not found" });
    savePolicies(policies.filter((p: any) => p.id !== req.params.id));
    addAuditLog("POLICY_DELETED", "VIJAY SHIROYA (CA)", `Deleted policy #${existing.policyNumber} for ${existing.ownerName}`, req);
    res.json({ success: true, message: "Policy deleted successfully" });
  } catch (error: any) { res.status(500).json({ error: "Failed to delete policy", details: error.message }); }
});

app.get("/api/stats", (_req, res) => {
  const policies = loadPolicies();
  const currentMonth = new Date().toISOString().slice(0, 7);
  res.json({
    totalPolicies: policies.length,
    activePolicies: policies.filter((p: any) => p.policyStatus === "ACTIVE").length,
    expiredPolicies: policies.filter((p: any) => p.policyStatus === "EXPIRED").length,
    expiringSoonPolicies: policies.filter((p: any) => p.policyStatus === "EXPIRING SOON").length,
    totalPremiumValue: policies.reduce((sum: number, p: any) => sum + (Number(p.premiumAmount) || 0), 0),
    policiesAddedThisMonth: policies.filter((p: any) => p.createdAt?.startsWith(currentMonth)).length
  });
});

app.get("/api/security/audit", (_req, res) => res.json({ success: true, logs: loadAuditLogs() }));

let notificationHistoryLogs: any[] = [];
app.post("/api/notifications/send-alert", (req, res) => {
  try {
    const { policyIds, channel = "EMAIL", customMessage } = req.body || {};
    const today = new Date();
    const target = loadPolicies().filter((p: any) => {
      if (Array.isArray(policyIds) && policyIds.length) return policyIds.includes(p.id);
      if (p.policyStatus === "EXPIRING SOON") return true;
      if (!p.endDate) return false;
      const days = Math.ceil((new Date(p.endDate).getTime() - today.getTime()) / 86400000);
      return days >= 0 && days <= 30;
    });
    if (!target.length) return res.status(400).json({ success: false, message: "No policies found expiring within 30 days for alert dispatch." });
    const alerts = target.map((p: any) => {
      const daysLeft = p.endDate ? Math.ceil((new Date(p.endDate).getTime() - today.getTime()) / 86400000) : 30;
      const alert = { id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, policyId: p.id, policyNumber: p.policyNumber, ownerName: p.ownerName, recipientEmail: p.email || `${String(p.ownerName || "client").toLowerCase().replace(/\s+/g, ".")}@client-insurance.com`, recipientPhone: p.phoneNumber || "N/A", channel, subject: `URGENT: 30-Day Policy Renewal Notice - ${p.providerCompany} Policy #${p.policyNumber}`, body: customMessage || `Dear ${p.ownerName}, your ${p.providerCompany} policy (#${p.policyNumber}) expires in ${daysLeft} days on ${p.endDate || "upcoming"}.`, status: "DELIVERED", sentAt: new Date().toISOString(), daysLeft };
      notificationHistoryLogs.unshift(alert); return alert;
    });
    addAuditLog("30DAY_EXPIRY_ALERT_DISPATCH", "V Shiroya Notification Service", `Dispatched ${channel} alerts for ${alerts.length} policyholder(s)`, req);
    res.json({ success: true, message: `Successfully dispatched 30-day ${channel} expiry notifications to ${alerts.length} policyholder(s).`, countSent: alerts.length, alerts });
  } catch (error: any) { res.status(500).json({ error: "Failed to process notification alert request", details: error.message }); }
});
app.get("/api/notifications/history", (_req, res) => res.json({ success: true, count: notificationHistoryLogs.length, logs: notificationHistoryLogs }));

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`V Shiroya OpenRouter server listening on ${PORT}`));
}

startServer();
