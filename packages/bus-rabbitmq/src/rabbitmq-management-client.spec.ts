import { resolveManagementSettings } from './rabbitmq-management-client'

const basic = (credentials: string) =>
  `Basic ${Buffer.from(credentials).toString('base64')}`

describe('resolveManagementSettings', () => {
  describe('when the management url has no user', () => {
    const settings = resolveManagementSettings(
      'http://rabbitmq:15672/',
      'amqp://deployer:p%40ss@rabbitmq:5672/orders%2Fprod'
    )

    it('should use the user and vhost of the connection string', () => {
      expect(settings).toEqual({
        baseUrl: 'http://rabbitmq:15672',
        authorization: basic('deployer:p@ss'),
        vhost: 'orders/prod'
      })
    })
  })

  describe('when the management url has a user of its own', () => {
    const settings = resolveManagementSettings(
      'https://admin:secret@rabbitmq.example.com/rabbitmq/',
      'amqp://app:app@rabbitmq'
    )

    it('should use it, and leave it out of the url', () => {
      expect(settings).toEqual({
        baseUrl: 'https://rabbitmq.example.com/rabbitmq',
        authorization: basic('admin:secret'),
        vhost: '/'
      })
    })
  })

  describe('when neither has a user', () => {
    const settings = resolveManagementSettings(
      'http://127.0.0.1:15672',
      'amqp://localhost/'
    )

    it('should default to guest on the default vhost, as amqplib does', () => {
      expect(settings).toEqual({
        baseUrl: 'http://127.0.0.1:15672',
        authorization: basic('guest:guest'),
        vhost: '/'
      })
    })
  })
})
