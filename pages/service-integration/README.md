# Reliable service communications with a service bus

It's common for services to communicate with each other over HTTP. However this isn't always the best technology choice, and integrating services (or even parts of the same service) using a message bus is much simpler and reliable than you may think.

The following examples use [@node-ts/bus](https://github.com/node-ts/bus) as the service bus.

## Sending

Consider the need to register a new product for our retail business. This might be modelled like so:

```typescript
const registerProduct = new RegisterProduct('abc-123', name: 'product a', price: 100)

// Sending the command using an HTTP based API endpoint:
await request('https://10.0.0.1:8080/product', registerProduct)

// Sending the same command using a service bus:
await bus.send(registerProduct)
```

### Service discovery

When dealing with an HTTP endoint, how do we know that the server is at `10.0.0.1`, listening on port `8080`?

  - We might build in a service discovery mechanism. Perhaps build a load balancer and tell it that `/product` requests need to be routed to a certain cluster of services.
  - Maybe replace the fixed IP with a local DNS entry to make this more reliable
  - Inject or set the configuration of this address per environment

When using messaging, the message is ultimately routed to a queue where it will be processed when the service monitoring that queue is ready. Your app doesn't need to know or care where that consumer is, it just needs to send out the command and know that it will eventually be processed.

### Service Availability

So what happens when the service that processes the request/message is unavailable?

Our HTTP request will just fail even though there's nothing wrong with whatever we used to make the request. We've done our work and just want the product to be registered, but now we have to deal with a `5xx` error in the code.

When working with messaging, commands are generally executed quickly - sub 10ms. If the service that processes this command does go down, then the command will sit in the queue until the service is ready and starts processing it again. No changes need to happen to the requesting process, it's fire and forget.

## Receiving

Consider processing the above command:

```typescript
import { productService } from './product-service'

// Using an HTTP based API endpoint
@Controller('POST', '/product')
const controller = (request, response, next) => {
  try {
    const command = request.body as RegisterProduct
    productService.registerProduct(command)
    response.status(204).end()
  } catch (err) {
    next(err)
  }
}

// Using a message handler
@HandlesMessage(RegisterProduct)
class RegisterProductHandler {
  handler (command: RegisterProduct): void {
    productService.registerProduct(command)
  }
}
```

### Verbs and Intent

`HTTP Services` should ususally conform to the technical specification on what different verbs mean. `POST`, `PUT`, `PATCH` and `DELETE` are all write operations that create, update or delete resources. This sometimes has the undesired effect of turning APIs into an anemic CRUD system that can discard the rich domain language used by your business. 

`Messaging` doesn't have these concepts. In fact it's useful to only have two types of intents: read and write, aka events and commands. In the above messaging example, a function receives an intent to perform an action (`RegisterProduct`) and it does that one thing. The name of the command is understandable even by non-technical users. 

### Response Statuses

A key difference between HTTP APIs and fire and forget messaging is that the former is generally a synchronous technology, whereas the latter is asynchronous. As such, messaging doesn't need to worry about return statuses because there's nobody to notify.

`HTTP services` on the other hand needs to use the set of HTTP status codes provided by the specification. Although most APIs use a small subset, they must indicate to the requestor what the outcome of processing was so that the requestor can then decide on the next step to take.

## Error Handling

What happens when the `productService` in the above example throws an error during processsing? For instance let's say that it tries to insert a record in a database that was being patched.

`HTTP Services` would error out and possibly return a `503 Service Unavailable` response. The requestor would then need to handle this response, and maybe throw an error of its own to indicate its work can't be completed, sending errors everywhere up the chain. This is made worse if the requestor already had completed half of a larger operation where the data is now in an incomplete state. 

`Messaging` by nature provides retries when errors occur. If the command is processed and an error is thrown due to the database being unavailable, the error is logged and the message is placed back on the queue. It's then picked up, and the same operation retried with a progressive delay between attempts. Eventually the database patching will finish and the next time the command is retried the process will complete sucessfully.

Using this approach, the requestor doesn't need to build in error handling for each command it sends out. Systems can go offline for days, but will resume normally once they're turned back on without any data loss.