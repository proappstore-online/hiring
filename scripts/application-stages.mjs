// Compile the UI's static transition map into the registered SQL predicate.
// Run with --write after editing the map; CI tests reject manifest drift.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
export const transitions = JSON.parse(readFileSync(new URL('../web/src/application-stages.json', import.meta.url)))
export const transitionPredicate = '(' + Object.entries(transitions).filter(([, next]) => next.length).map(([prior, next]) => {
  if (![prior, ...next].every(stage => /^[a-z_]+$/.test(stage))) throw Error('Invalid stage identifier')
  return `(COALESCE(stage_extension,stage)='${prior}' AND :to_stage IN (${next.map(stage => `'${stage}'`).join(',')}))`
}).join(' OR ') + ')'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL('../mcp.json', import.meta.url)
  const manifest = JSON.parse(readFileSync(path))
  const action = manifest.tools.find(tool => tool.name === 'change_application_stage')
  if (process.argv.includes('--write')) {
    for (let index = 0; index < 2; index++) action.statements[index] = action.statements[index].replace(/AND \(\(COALESCE\(stage_extension,stage\).*? AND length\(trim\(:reason\)\)>0/, `AND ${transitionPredicate} AND length(trim(:reason))>0`)
    writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
  }
  if (!action.statements.slice(0, 2).every(statement => statement.includes(`AND ${transitionPredicate} AND`))) throw Error('Stage contract drift; run node scripts/application-stages.mjs --write')
}
