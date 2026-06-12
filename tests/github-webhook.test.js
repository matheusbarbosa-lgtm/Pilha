/**
 * Testes do webhook de integração GitHub.
 *
 * Valida:
 *  - Assinatura HMAC-SHA256 correta → 200 e evento salvo.
 *  - Assinatura inválida → 401.
 *  - Assinatura ausente → 401.
 *  - Dedup por X-GitHub-Delivery → não duplica.
 */
const http = require("http");
const path = require("path");
const crypto = require("crypto");

const SECRET = "test_webhook_secret_123";

function sign(raw) {
  return "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
}

describe("Webhook GitHub", () => {
  let request;
  let db;

  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    const { initDb, initEvalDb } = require(path.join(__dirname, "..", "db"));
    const { createApp } = require(path.join(__dirname, "..", "server"));
    const supertest = require("supertest");

    const [d, evalDb] = await Promise.all([initDb(":memory:"), initEvalDb(":memory:")]);
    db = d;
    const { app } = await createApp(db, evalDb);
    request = supertest(http.createServer(app));
  });

  test("assinatura válida → 200 e evento salvo", async () => {
    const payload = JSON.stringify({ action: "opened", repository: { full_name: "acme/demo" } });
    const res = await request
      .post("/api/integrations/github/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "deliv-aaa")
      .set("X-Hub-Signature-256", sign(payload))
      .send(payload);

    expect(res.status).toBe(200);
    const row = await db.get("SELECT * FROM github_webhook_events WHERE github_delivery_id = ?", ["deliv-aaa"]);
    expect(row).toBeTruthy();
    expect(row.event_type).toBe("pull_request");
    expect(row.action).toBe("opened");
    expect(row.repository_full_name).toBe("acme/demo");
  });

  test("assinatura inválida → 401", async () => {
    const payload = JSON.stringify({ action: "created" });
    const res = await request
      .post("/api/integrations/github/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-GitHub-Delivery", "deliv-bad")
      .set("X-Hub-Signature-256", "sha256=" + "0".repeat(64))
      .send(payload);

    expect(res.status).toBe(401);
    const row = await db.get("SELECT * FROM github_webhook_events WHERE github_delivery_id = ?", ["deliv-bad"]);
    expect(row).toBeFalsy();
  });

  test("assinatura ausente → 401", async () => {
    const payload = JSON.stringify({ action: "created" });
    const res = await request
      .post("/api/integrations/github/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-GitHub-Delivery", "deliv-nosig")
      .send(payload);

    expect(res.status).toBe(401);
  });

  test("delivery duplicado não é inserido duas vezes", async () => {
    const payload = JSON.stringify({ action: "completed", repository: { full_name: "acme/demo" } });
    const headers = (r) => r
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "workflow_run")
      .set("X-GitHub-Delivery", "deliv-dup")
      .set("X-Hub-Signature-256", sign(payload));

    const r1 = await headers(request.post("/api/integrations/github/webhook")).send(payload);
    const r2 = await headers(request.post("/api/integrations/github/webhook")).send(payload);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.body.duplicate).toBe(true);
    const rows = await db.all("SELECT id FROM github_webhook_events WHERE github_delivery_id = ?", ["deliv-dup"]);
    expect(rows.length).toBe(1);
  });

  test("evento installation cria integração e repositórios", async () => {
    const payload = JSON.stringify({
      action: "created",
      installation: { id: 555, account: { login: "acme-org", id: 42 } },
      repositories: [{ id: 1001, full_name: "acme-org/projeto", private: false }],
    });
    const res = await request
      .post("/api/integrations/github/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "installation")
      .set("X-GitHub-Delivery", "deliv-install")
      .set("X-Hub-Signature-256", sign(payload))
      .send(payload);

    expect(res.status).toBe(200);
    const integ = await db.get("SELECT * FROM github_integrations WHERE installation_id = ?", [555]);
    expect(integ).toBeTruthy();
    expect(integ.github_account_login).toBe("acme-org");
    expect(integ.status).toBe("active");
    const repo = await db.get("SELECT * FROM github_repositories WHERE full_name = ?", ["acme-org/projeto"]);
    expect(repo).toBeTruthy();
    expect(repo.integration_id).toBe(integ.id);
  });
});
