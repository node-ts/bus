import { injectable } from 'inversify'
import { Serializer } from './serializer'
import { ClassConstructor } from '../util'
import { classToPlain, plainToClass, serialize, deserialize } from 'class-transformer'
import { Message } from '@node-ts/bus-messages'

/**
 * A JSON-based serializer that uses `class-transformer` to transform to and from
 * class instances of an object rather than just their plain types. As a result,
 * message types can use all of the serialization decorator hints provided by
 * that library.
 */
@injectable()
export class JsonSerializer implements Serializer {
  serialize<MessageType extends Message> (message: MessageType): string {
    return serialize(message)
  }

  deserialize<MessageType extends Message> (
    serializedMessage: string,
    classConstructor: ClassConstructor<MessageType>
  ): MessageType {
    return deserialize<MessageType> (classConstructor, serializedMessage)
  }

  toPlain<T extends object> (obj: T): object {
    return classToPlain(obj)
  }

  toClass<T extends object> (obj: object, classConstructor: ClassConstructor<T>): T {
    return plainToClass(classConstructor, obj)
  }
}
