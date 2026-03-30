import sql from 'mssql';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  const server = required('AZURE_SQL_SERVER');
  const database = required('AZURE_SQL_DATABASE');
  const webAppPrincipalName = required('WEBAPP_MI_NAME');

  const config = {
    server,
    database,
    authentication: {
      type: 'azure-active-directory-default',
      options: {},
    },
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  };

  const batchSql = `
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${webAppPrincipalName}')
BEGIN
  CREATE USER [${webAppPrincipalName}] FROM EXTERNAL PROVIDER;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.database_role_members drm
  JOIN sys.database_principals r ON drm.role_principal_id = r.principal_id
  JOIN sys.database_principals m ON drm.member_principal_id = m.principal_id
  WHERE r.name = 'db_datareader' AND m.name = '${webAppPrincipalName}'
)
BEGIN
  ALTER ROLE db_datareader ADD MEMBER [${webAppPrincipalName}];
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.database_role_members drm
  JOIN sys.database_principals r ON drm.role_principal_id = r.principal_id
  JOIN sys.database_principals m ON drm.member_principal_id = m.principal_id
  WHERE r.name = 'db_datawriter' AND m.name = '${webAppPrincipalName}'
)
BEGIN
  ALTER ROLE db_datawriter ADD MEMBER [${webAppPrincipalName}];
END;
`;

  const pool = await sql.connect(config);
  try {
    await pool.request().batch(batchSql);
    console.log('Managed identity permissions ensured successfully.');
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
