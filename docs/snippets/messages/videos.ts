import { Command, Event } from '@node-ts/bus-messages'

/**
 * Encode an uploaded video, which can take up to an hour
 */
export class EncodeVideo extends Command {
  static NAME = 'my-app/videos/encode-video'
  $name = EncodeVideo.NAME
  $version = 0

  constructor(readonly videoId: string) {
    super()
  }
}

/**
 * A task that encodes a video was started
 */
export class VideoEncodingStarted extends Event {
  static NAME = 'my-app/videos/video-encoding-started'
  $name = VideoEncodingStarted.NAME
  $version = 0

  constructor(
    readonly videoId: string,
    readonly taskId: string
  ) {
    super()
  }
}

/**
 * A video was encoded
 */
export class VideoEncoded extends Event {
  static NAME = 'my-app/videos/video-encoded'
  $name = VideoEncoded.NAME
  $version = 0

  constructor(readonly videoId: string) {
    super()
  }
}
