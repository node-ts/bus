// Stand-ins for an application's own services, so the snippets compile. They
// aren't shown on the site.

export const reservationService = {
  reserveRoom: async (_roomId: string, _bookingId: string): Promise<void> => {}
}

export const paymentService = {
  charge: async (_creditCardToken: string, _amount: number): Promise<void> => {}
}

export const receiptService = {
  record: async (_creditCardToken: string, _amount: number): Promise<void> => {}
}

export const shippingService = {
  ship: async (_itemId: string, _customerId: string): Promise<void> => {}
}

export const taskScheduler = {
  /**
   * Starts a container task, and resolves with its id once it's been placed
   */
  runTask: async (_image: string, _args: string[]): Promise<string> => 'task-1'
}

export const auditLog = {
  write: async (_entry: Record<string, unknown>): Promise<void> => {}
}

export const documentStore = {
  read: async (_key: string): Promise<string> => ''
}
