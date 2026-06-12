/**
 * Testes das funções puras das estatísticas de contribuição GitHub.
 * (As chamadas reais à API do GitHub são testadas no staging.)
 */
const path = require("path");
const { normalizeGithubPrivateKey, aggregateCommitDetails, currentMonthRange } = require(path.join(__dirname, "..", "server"));

describe("normalizeGithubPrivateKey", () => {
  const PEM = "-----BEGIN RSA PRIVATE KEY-----\nABCDEF\nGHIJKL\n-----END RSA PRIVATE KEY-----";

  test("PEM puro passa inalterado", () => {
    expect(normalizeGithubPrivateKey(PEM)).toBe(PEM);
  });

  test("PEM com \\n literal vira quebras reais", () => {
    const literal = PEM.replace(/\n/g, "\\n");
    expect(normalizeGithubPrivateKey(literal)).toBe(PEM);
  });

  test("base64 é decodificado para PEM", () => {
    const b64 = Buffer.from(PEM, "utf8").toString("base64");
    expect(normalizeGithubPrivateKey(b64)).toBe(PEM);
  });

  test("vazio retorna vazio", () => {
    expect(normalizeGithubPrivateKey("")).toBe("");
    expect(normalizeGithubPrivateKey(null)).toBe("");
  });
});

describe("aggregateCommitDetails", () => {
  test("soma linhas e conta arquivos distintos", () => {
    const commits = [
      { stats: { additions: 10, deletions: 2 }, files: [{ filename: "a.js" }, { filename: "b.js" }] },
      { stats: { additions: 5, deletions: 3 }, files: [{ filename: "a.js" }, { filename: "c.js" }] },
    ];
    const r = aggregateCommitDetails(commits);
    expect(r.commits).toBe(2);
    expect(r.linesAdded).toBe(15);
    expect(r.linesRemoved).toBe(5);
    expect(r.filesChanged).toBe(3); // a.js, b.js, c.js
  });

  test("lida com commits sem stats/files", () => {
    const r = aggregateCommitDetails([{}, { files: [] }]);
    expect(r.commits).toBe(2);
    expect(r.linesAdded).toBe(0);
    expect(r.linesRemoved).toBe(0);
    expect(r.filesChanged).toBe(0);
  });

  test("array vazio", () => {
    const r = aggregateCommitDetails([]);
    expect(r).toEqual({ commits: 0, linesAdded: 0, linesRemoved: 0, filesChanged: 0 });
  });
});

describe("currentMonthRange", () => {
  test("period no formato YYYY-MM e since no início do mês (UTC)", () => {
    const { since, period } = currentMonthRange();
    expect(period).toMatch(/^\d{4}-\d{2}$/);
    const d = new Date(since);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(0);
    expect(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`).toBe(period);
  });
});
