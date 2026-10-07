import { DynamicModule } from '@nestjs/common'
import { Recorder } from './recorder'

class RecorderHostModule {}

/**
 * A global module that provides a `Recorder`, created for each test application
 */
export const recorderModule = (): DynamicModule => ({
  module: RecorderHostModule,
  global: true,
  providers: [Recorder],
  exports: [Recorder]
})
