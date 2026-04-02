import sql from 'mssql';

const cfg = {
  server: process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  options: { encrypt: true, trustServerCertificate: false },
  authentication: { type: 'azure-active-directory-default', options: {} },
};

const required = [
  'responses_endpoint',
  'activity_endpoint',
  'foundry_project',
  'foundry_agent_name',
  'foundry_agent_version',
  'security_mode',
  'migration_status',
];

const pool = await sql.connect(cfg);
const columns = await pool.request().query("SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ai_agents') ORDER BY name");
const existing = new Set(columns.recordset.map((r) => r.name));
const missing = required.filter((name) => !existing.has(name));
console.log('Missing columns:', missing);

const sample = await pool.request().query("SELECT TOP (1) id, name, responses_endpoint, security_mode, migration_status FROM ai_agents ORDER BY updated_at DESC");
console.log('Sample agent:', sample.recordset[0] ?? null);

await pool.close();
