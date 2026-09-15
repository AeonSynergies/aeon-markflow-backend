import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { buildOpenApiSpec } from '../src/config/openapi';

/**
 * Writes the generated OpenAPI spec to openapi/markflow-backend.json — a committed artifact
 * the aeon-markflow frontend repo can pull from (this session has no write access to that
 * repo, so a checked-in file here is the handoff point until a shared package/CI job exists).
 */
function main(): void {
  const outDir = path.resolve(__dirname, '../openapi');
  mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, 'markflow-backend.json');
  const spec = buildOpenApiSpec();
  writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log(`Wrote OpenAPI spec to ${outPath}`);
}

main();
