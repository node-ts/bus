import { Bus, handlerFor } from '@node-ts/bus-core'
import { openTelemetry } from '@node-ts/bus-opentelemetry'
import { metrics, trace } from '@opentelemetry/api'
import { ReserveRoom } from './messages'
import { reservationService } from './services'

// #region handler-name
// The handler span is named "reserveRoom". An inline arrow function would be "anonymous".
const reserveRoom = async (command: ReserveRoom) =>
  reservationService.reserveRoom(command.roomId, command.bookingId)

Bus.configure().withHandler(handlerFor(ReserveRoom, reserveRoom))
// #endregion handler-name

// #region providers
// Any provider from your OpenTelemetry setup, such as one per bus
const tracerProvider = trace.getTracerProvider()
const meterProvider = metrics.getMeterProvider()

Bus.configure().withMiddleware(openTelemetry({ tracerProvider, meterProvider }))
// #endregion providers
