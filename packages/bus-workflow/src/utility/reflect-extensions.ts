// tslint:disable:no-any Real any types
export class ReflectExtensions {
  static defineMetadata (metadataKey: Symbol, value: any, target: object): void {
    const array = Reflect.getMetadata(metadataKey, target) as any[] || []
    array.push(value)
    Reflect.defineMetadata(metadataKey, array, target)
  }
}
