export const bounceEventExample = {
  notificationType: 'Bounce',
  bounce: {
    bounceType: 'Permanent'
  }
}

/**
 * Represents a (trimmed down version of) SES email bounce notification that's published
 * over SNS
 */
export interface BounceEvent {
  notificationType: string
  bounce: {
    bounceType: string
  }
}
