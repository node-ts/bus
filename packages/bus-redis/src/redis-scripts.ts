import { createHash } from 'node:crypto'

/**
 * A Lua script the transport runs with `EVALSHA`, loading it with `EVAL` the first time a server doesn't have it
 */
export interface RedisScript {
  /**
   * What the script is for, for logs
   */
  name: string
  /**
   * The Lua source
   */
  source: string
  /**
   * The SHA1 digest of the source, which `EVALSHA` runs it by
   */
  sha: string
}

const script = (name: string, source: string): RedisScript => ({
  name,
  source,
  sha: createHash('sha1').update(source).digest('hex')
})

/**
 * Lua helpers every script that settles a message starts with.
 *
 * `isPendingTo` checks a stream entry is still pending to a consumer with the delivery count it was received with, so
 * a receipt that another receiver has taken over (after its visibility timeout ended) settles nothing.
 *
 * `nowMs` is the server's clock in milliseconds, so every process schedules by the same clock.
 *
 * `integer` formats a number without an exponent, which Lua's own formatting uses for large numbers.
 */
const PRELUDE = `
local function isPendingTo(stream, group, id, consumer, deliveries)
  local pending = redis.call('XPENDING', stream, group, id, id, 1)
  local entry = pending[1]
  return entry ~= nil and entry[2] == consumer and tonumber(entry[4]) == tonumber(deliveries)
end
local function nowMs()
  local time = redis.call('TIME')
  return tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
end
local function integer(value)
  return string.format('%.0f', value)
end
local function fieldsFrom(first)
  local fields = {}
  for i = first, #ARGV do
    fields[#fields + 1] = ARGV[i]
  end
  return fields
end
`

/**
 * Deletes a message that's been handled: acknowledges it and removes it from the stream, so streams don't grow.
 *
 * KEYS: queue stream. ARGV: group, consumer, entry id, deliveries.
 * Returns 1 if it was deleted, or 0 if the receipt no longer holds it.
 */
export const DELETE_SCRIPT = script(
  'delete',
  `${PRELUDE}
if not isPendingTo(KEYS[1], ARGV[1], ARGV[3], ARGV[2], ARGV[4]) then
  return 0
end
redis.call('XACK', KEYS[1], ARGV[1], ARGV[3])
redis.call('XDEL', KEYS[1], ARGV[3])
return 1
`
)

/**
 * Returns a message to be handled again after a delay: a copy with the given fields (which count one more failed
 * attempt) is added to the delayed set, scored by when it's due, or straight to the stream when there's no delay, and
 * the received entry is acknowledged and removed.
 *
 * KEYS: queue stream, delayed set. ARGV: group, consumer, entry id, deliveries, delay in ms, then the copy's fields
 * and values. Returns 1 if it was returned, or 0 if the receipt no longer holds it.
 */
export const RETURN_SCRIPT = script(
  'return',
  `${PRELUDE}
if not isPendingTo(KEYS[1], ARGV[1], ARGV[3], ARGV[2], ARGV[4]) then
  return 0
end
local fields = fieldsFrom(6)
local delay = tonumber(ARGV[5])
if delay <= 0 then
  redis.call('XADD', KEYS[1], '*', unpack(fields))
else
  redis.call('ZADD', KEYS[2], integer(nowMs() + delay), cjson.encode({ id = ARGV[3], fields = fields }))
end
redis.call('XACK', KEYS[1], ARGV[1], ARGV[3])
redis.call('XDEL', KEYS[1], ARGV[3])
return 1
`
)

/**
 * Dead-letters a message: adds a copy with the given fields (including `bus-failure`) to the dead letter stream,
 * trimming entries older than the retention, and acknowledges and removes the received entry.
 *
 * KEYS: queue stream, dead letter stream. ARGV: group, consumer, entry id, deliveries, retention in ms (0 keeps
 * everything), then the copy's fields and values. Returns 1 if it was dead-lettered, or 0 if the receipt no longer
 * holds it.
 */
export const FAIL_SCRIPT = script(
  'fail',
  `${PRELUDE}
if not isPendingTo(KEYS[1], ARGV[1], ARGV[3], ARGV[2], ARGV[4]) then
  return 0
end
local fields = fieldsFrom(6)
local retention = tonumber(ARGV[5])
if retention > 0 then
  local minId = nowMs() - retention
  if minId < 0 then
    minId = 0
  end
  redis.call('XADD', KEYS[2], 'MINID', '~', integer(minId), '*', unpack(fields))
else
  redis.call('XADD', KEYS[2], '*', unpack(fields))
end
redis.call('XACK', KEYS[1], ARGV[1], ARGV[3])
redis.call('XDEL', KEYS[1], ARGV[3])
return 1
`
)

/**
 * Run before each read. It:
 *
 * 1. moves returned messages that are due from the delayed set back to the stream,
 * 2. when a reclaim count is given, takes over messages that have been pending for at least the visibility timeout,
 *    such as those of a process that stopped, returning each with its new delivery count, and
 * 3. when a consumer idle time is given, removes consumers other than this one that have nothing pending and haven't
 *    read for that long, which processes that stopped leave behind. One with nothing pending loses nothing.
 *
 * KEYS: queue stream, delayed set. ARGV: group, consumer, visibility timeout in ms, reclaim count (0 to skip), how
 * many due messages to move at most, consumer idle time in ms (0 to skip).
 * Returns { ms until the next returned message is due, or -1 if there's none, { { id, fields, deliveries }, ... } }.
 */
export const MAINTAIN_SCRIPT = script(
  'maintain',
  `${PRELUDE}
local now = nowMs()
local due = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', integer(now), 'LIMIT', 0, tonumber(ARGV[5]))
for _, member in ipairs(due) do
  local entry = cjson.decode(member)
  redis.call('XADD', KEYS[1], '*', unpack(entry.fields))
  redis.call('ZREM', KEYS[2], member)
end

local nextDue = -1
local first = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
if first[2] then
  nextDue = tonumber(first[2]) - now
  if nextDue < 0 then
    nextDue = 0
  end
end

local claimed = {}
if tonumber(ARGV[4]) > 0 then
  local pending = redis.call('XPENDING', KEYS[1], ARGV[1], 'IDLE', ARGV[3], '-', '+', ARGV[4])
  for _, entry in ipairs(pending) do
    local entries = redis.call('XCLAIM', KEYS[1], ARGV[1], ARGV[2], ARGV[3], entry[1])
    local claim = entries[1]
    -- An entry that was removed from the stream isn't claimed, and is dropped from the pending list
    if claim and claim[2] then
      claimed[#claimed + 1] = { claim[1], claim[2], tonumber(entry[4]) + 1 }
    end
  end
end

if tonumber(ARGV[6]) > 0 then
  local consumers = redis.call('XINFO', 'CONSUMERS', KEYS[1], ARGV[1])
  for _, consumer in ipairs(consumers) do
    local info = {}
    for i = 1, #consumer, 2 do
      info[consumer[i]] = consumer[i + 1]
    end
    if info['name'] ~= ARGV[2] and tonumber(info['pending']) == 0 and tonumber(info['idle']) >= tonumber(ARGV[6]) then
      redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], info['name'])
    end
  end
end

return { integer(nextDue), claimed }
`
)

/**
 * Gives back a message that was received but not handled, because the transport stopped: it stays pending, with the
 * delivery count it had before it was received, and idle for the visibility timeout, so another receiver takes it
 * over on its next read without counting a failed attempt.
 *
 * KEYS: queue stream. ARGV: group, consumer, entry id, deliveries, visibility timeout in ms.
 */
export const RELEASE_SCRIPT = script(
  'release',
  `${PRELUDE}
if not isPendingTo(KEYS[1], ARGV[1], ARGV[3], ARGV[2], ARGV[4]) then
  return 0
end
redis.call('XCLAIM', KEYS[1], ARGV[1], ARGV[2], 0, ARGV[3], 'IDLE', ARGV[5], 'RETRYCOUNT', tonumber(ARGV[4]) - 1, 'JUSTID')
return 1
`
)

/**
 * Removes this consumer from the group when nothing is pending to it, so stopped processes don't leave consumers
 * behind. One with messages pending is left for other receivers to take them over.
 *
 * KEYS: queue stream. ARGV: group, consumer. Returns 1 if it was removed.
 */
export const LEAVE_SCRIPT = script(
  'leave',
  `
local pending = redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, ARGV[2])
if #pending == 0 then
  redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[2])
  return 1
end
return 0
`
)
