import { createRequire } from 'node:module'
import { join } from 'node:path'
import type * as TS from 'typescript'
import { TypeScriptNotFound } from './error'

/**
 * Loads the project's own copy of TypeScript, so the project is read with the compiler version and
 * defaults its build uses
 * @param cwd the directory to resolve `typescript` from
 * @returns the TypeScript compiler API
 * @throws TypeScriptNotFound if the project doesn't have TypeScript installed
 */
export const loadTypeScript = (cwd: string): typeof TS => {
  const projectRequire = createRequire(join(cwd, 'package.json'))
  let path: string
  try {
    path = projectRequire.resolve('typescript')
  } catch {
    throw new TypeScriptNotFound(cwd)
  }
  return projectRequire(path) as typeof TS
}
