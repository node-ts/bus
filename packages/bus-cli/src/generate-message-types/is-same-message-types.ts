import type * as TS from 'typescript'

type Value =
  string | number | boolean | null | Value[] | { [key: string]: Value }

const UNKNOWN = '\u0000unknown'

/**
 * Reads the `messageTypes` export of a generated file into a value that doesn't depend on how the
 * file is formatted: object keys are sorted, and identifiers are replaced by what they import.
 */
const readMessageTypes = (ts: typeof TS, source: string): Value | undefined => {
  const sourceFile = ts.createSourceFile(
    'message-types.ts',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  )
  const imports = new Map<string, string>()
  let initializer: TS.Expression | undefined

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const importedName = (element.propertyName ?? element.name).text
          imports.set(
            element.name.text,
            `${statement.moduleSpecifier.text}#${importedName}`
          )
        }
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === 'messageTypes'
        ) {
          initializer = declaration.initializer
        }
      }
    }
  }

  const toValue = (expression: TS.Expression): Value => {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      return toValue(expression.expression)
    }
    if (ts.isStringLiteralLike(expression)) {
      return expression.text
    }
    if (ts.isNumericLiteral(expression)) {
      return Number(expression.text)
    }
    if (ts.isIdentifier(expression)) {
      return `\u0000ref:${imports.get(expression.text) ?? expression.text}`
    }
    if (ts.isArrayLiteralExpression(expression)) {
      return expression.elements.map(toValue)
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const entries: [string, Value][] = []
      for (const property of expression.properties) {
        if (ts.isPropertyAssignment(property)) {
          const name = property.name
          const key =
            ts.isIdentifier(name) || ts.isStringLiteralLike(name)
              ? name.text
              : UNKNOWN
          entries.push([key, toValue(property.initializer)])
        } else if (ts.isShorthandPropertyAssignment(property)) {
          entries.push([property.name.text, toValue(property.name)])
        } else {
          entries.push([UNKNOWN, UNKNOWN])
        }
      }
      return Object.fromEntries(
        entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      )
    }
    if (expression.kind === ts.SyntaxKind.TrueKeyword) {
      return true
    }
    if (expression.kind === ts.SyntaxKind.FalseKeyword) {
      return false
    }
    if (expression.kind === ts.SyntaxKind.NullKeyword) {
      return null
    }
    return UNKNOWN
  }

  return initializer && toValue(initializer)
}

/**
 * Checks whether two generated files declare the same message types, ignoring formatting,
 * comments, quote style and the order of imports and object keys. This lets a formatter or
 * linter reformat the generated file without `--check` failing.
 * @param ts the TypeScript compiler API, used to parse both files
 * @param existing the source of the file on disk
 * @param generated the source that would be generated now
 * @returns true if both declare the same message types
 */
export const isSameMessageTypes = (
  ts: typeof TS,
  existing: string,
  generated: string
): boolean => {
  const existingValue = readMessageTypes(ts, existing)
  return (
    existingValue !== undefined &&
    JSON.stringify(existingValue) ===
      JSON.stringify(readMessageTypes(ts, generated))
  )
}
