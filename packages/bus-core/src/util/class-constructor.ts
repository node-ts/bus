// tslint:disable-next-line:no-any Valid spread args type
export function isClassConstructor (obj: object): obj is ClassConstructor<any> {
  return obj.hasOwnProperty('prototype')
    && !obj.hasOwnProperty('arguments')
    && (typeof obj) === 'function'
}

// tslint:disable-next-line:no-any Valid spread args type
export type ClassConstructor<TReturn> = new (...args: any[]) => TReturn
