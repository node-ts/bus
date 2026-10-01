import { relative } from 'node:path'
import type * as TS from 'typescript'
import { FieldModel, MessageTypesModel, TypeModel } from './message-types-model'

const PLAIN = 'plain'
type Described = FieldModel | typeof PLAIN

const MAX_NAME_DEPTH = 10

/**
 * A message read so far: the declaration it was read from and its type
 */
interface ReadMessage {
  symbol: TS.Symbol
  type: TS.Type
  /**
   * Whether it was declared with a type only, as an interface or type alias, rather than as a class or
   * with `defineCommand` or `defineEvent`
   */
  typeOnly: boolean
}

/**
 * What `defineCommand` and `defineEvent` return: a function with a static `NAME` that creates messages
 */
interface Definition {
  nameProperty: TS.Symbol
  messageType: TS.Type
}

/**
 * Where a value is: how problems describe it, and the key an anonymous object type there gets
 */
interface At {
  where: string
  key: string
}

const child = (at: At, suffix: string): At => ({
  where: `${at.where}${suffix}`,
  key: `${at.key}${suffix}`
})

/**
 * Diagnostics that mean a type or module can't be resolved, so the generated types would be wrong.
 * Other semantic errors, such as strictness checks, don't change the types and are only warnings.
 */
const BLOCKING_DIAGNOSTIC_CODES = new Set([
  2304, // Cannot find name
  2305, // Module has no exported member
  2306, // File is not a module
  2307, // Cannot find module
  2503, // Cannot find namespace
  2552, // Cannot find name. Did you mean ...?
  2614, // Module has no exported member. Did you mean to use a default import?
  2694, // Namespace has no exported member
  2724, // Module has no exported member. Did you mean ...?
  2792, // Cannot find module. Did you mean to set moduleResolution?
  2834, // Relative imports need an extension
  2835 // Relative imports need an extension. Did you mean ...?
])

/**
 * Where the reader is and what it reads
 */
export interface MessageTypeReaderOptions {
  /**
   * The project's own copy of the TypeScript compiler
   */
  ts: typeof TS
  /**
   * The program of the message library
   */
  program: TS.Program
  /**
   * The directory paths in problems and warnings are shown relative to
   */
  cwd: string
  /**
   * The directory that type keys are relative to, usually the package root
   */
  keyRoot: string
  /**
   * Prepended to every type key, usually the package name, so two libraries' keys can't collide
   */
  keyPrefix: string
}

/**
 * Reads the runtime types of messages and workflow state from their TypeScript source, using the
 * type checker. Nothing is emitted or changed.
 *
 * Every class and named object type is keyed by the module that declares it plus its name, so two
 * declarations with the same name never share an entry.
 */
export class MessageTypeReader {
  private readonly ts: typeof TS
  private readonly program: TS.Program
  private readonly checker: TS.TypeChecker
  private readonly problems: string[] = []
  private readonly warnings: string[] = []
  private readonly messages = new Map<string, ReadMessage>()
  private readonly messageKeys = new Map<string, string>()
  private readonly types = new Map<string, TypeModel>()
  private readonly keysBySymbol = new Map<TS.Symbol, string>()
  private readonly describedObjects = new Map<TS.Type, Described>()
  private readonly objectsInProgress = new Set<string>()
  private readonly objectsReferencedInProgress = new Set<string>()
  private readonly usedKeys = new Set<string>()
  private readonly checkedFiles = new Set<TS.SourceFile>()
  private entryFiles = new Set<TS.SourceFile>()
  /**
   * Interfaces and type aliases, read once every class and definition has been, so a type that only
   * describes one of them, such as `type PlaceOrder = MessageOf<typeof PlaceOrder>`, isn't read twice
   */
  private readonly objectTypeCandidates: TS.Symbol[] = []
  /**
   * Classes whose `$name` is declared but not set, which are warned about unless a message uses them
   */
  private readonly unsetNameClasses: TS.Symbol[] = []
  private readonly reExports: { symbol: TS.Symbol; from: TS.SourceFile }[] = []
  private readonly plainFlags: number
  private readonly nullishFlags: number
  private readonly skippedMemberFlags: number

  constructor(private readonly options: MessageTypeReaderOptions) {
    const { ts, program } = options
    this.ts = ts
    this.program = program
    this.checker = program.getTypeChecker()
    this.plainFlags =
      ts.TypeFlags.StringLike |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.EnumLike |
      ts.TypeFlags.Null |
      ts.TypeFlags.Undefined |
      ts.TypeFlags.Void |
      ts.TypeFlags.Never
    this.nullishFlags =
      ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void
    this.skippedMemberFlags =
      ts.SymbolFlags.Method |
      ts.SymbolFlags.GetAccessor |
      ts.SymbolFlags.SetAccessor |
      ts.SymbolFlags.Prototype
  }

  /**
   * Reads every message and workflow state declared in the given files: exported, non-abstract classes
   * with a `$name`, exported `defineCommand` and `defineEvent` definitions, and exported interfaces and
   * type aliases with a string literal `$name`. Each declaration with a `$name` that isn't read is
   * warned about, saying why.
   * @param sourceFiles the files to read messages and workflow state from
   * @returns the types read, the problems that stop them being generated, and warnings that don't
   */
  read(sourceFiles: TS.SourceFile[]): {
    model: MessageTypesModel
    problems: string[]
    warnings: string[]
  } {
    this.entryFiles = new Set(sourceFiles)
    for (const sourceFile of sourceFiles) {
      this.checkDiagnostics(sourceFile)
      this.readSourceFile(sourceFile)
    }
    for (const symbol of this.objectTypeCandidates) {
      this.readObjectTypeMessage(symbol)
    }
    this.warnAboutSkipped()

    const model: MessageTypesModel = {
      messages: [...this.messageKeys].sort(([a], [b]) => compare(a, b)),
      types: [...this.types.values()].sort((a, b) => compare(a.key, b.key))
    }
    return { model, problems: this.problems, warnings: this.warnings }
  }

  private readSourceFile(sourceFile: TS.SourceFile): void {
    const { ts } = this
    const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile)
    if (!moduleSymbol) {
      return
    }
    const exported = new Set<TS.Symbol>()
    for (const exportedSymbol of this.checker.getExportsOfModule(
      moduleSymbol
    )) {
      const symbol = this.resolveAlias(exportedSymbol)
      exported.add(symbol)
      // Re-exports are skipped, so a message is only read from the entry file that declares it
      if (
        !symbol.declarations?.some(
          declaration => declaration.getSourceFile() === sourceFile
        )
      ) {
        this.reExports.push({ symbol, from: sourceFile })
        continue
      }
      if (symbol.flags & ts.SymbolFlags.Class) {
        this.readClass(symbol)
        continue
      }
      // A variable, or the expression of an `export default`
      if (symbol.flags & ts.SymbolFlags.Value) {
        const definition = this.definitionOf(symbol)
        if (definition) {
          this.readDefinition(symbol, definition)
        } else {
          this.warnAboutGroupedDefinitions(symbol)
        }
      }
      if (
        symbol.flags &
        (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)
      ) {
        this.objectTypeCandidates.push(symbol)
      }
    }

    for (const symbol of this.declaredSymbols(sourceFile)) {
      if (!exported.has(symbol) && this.messageNameOf(symbol) !== undefined) {
        this.warnings.push(
          `${this.describeLocation(symbol)}: it has a $name but isn't exported, so it isn't read as a message. Export it by name`
        )
      }
    }
  }

  private readClass(symbol: TS.Symbol): void {
    const { ts } = this
    const declaration = symbol.declarations?.find(ts.isClassDeclaration)
    const nameProperty = this.checker.getPropertyOfType(
      this.checker.getDeclaredTypeOfSymbol(symbol),
      '$name'
    )
    if (!declaration || !nameProperty) {
      return
    }
    if (isAbstract(ts, declaration)) {
      // An abstract base whose $name is only declared is skipped quietly
      const name = this.resolveName(nameProperty)
      if (name !== undefined && name !== 'not-set') {
        this.warnings.push(
          `${this.describeLocation(symbol)}: it's abstract, so it isn't read as a message. Make it concrete, or leave its $name to the classes that extend it`
        )
      }
      return
    }
    this.readMessage(symbol, nameProperty)
  }

  private readMessage(symbol: TS.Symbol, nameProperty: TS.Symbol): void {
    const where = this.describeLocation(symbol)
    const name = this.resolveName(nameProperty)
    // A `$name` that is only declared, e.g. a data field of a nested class, doesn't make it a message
    if (name === 'not-set') {
      this.unsetNameClasses.push(symbol)
      return
    }
    if (name === undefined) {
      this.problems.push(
        `${where}: its $name can't be worked out without running the code. Set it to a string literal, or to a static property that is one`
      )
      return
    }
    this.checkStaticName(symbol, name)
    this.addMessage(
      name,
      {
        symbol,
        type: this.checker.getDeclaredTypeOfSymbol(symbol),
        typeOnly: false
      },
      () => this.classKey(symbol, symbol.getName())
    )
  }

  /**
   * The bus routes a message class by its static `NAME`, so one that isn't the class' `$name`, or that's
   * inherited from the class it extends, sends its messages to the wrong handlers or is rejected by the bus
   */
  private checkStaticName(symbol: TS.Symbol, name: string): void {
    const { ts } = this
    const staticNameProperty = this.checker.getPropertyOfType(
      this.checker.getTypeOfSymbol(symbol),
      'NAME'
    )
    if (!staticNameProperty) {
      return
    }
    const where = this.describeLocation(symbol)
    const classDeclaration = symbol.declarations?.find(ts.isClassDeclaration)
    const isOwn = (staticNameProperty.declarations ?? []).some(
      declaration => declaration.parent === classDeclaration
    )
    const staticName = this.resolveName(staticNameProperty)
    if (typeof staticName === 'string' && staticName !== 'not-set') {
      if (staticName !== name) {
        this.problems.push(
          `${where}: its static NAME "${staticName}"${isOwn ? '' : ', which it inherits,'} isn't its $name "${name}", so the bus would route it as "${staticName}". Give it its own static NAME and set $name to it`
        )
        return
      }
    }
    if (!isOwn) {
      this.warnings.push(
        `${where}: it inherits its static NAME, so the bus rejects it as a message with MessageNameInherited. Give it its own static NAME and set $name to it`
      )
    }
  }

  /**
   * Reads a message declared with `defineCommand` or `defineEvent`. It has no class, so it's restored
   * as a plain object.
   */
  private readDefinition(symbol: TS.Symbol, definition: Definition): void {
    const nameType = this.checker.getTypeOfSymbol(definition.nameProperty)
    if (!nameType.isStringLiteral()) {
      this.problems.push(
        `${this.describeLocation(symbol)}: its $name can't be worked out without running the code. Pass a string literal to defineCommand or defineEvent`
      )
      return
    }
    this.addMessage(
      nameType.value,
      { symbol, type: definition.messageType, typeOnly: false },
      () => this.objectMessageKey(symbol, definition.messageType)
    )
  }

  /**
   * Reads an interface or type alias with a string literal `$name`, unless it describes a message that's
   * already been read
   */
  private readObjectTypeMessage(symbol: TS.Symbol): void {
    const type = this.objectTypeOf(symbol)
    const nameProperty = type && this.checker.getPropertyOfType(type, '$name')
    if (!type || !nameProperty) {
      return
    }
    const where = this.describeLocation(symbol)
    const nameType = this.checker.getTypeOfSymbol(nameProperty)
    if (!nameType.isStringLiteral()) {
      // A `$name` field of a type nested in a message is data
      if (!this.describedObjects.has(type)) {
        this.warnings.push(
          `${where}: its $name is ${this.checker.typeToString(nameType)}, not a string literal, so it isn't read as a message. Give it a literal $name, e.g. \`$name: '@my-org/orders/place-order'\``
        )
      }
      return
    }
    const name = nameType.value
    const existing = this.messages.get(name)
    if (existing) {
      // e.g. `type PlaceOrder = MessageOf<typeof PlaceOrder>`, or an interface a definition is declared from
      if (existing.symbol === symbol || existing.type === type) {
        return
      }
      if (existing.typeOnly) {
        this.problems.push(
          `${where}: its $name "${name}" is also used by ${this.describeLocation(existing.symbol)}`
        )
      } else {
        this.warnings.push(
          `${where}: its $name "${name}" is also used by ${this.describeLocation(existing.symbol)}, which is read instead`
        )
      }
      return
    }
    if (this.isGeneric(symbol)) {
      this.warnings.push(
        `${where}: it's generic, so it isn't read as a message. Use a type without type parameters`
      )
      return
    }
    this.addMessage(name, { symbol, type, typeOnly: true }, () =>
      this.objectMessageKey(symbol, type)
    )
  }

  private addMessage(
    name: string,
    message: ReadMessage,
    readKey: () => string | undefined
  ): void {
    const existing = this.messages.get(name)
    if (existing?.symbol === message.symbol) {
      return
    }
    if (existing) {
      this.problems.push(
        `${this.describeLocation(message.symbol)}: its $name "${name}" is also used by ${this.describeLocation(existing.symbol)}`
      )
      return
    }
    this.messages.set(name, message)

    const key = readKey()
    if (key) {
      this.messageKeys.set(name, key)
    }
  }

  /**
   * The key of a message without a class: a definition, interface or type alias. Unlike other object
   * types, it gets an entry even when none of its fields need restoring, so the bus knows it's registered.
   */
  private objectMessageKey(symbol: TS.Symbol, type: TS.Type): string {
    // Already read as a field of another message
    const known = this.describedObjects.get(type)
    if (typeof known === 'object' && 'type' in known) {
      return known.type
    }
    const sourceFile = symbol.declarations![0].getSourceFile()
    const key = this.uniqueKey(this.declarationKey(symbol, sourceFile))
    this.describedObjects.set(type, { type: key })
    const typeModel: TypeModel = { key, fields: [] }
    this.types.set(key, typeModel)
    typeModel.fields = this.fieldsOf(type, symbol.getName(), key)
    return key
  }

  /**
   * Recognises what `defineCommand` and `defineEvent` return by its shape, a function with a `NAME` that
   * returns a message, so it's found however they're imported
   */
  private definitionOf(symbol: TS.Symbol): Definition | undefined {
    return this.definitionOfType(this.checker.getTypeOfSymbol(symbol))
  }

  private definitionOfType(type: TS.Type): Definition | undefined {
    const nameProperty = this.checker.getPropertyOfType(type, 'NAME')
    const signatures = type.getCallSignatures()
    if (!nameProperty || signatures.length !== 1) {
      return undefined
    }
    const messageType = signatures[0].getReturnType()
    return this.checker.getPropertyOfType(messageType, '$name')
      ? { nameProperty, messageType }
      : undefined
  }

  /**
   * Definitions held in an exported object, such as `export const Orders = { PlaceOrder: defineCommand(...)() }`,
   * have no export of their own to key them by, so they're warned about rather than read
   */
  private warnAboutGroupedDefinitions(symbol: TS.Symbol): void {
    const type = this.checker.getTypeOfSymbol(symbol)
    if (!(type.flags & this.ts.TypeFlags.Object)) {
      return
    }
    for (const property of this.checker.getPropertiesOfType(type)) {
      const definition = this.definitionOfType(
        this.checker.getTypeOfSymbol(property)
      )
      const nameType =
        definition && this.checker.getTypeOfSymbol(definition.nameProperty)
      if (nameType?.isStringLiteral()) {
        this.warnings.push(
          `${symbol.getName()}.${property.getName()} (${this.relativePath(symbol.declarations![0].getSourceFile().fileName)}): it's a definition inside an object, so it isn't read as a message. Export it as its own const, e.g. \`export const ${property.getName()} = ...\``
        )
      }
    }
  }

  /**
   * The object type an interface or type alias declares. Unions, such as a union of messages, aren't
   * object types.
   */
  private objectTypeOf(symbol: TS.Symbol): TS.Type | undefined {
    const { ts } = this
    const type = this.checker.getDeclaredTypeOfSymbol(symbol)
    return type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)
      ? type
      : undefined
  }

  private isGeneric(symbol: TS.Symbol): boolean {
    const { ts } = this
    return (symbol.declarations ?? []).some(
      declaration =>
        (ts.isInterfaceDeclaration(declaration) ||
          ts.isTypeAliasDeclaration(declaration)) &&
        !!declaration.typeParameters?.length
    )
  }

  /**
   * The `$name` a declaration would be read with if it were exported from an entry file: a concrete
   * class, a definition, or an interface or type alias with a string literal `$name`
   */
  private messageNameOf(symbol: TS.Symbol): string | undefined {
    const { ts } = this
    if (symbol.flags & ts.SymbolFlags.Class) {
      const declaration = symbol.declarations?.find(ts.isClassDeclaration)
      const nameProperty = this.checker.getPropertyOfType(
        this.checker.getDeclaredTypeOfSymbol(symbol),
        '$name'
      )
      if (!declaration || !nameProperty || isAbstract(ts, declaration)) {
        return undefined
      }
      const name = this.resolveName(nameProperty)
      return name === 'not-set' ? undefined : name
    }
    const nameProperties: (TS.Symbol | undefined)[] = []
    if (symbol.flags & ts.SymbolFlags.Variable) {
      nameProperties.push(this.definitionOf(symbol)?.nameProperty)
    }
    if (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) {
      const type = this.objectTypeOf(symbol)
      nameProperties.push(type && this.checker.getPropertyOfType(type, '$name'))
    }
    for (const nameProperty of nameProperties) {
      const nameType =
        nameProperty && this.checker.getTypeOfSymbol(nameProperty)
      if (nameType?.isStringLiteral()) {
        return nameType.value
      }
    }
    return undefined
  }

  /**
   * The classes, interfaces, type aliases and variables declared at the top level of a file
   */
  private declaredSymbols(sourceFile: TS.SourceFile): TS.Symbol[] {
    const { ts } = this
    const names = sourceFile.statements.flatMap((statement): TS.Node[] => {
      if (
        (ts.isClassDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement)) &&
        statement.name
      ) {
        return [statement.name]
      }
      if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations
          .map(declaration => declaration.name)
          .filter(ts.isIdentifier)
      }
      return []
    })
    const symbols = names
      .map(name => this.checker.getSymbolAtLocation(name))
      .filter((symbol): symbol is TS.Symbol => !!symbol)
    return [...new Set(symbols)]
  }

  /**
   * Warns about the declarations with a `$name` that were skipped for a reason only known once every
   * file has been read
   */
  private warnAboutSkipped(): void {
    const read = new Set(
      [...this.messages.values()].map(({ symbol }) => symbol)
    )
    for (const symbol of this.unsetNameClasses) {
      // A nested class with a `$name` field is data
      if (!this.keysBySymbol.has(symbol)) {
        this.warnings.push(
          `${this.describeLocation(symbol)}: its $name is declared but never set, so it isn't read as a message. Set it to a string literal, or to a static NAME that is one`
        )
      }
    }
    for (const { symbol, from } of this.reExports) {
      const declaringFile = symbol.declarations?.[0]?.getSourceFile()
      if (
        !declaringFile ||
        read.has(symbol) ||
        this.entryFiles.has(declaringFile) ||
        declaringFile.isDeclarationFile ||
        this.program.isSourceFileFromExternalLibrary(declaringFile) ||
        this.messageNameOf(symbol) === undefined
      ) {
        continue
      }
      this.warnings.push(
        `${this.describeLocation(symbol)}: it's exported from ${this.relativePath(from.fileName)}, but the file that declares it isn't an entry file, so it isn't read as a message. Add ${this.relativePath(declaringFile.fileName)} to the entry files`
      )
      read.add(symbol)
    }
  }

  private resolveName(nameProperty: TS.Symbol): string | 'not-set' | undefined {
    const { ts } = this
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
    return 'not-set'
  }

  private evaluateString(
    expression: TS.Expression,
    depth: number
  ): string | undefined {
    const { ts } = this
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

  private classKey(symbol: TS.Symbol, where: string): string | undefined {
    const { ts } = this
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
    ) as TS.InterfaceType
    if (instanceType.typeParameters?.length) {
      this.problems.push(
        `${where}: ${symbol.getName()} is generic, which isn't supported. Use a class without type parameters`
      )
      return undefined
    }

    this.checkDiagnostics(sourceFile)
    const key = this.uniqueKey(this.declarationKey(symbol, sourceFile))
    this.keysBySymbol.set(symbol, key)
    const typeModel: TypeModel = {
      key,
      class: { exportName, fileName: sourceFile.fileName },
      fields: []
    }
    this.types.set(key, typeModel)
    typeModel.fields = this.fieldsOf(instanceType, symbol.getName(), key)
    return key
  }

  private fieldsOf(
    type: TS.Type,
    owner: string,
    ownerKey: string
  ): TypeModel['fields'] {
    const fields: TypeModel['fields'] = []
    for (const property of this.checker.getPropertiesOfType(type)) {
      const name = property.getName()
      if (
        property.flags & this.skippedMemberFlags ||
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
      const fieldType = this.describe(propertyType, {
        where: `${owner}.${name}`,
        key: `${ownerKey}.${name}`
      })
      if (fieldType !== PLAIN) {
        fields.push([name, fieldType])
      }
    }
    return fields
  }

  private describe(type: TS.Type, at: At): Described {
    const { ts } = this
    const flags = type.flags
    if (isErrorType(type)) {
      return this.problem(`${at.where}: its type can't be resolved`)
    }
    if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
      return PLAIN
    }
    if (flags & ts.TypeFlags.BigIntLike) {
      return 'BigInt'
    }
    if (flags & this.plainFlags || flags & ts.TypeFlags.NonPrimitive) {
      return PLAIN
    }
    if (flags & ts.TypeFlags.ESSymbolLike) {
      return this.problem(`${at.where}: symbols can't be sent as JSON`)
    }
    if (flags & ts.TypeFlags.TypeParameter) {
      return this.problem(
        `${at.where}: generic type parameters aren't supported. Use a concrete type`
      )
    }
    if (type.isUnion()) {
      return this.describeUnion(type, at)
    }
    if (type.isIntersection()) {
      // A branded primitive such as `string & { __brand: 'Id' }` is sent as the primitive
      const primitive = type.types.find(
        member => member.flags & (this.plainFlags | ts.TypeFlags.BigIntLike)
      )
      return primitive
        ? this.describe(primitive, at)
        : this.describeObjectType(type, at)
    }
    if (flags & ts.TypeFlags.Object) {
      return this.describeObject(type as TS.ObjectType, at)
    }
    return this.problem(
      `${at.where}: ${this.checker.typeToString(type)} isn't supported`
    )
  }

  private describeUnion(type: TS.UnionType, at: At): Described {
    const members = type.types.filter(
      member => !(member.flags & this.nullishFlags)
    )
    const described = members.map(member => this.describe(member, at))
    const restored = described.filter(member => member !== PLAIN)
    if (!restored.length) {
      return PLAIN
    }
    const distinct = new Set(restored.map(member => JSON.stringify(member)))
    if (restored.length === described.length && distinct.size === 1) {
      return restored[0]
    }
    return this.problem(
      `${at.where}: ${this.checker.typeToString(type)} mixes types that are restored differently, and they can't be told apart once they're JSON. Use one type, or a separate field for each`
    )
  }

  private describeObject(type: TS.ObjectType, at: At): Described {
    const { ts } = this
    if (this.checker.isArrayType(type)) {
      const [item] = this.checker.getTypeArguments(type as TS.TypeReference)
      const described = this.describe(item, child(at, '[]'))
      return described === PLAIN ? PLAIN : { array: described }
    }
    if (this.checker.isTupleType(type)) {
      const items = this.checker.getTypeArguments(type as TS.TypeReference)
      const restored = items
        .map((item, index) => this.describe(item, child(at, `[${index}]`)))
        .some(item => item !== PLAIN)
      return restored
        ? this.problem(
            `${at.where}: tuples with values that need restoring aren't supported. Use an array or a class`
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
      return this.describeBuiltIn(type, symbol.getName(), at)
    }
    if (
      this.checker.getSignaturesOfType(type, ts.SignatureKind.Call).length ||
      this.checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length
    ) {
      return this.problem(`${at.where}: functions can't be sent as JSON`)
    }
    if (symbol && symbol.flags & ts.SymbolFlags.Class) {
      if ((type as TS.TypeReference).typeArguments?.length) {
        return this.problem(
          `${at.where}: ${this.checker.typeToString(type)} is a generic class, which isn't supported. Use a class without type parameters`
        )
      }
      const declaration = symbol.declarations?.find(ts.isClassDeclaration)
      if (declaration && isAbstract(ts, declaration)) {
        return this.problem(
          `${at.where}: ${symbol.getName()} is abstract. JSON doesn't say which subclass a value was, so it would be restored as ${symbol.getName()}. Use a concrete class, or a separate field for each subclass`
        )
      }
      const key = this.classKey(symbol, at.where)
      return key ? { type: key } : PLAIN
    }
    return this.describeObjectType(type, at)
  }

  private describeBuiltIn(
    type: TS.ObjectType,
    name: string,
    at: At
  ): Described {
    const typeArguments =
      (type as TS.TypeReference).target !== undefined
        ? this.checker.getTypeArguments(type as TS.TypeReference)
        : []
    switch (name) {
      case 'Date':
        return 'Date'
      case 'Object':
        return PLAIN
      case 'Set':
      case 'ReadonlySet': {
        const item = this.describe(typeArguments[0], child(at, '[]'))
        return { set: item }
      }
      case 'Map':
      case 'ReadonlyMap': {
        const [keyType, valueType] = typeArguments
        const keys = this.describeMapKey(keyType, at)
        if (keys === undefined) {
          return PLAIN
        }
        const value = this.describe(valueType, child(at, '[value]'))
        return keys === 'number' ? { map: value, keys } : { map: value }
      }
      default:
        return this.problem(
          `${at.where}: ${this.checker.typeToString(type)} isn't supported. Supported built-in types are Date, Map, Set and bigint`
        )
    }
  }

  private describeMapKey(
    keyType: TS.Type,
    at: At
  ): 'string' | 'number' | undefined {
    const { ts } = this
    const members = keyType.isUnion() ? keyType.types : [keyType]
    if (members.every(member => member.flags & ts.TypeFlags.StringLike)) {
      return 'string'
    }
    if (members.every(member => member.flags & ts.TypeFlags.NumberLike)) {
      return 'number'
    }
    this.problem(
      `${at.where}: Map keys must be strings or numbers to be sent as JSON, not ${this.checker.typeToString(keyType)}`
    )
    return undefined
  }

  private describeObjectType(type: TS.Type, at: At): Described {
    const { ts } = this
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
        `${at.where}: ${this.checker.typeToString(type)} has a method (${method.getName()}), which can't be sent as JSON. Use a class, or an object type without methods`
      )
    }

    const indexInfos = this.checker.getIndexInfosOfType(type)
    const indexed = indexInfos.map(info =>
      this.describe(info.type, child(at, '[key]'))
    )
    const restoredIndex = indexed.find(item => item !== PLAIN)
    if (!properties.length) {
      return restoredIndex === undefined ? PLAIN : { record: restoredIndex }
    }
    if (restoredIndex !== undefined) {
      return this.problem(
        `${at.where}: object types that have both named properties and an index signature that needs restoring aren't supported`
      )
    }

    // Named interfaces and type aliases are keyed by their declaration. Anonymous object types, and
    // instantiations of generic ones, are keyed by the field they're used in.
    const alias = type.aliasSymbol
    const symbol = type.getSymbol()
    const named =
      alias && !type.aliasTypeArguments?.length
        ? alias
        : symbol &&
            symbol.flags & ts.SymbolFlags.Interface &&
            !(type as TS.TypeReference).typeArguments?.length
          ? symbol
          : undefined
    const namedDeclaration = named?.declarations?.[0]
    const key = this.uniqueKey(
      named && namedDeclaration
        ? this.declarationKey(named, namedDeclaration.getSourceFile())
        : at.key
    )
    const reference: Described = { type: key }
    this.describedObjects.set(type, reference)
    this.objectsInProgress.add(key)
    const typeModel: TypeModel = { key, fields: [] }
    this.types.set(key, typeModel)

    typeModel.fields = this.fieldsOf(
      type,
      named ? named.getName() : at.where,
      key
    )

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

  /**
   * The key of a declaration: the package, the module that declares it and its name, e.g.
   * `@my-org/messages/src/customer#Customer`
   */
  private declarationKey(symbol: TS.Symbol, sourceFile: TS.SourceFile): string {
    const modulePath = relative(this.options.keyRoot, sourceFile.fileName)
      .split('\\')
      .join('/')
      .replace(/\.(d\.)?[mc]?tsx?$/, '')
    return `${this.options.keyPrefix}${modulePath}#${symbol.getName()}`
  }

  private exportNameOf(
    symbol: TS.Symbol,
    sourceFile: TS.SourceFile
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

  /**
   * Syntax errors and types or modules that can't be resolved stop generation. Other errors, such
   * as strictness checks the project's own build may not apply, are reported as warnings.
   */
  private checkDiagnostics(sourceFile: TS.SourceFile): void {
    const { ts } = this
    if (this.checkedFiles.has(sourceFile)) {
      return
    }
    this.checkedFiles.add(sourceFile)
    const format = (diagnostic: TS.Diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        '\n'
      )
      const position =
        diagnostic.start !== undefined
          ? sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
          : undefined
      return `${this.relativePath(sourceFile.fileName)}${position ? `:${position.line + 1}:${position.character + 1}` : ''}: ${message}`
    }
    const isError = (diagnostic: TS.Diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error

    for (const diagnostic of this.program
      .getSyntacticDiagnostics(sourceFile)
      .filter(isError)) {
      this.problems.push(format(diagnostic))
    }
    for (const diagnostic of this.program
      .getSemanticDiagnostics(sourceFile)
      .filter(isError)) {
      if (BLOCKING_DIAGNOSTIC_CODES.has(diagnostic.code)) {
        this.problems.push(format(diagnostic))
      } else {
        this.warnings.push(format(diagnostic))
      }
    }
  }

  private isFromDefaultLibrary(symbol: TS.Symbol): boolean {
    return (symbol.declarations ?? []).some(declaration =>
      this.program.isSourceFileDefaultLibrary(declaration.getSourceFile())
    )
  }

  private resolveAlias(symbol: TS.Symbol): TS.Symbol {
    return symbol.flags & this.ts.SymbolFlags.Alias
      ? this.checker.getAliasedSymbol(symbol)
      : symbol
  }

  private describeLocation(symbol: TS.Symbol): string {
    const declaration = symbol.declarations?.[0]
    return declaration
      ? `${symbol.getName()} (${this.relativePath(declaration.getSourceFile().fileName)})`
      : symbol.getName()
  }

  private relativePath(fileName: string): string {
    return relative(this.options.cwd, fileName).split('\\').join('/')
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

const isAbstract = (ts: typeof TS, declaration: TS.ClassDeclaration): boolean =>
  (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Abstract) !== 0

/**
 * The checker gives a type it can't resolve, such as one from a missing import, the intrinsic `error` type
 */
const isErrorType = (type: TS.Type): boolean =>
  (type as { intrinsicName?: string }).intrinsicName === 'error'
