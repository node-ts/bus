import { relative } from 'node:path'
import * as ts from 'typescript'
import { FieldModel, MessageTypesModel, TypeModel } from './message-types-model'

const PLAIN = 'plain'
type Described = FieldModel | typeof PLAIN

/**
 * Names the generated file declares itself, so classes can't be imported under them
 */
const RESERVED_KEYS = ['MessageTypes', 'messageTypes']

const MAX_NAME_DEPTH = 10

const PLAIN_FLAGS =
  ts.TypeFlags.StringLike |
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.EnumLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void |
  ts.TypeFlags.Never

const NULLISH_FLAGS =
  ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void

const SKIPPED_MEMBER_FLAGS =
  ts.SymbolFlags.Method |
  ts.SymbolFlags.GetAccessor |
  ts.SymbolFlags.SetAccessor |
  ts.SymbolFlags.Prototype

/**
 * Reads the runtime types of messages and workflow state from their TypeScript source, using the
 * type checker. Nothing is emitted or changed.
 */
export class MessageTypeReader {
  private readonly checker: ts.TypeChecker
  private readonly problems: string[] = []
  private readonly messages = new Map<string, ts.Symbol>()
  private readonly messageKeys = new Map<string, string>()
  private readonly types = new Map<string, TypeModel>()
  private readonly keysBySymbol = new Map<ts.Symbol, string>()
  private readonly describedObjects = new Map<ts.Type, Described>()
  private readonly objectsInProgress = new Set<string>()
  private readonly objectsReferencedInProgress = new Set<string>()
  private readonly usedKeys = new Set<string>(RESERVED_KEYS)
  private readonly checkedFiles = new Set<ts.SourceFile>()

  /**
   * @param program the program of the message library
   * @param cwd the directory paths in problems are shown relative to
   */
  constructor(
    private readonly program: ts.Program,
    private readonly cwd: string
  ) {
    this.checker = program.getTypeChecker()
  }

  /**
   * Reads every exported, non-abstract class with a `$name` in the given files
   * @param sourceFiles the files to read messages and workflow state from
   * @returns the types read, and the problems that stop them being generated
   */
  read(sourceFiles: ts.SourceFile[]): {
    model: MessageTypesModel
    problems: string[]
  } {
    for (const sourceFile of sourceFiles) {
      this.checkDiagnostics(sourceFile)
      this.readSourceFile(sourceFile)
    }

    const model: MessageTypesModel = {
      messages: [...this.messageKeys].sort(([a], [b]) => compare(a, b)),
      types: [...this.types.values()].sort((a, b) => compare(a.key, b.key))
    }
    return { model, problems: this.problems }
  }

  private readSourceFile(sourceFile: ts.SourceFile): void {
    const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile)
    if (!moduleSymbol) {
      return
    }
    for (const exported of this.checker.getExportsOfModule(moduleSymbol)) {
      const symbol = this.resolveAlias(exported)
      const declaration = symbol.declarations?.find(ts.isClassDeclaration)
      // Re-exports are skipped, so a class is only read from the entry file that declares it
      if (
        !(symbol.flags & ts.SymbolFlags.Class) ||
        !declaration ||
        declaration.getSourceFile() !== sourceFile
      ) {
        continue
      }
      if (
        ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Abstract
      ) {
        continue
      }
      const instanceType = this.checker.getDeclaredTypeOfSymbol(symbol)
      const nameProperty = this.checker.getPropertyOfType(instanceType, '$name')
      if (!nameProperty) {
        continue
      }
      this.readMessage(symbol, nameProperty)
    }
  }

  private readMessage(symbol: ts.Symbol, nameProperty: ts.Symbol): void {
    const where = this.describeLocation(symbol)
    const name = this.resolveName(nameProperty)
    if (name === undefined) {
      this.problems.push(
        `${where}: its $name can't be worked out without running the code. Set it to a string literal, or to a static property that is one`
      )
      return
    }

    const existing = this.messages.get(name)
    if (existing === symbol) {
      return
    }
    if (existing) {
      this.problems.push(
        `${where}: its $name "${name}" is also used by ${this.describeLocation(existing)}`
      )
      return
    }
    this.messages.set(name, symbol)

    const key = this.classKey(symbol, symbol.getName())
    if (key) {
      this.messageKeys.set(name, key)
    }
  }

  private resolveName(nameProperty: ts.Symbol): string | undefined {
    const type = this.checker.getTypeOfSymbol(nameProperty)
    if (type.isStringLiteral()) {
      return type.value
    }
    for (const declaration of nameProperty.declarations ?? []) {
      if (
        (ts.isPropertyDeclaration(declaration) ||
          ts.isVariableDeclaration(declaration)) &&
        declaration.initializer
      ) {
        return this.evaluateString(declaration.initializer, 0)
      }
    }
    return undefined
  }

  private evaluateString(
    expression: ts.Expression,
    depth: number
  ): string | undefined {
    if (depth > MAX_NAME_DEPTH) {
      return undefined
    }
    if (ts.isStringLiteralLike(expression)) {
      return expression.text
    }
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      return this.evaluateString(expression.expression, depth + 1)
    }
    const type = this.checker.getTypeAtLocation(expression)
    if (type.isStringLiteral()) {
      return type.value
    }
    if (
      ts.isIdentifier(expression) ||
      ts.isPropertyAccessExpression(expression)
    ) {
      const symbol = this.checker.getSymbolAtLocation(expression)
      const declaration = symbol && this.resolveAlias(symbol).valueDeclaration
      if (
        declaration &&
        (ts.isPropertyDeclaration(declaration) ||
          ts.isVariableDeclaration(declaration)) &&
        declaration.initializer
      ) {
        return this.evaluateString(declaration.initializer, depth + 1)
      }
    }
    return undefined
  }

  private classKey(symbol: ts.Symbol, where: string): string | undefined {
    const existing = this.keysBySymbol.get(symbol)
    if (existing) {
      return existing
    }

    const declaration = symbol.declarations!.find(ts.isClassDeclaration)!
    const sourceFile = declaration.getSourceFile()
    if (
      sourceFile.isDeclarationFile ||
      this.program.isSourceFileFromExternalLibrary(sourceFile)
    ) {
      this.problems.push(
        `${where}: ${symbol.getName()} is declared outside the project's source (${this.relativePath(sourceFile.fileName)}), so its class can't be restored. Use a class declared in the project, or a plain object type`
      )
      return undefined
    }
    const exportName = this.exportNameOf(symbol, sourceFile)
    if (!exportName) {
      this.problems.push(
        `${where}: ${symbol.getName()} isn't a named export of ${this.relativePath(sourceFile.fileName)}, so the generated file can't import it. Export it by name`
      )
      return undefined
    }
    const instanceType = this.checker.getDeclaredTypeOfSymbol(
      symbol
    ) as ts.InterfaceType
    if (instanceType.typeParameters?.length) {
      this.problems.push(
        `${where}: ${symbol.getName()} is generic, which isn't supported. Use a class without type parameters`
      )
      return undefined
    }

    this.checkDiagnostics(sourceFile)
    const key = this.uniqueKey(exportName)
    this.keysBySymbol.set(symbol, key)
    const typeModel: TypeModel = {
      key,
      class: { exportName, fileName: sourceFile.fileName },
      fields: []
    }
    this.types.set(key, typeModel)
    typeModel.fields = this.fieldsOf(instanceType, symbol.getName())
    return key
  }

  private fieldsOf(type: ts.Type, owner: string): TypeModel['fields'] {
    const fields: TypeModel['fields'] = []
    for (const property of this.checker.getPropertiesOfType(type)) {
      const name = property.getName()
      if (
        property.flags & SKIPPED_MEMBER_FLAGS ||
        name.startsWith('#') ||
        name.startsWith('__#')
      ) {
        continue
      }
      const declaration =
        property.valueDeclaration ?? property.declarations?.[0]
      const propertyType = declaration
        ? this.checker.getTypeOfSymbolAtLocation(property, declaration)
        : this.checker.getTypeOfSymbol(property)
      const fieldType = this.describe(propertyType, `${owner}.${name}`)
      if (fieldType !== PLAIN) {
        fields.push([name, fieldType])
      }
    }
    return fields
  }

  private describe(type: ts.Type, where: string): Described {
    const flags = type.flags
    if (isErrorType(type)) {
      return this.problem(`${where}: its type can't be resolved`)
    }
    if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
      return PLAIN
    }
    if (flags & ts.TypeFlags.BigIntLike) {
      return 'BigInt'
    }
    if (flags & PLAIN_FLAGS || flags & ts.TypeFlags.NonPrimitive) {
      return PLAIN
    }
    if (flags & ts.TypeFlags.ESSymbolLike) {
      return this.problem(`${where}: symbols can't be sent as JSON`)
    }
    if (flags & ts.TypeFlags.TypeParameter) {
      return this.problem(
        `${where}: generic type parameters aren't supported. Use a concrete type`
      )
    }
    if (type.isUnion()) {
      return this.describeUnion(type, where)
    }
    if (type.isIntersection()) {
      // A branded primitive such as `string & { __brand: 'Id' }` is sent as the primitive
      const primitive = type.types.find(
        member => member.flags & (PLAIN_FLAGS | ts.TypeFlags.BigIntLike)
      )
      return primitive
        ? this.describe(primitive, where)
        : this.describeObjectType(type, where)
    }
    if (flags & ts.TypeFlags.Object) {
      return this.describeObject(type as ts.ObjectType, where)
    }
    return this.problem(
      `${where}: ${this.checker.typeToString(type)} isn't supported`
    )
  }

  private describeUnion(type: ts.UnionType, where: string): Described {
    const members = type.types.filter(member => !(member.flags & NULLISH_FLAGS))
    const described = members.map(member => this.describe(member, where))
    const restored = described.filter(member => member !== PLAIN)
    if (!restored.length) {
      return PLAIN
    }
    const distinct = new Set(restored.map(member => JSON.stringify(member)))
    if (restored.length === described.length && distinct.size === 1) {
      return restored[0]
    }
    return this.problem(
      `${where}: ${this.checker.typeToString(type)} mixes types that are restored differently, and they can't be told apart once they're JSON. Use one type, or a separate field for each`
    )
  }

  private describeObject(type: ts.ObjectType, where: string): Described {
    if (this.checker.isArrayType(type)) {
      const [item] = this.checker.getTypeArguments(type as ts.TypeReference)
      const described = this.describe(item, `${where}[]`)
      return described === PLAIN ? PLAIN : { array: described }
    }
    if (this.checker.isTupleType(type)) {
      const items = this.checker.getTypeArguments(type as ts.TypeReference)
      const restored = items
        .map((item, index) => this.describe(item, `${where}[${index}]`))
        .some(item => item !== PLAIN)
      return restored
        ? this.problem(
            `${where}: tuples with values that need restoring aren't supported. Use an array or a class`
          )
        : PLAIN
    }

    const symbol = type.getSymbol()
    // Only named built-ins such as Date and Map. Utility types such as Record are object types.
    if (
      symbol &&
      symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class) &&
      this.isFromDefaultLibrary(symbol)
    ) {
      return this.describeBuiltIn(type, symbol.getName(), where)
    }
    if (
      this.checker.getSignaturesOfType(type, ts.SignatureKind.Call).length ||
      this.checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length
    ) {
      return this.problem(`${where}: functions can't be sent as JSON`)
    }
    if (symbol && symbol.flags & ts.SymbolFlags.Class) {
      if ((type as ts.TypeReference).typeArguments?.length) {
        return this.problem(
          `${where}: ${this.checker.typeToString(type)} is a generic class, which isn't supported. Use a class without type parameters`
        )
      }
      const key = this.classKey(symbol, where)
      return key ? { type: key } : PLAIN
    }
    return this.describeObjectType(type, where)
  }

  private describeBuiltIn(
    type: ts.ObjectType,
    name: string,
    where: string
  ): Described {
    const typeArguments =
      (type as ts.TypeReference).target !== undefined
        ? this.checker.getTypeArguments(type as ts.TypeReference)
        : []
    switch (name) {
      case 'Date':
        return 'Date'
      case 'Object':
        return PLAIN
      case 'Set':
      case 'ReadonlySet': {
        const item = this.describe(typeArguments[0], `${where}[]`)
        return { set: item }
      }
      case 'Map':
      case 'ReadonlyMap': {
        const [keyType, valueType] = typeArguments
        const keys = this.describeMapKey(keyType, where)
        if (keys === undefined) {
          return PLAIN
        }
        const value = this.describe(valueType, `${where}[value]`)
        return keys === 'number' ? { map: value, keys } : { map: value }
      }
      default:
        return this.problem(
          `${where}: ${this.checker.typeToString(type)} isn't supported. Supported built-in types are Date, Map, Set and bigint`
        )
    }
  }

  private describeMapKey(
    keyType: ts.Type,
    where: string
  ): 'string' | 'number' | undefined {
    const members = keyType.isUnion() ? keyType.types : [keyType]
    if (members.every(member => member.flags & ts.TypeFlags.StringLike)) {
      return 'string'
    }
    if (members.every(member => member.flags & ts.TypeFlags.NumberLike)) {
      return 'number'
    }
    this.problem(
      `${where}: Map keys must be strings or numbers to be sent as JSON, not ${this.checker.typeToString(keyType)}`
    )
    return undefined
  }

  private describeObjectType(type: ts.Type, where: string): Described {
    const known = this.describedObjects.get(type)
    if (known !== undefined) {
      if (typeof known === 'object' && 'type' in known) {
        if (this.objectsInProgress.has(known.type)) {
          this.objectsReferencedInProgress.add(known.type)
        }
      }
      return known
    }

    const properties = this.checker.getPropertiesOfType(type)
    const method = properties.find(
      property => property.flags & ts.SymbolFlags.Method
    )
    if (method) {
      return this.problem(
        `${where}: ${this.checker.typeToString(type)} has a method (${method.getName()}), which can't be sent as JSON. Use a class, or an object type without methods`
      )
    }

    const indexInfos = this.checker.getIndexInfosOfType(type)
    const indexed = indexInfos.map(info =>
      this.describe(info.type, `${where}[key]`)
    )
    const restoredIndex = indexed.find(item => item !== PLAIN)
    if (!properties.length) {
      return restoredIndex === undefined ? PLAIN : { record: restoredIndex }
    }
    if (restoredIndex !== undefined) {
      return this.problem(
        `${where}: object types that have both named properties and an index signature that needs restoring aren't supported`
      )
    }

    const alias = type.aliasSymbol
    const symbol = type.getSymbol()
    const named =
      alias && !type.aliasTypeArguments?.length
        ? alias
        : symbol &&
            symbol.flags & ts.SymbolFlags.Interface &&
            !(type as ts.TypeReference).typeArguments?.length
          ? symbol
          : undefined
    const key = this.uniqueKey(named ? named.getName() : where)
    const reference: Described = { type: key }
    this.describedObjects.set(type, reference)
    this.objectsInProgress.add(key)
    const typeModel: TypeModel = { key, fields: [] }
    this.types.set(key, typeModel)

    typeModel.fields = this.fieldsOf(type, named ? named.getName() : where)

    this.objectsInProgress.delete(key)
    if (
      !typeModel.fields.length &&
      !this.objectsReferencedInProgress.has(key)
    ) {
      this.types.delete(key)
      this.usedKeys.delete(key)
      this.describedObjects.set(type, PLAIN)
      return PLAIN
    }
    return reference
  }

  private exportNameOf(
    symbol: ts.Symbol,
    sourceFile: ts.SourceFile
  ): string | undefined {
    const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile)
    if (!moduleSymbol) {
      return undefined
    }
    const exported = this.checker
      .getExportsOfModule(moduleSymbol)
      .find(candidate => this.resolveAlias(candidate) === symbol)
    const name = exported?.getName()
    return name === 'default' ? undefined : name
  }

  private checkDiagnostics(sourceFile: ts.SourceFile): void {
    if (this.checkedFiles.has(sourceFile)) {
      return
    }
    this.checkedFiles.add(sourceFile)
    const diagnostics = [
      ...this.program.getSyntacticDiagnostics(sourceFile),
      ...this.program.getSemanticDiagnostics(sourceFile)
    ].filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
    for (const diagnostic of diagnostics) {
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        '\n'
      )
      const position =
        diagnostic.start !== undefined
          ? sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
          : undefined
      this.problems.push(
        `${this.relativePath(sourceFile.fileName)}${position ? `:${position.line + 1}:${position.character + 1}` : ''}: ${message}`
      )
    }
  }

  private isFromDefaultLibrary(symbol: ts.Symbol): boolean {
    return (symbol.declarations ?? []).some(declaration =>
      this.program.isSourceFileDefaultLibrary(declaration.getSourceFile())
    )
  }

  private resolveAlias(symbol: ts.Symbol): ts.Symbol {
    return symbol.flags & ts.SymbolFlags.Alias
      ? this.checker.getAliasedSymbol(symbol)
      : symbol
  }

  private describeLocation(symbol: ts.Symbol): string {
    const declaration = symbol.declarations?.[0]
    return declaration
      ? `${symbol.getName()} (${this.relativePath(declaration.getSourceFile().fileName)})`
      : symbol.getName()
  }

  private relativePath(fileName: string): string {
    return relative(this.cwd, fileName).split('\\').join('/')
  }

  private uniqueKey(base: string): string {
    let key = base
    for (let suffix = 2; this.usedKeys.has(key); suffix++) {
      key = `${base}_${suffix}`
    }
    this.usedKeys.add(key)
    return key
  }

  private problem(problem: string): typeof PLAIN {
    this.problems.push(problem)
    return PLAIN
  }
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The checker gives a type it can't resolve, such as one from a missing import, the intrinsic `error` type
 */
const isErrorType = (type: ts.Type): boolean =>
  (type as { intrinsicName?: string }).intrinsicName === 'error'
