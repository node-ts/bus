import { handlerFor } from '@node-ts/bus-core'
import { EncodeVideo, VideoEncodingStarted } from './messages'
import { taskScheduler } from './services'

declare const videoService: { encode(videoId: string): Promise<void> }

// #region naive
// Not recommended: the work is lost if it fails or the service restarts
export const encodeVideoInBackgroundHandler = handlerFor(
  EncodeVideo,
  command => {
    setTimeout(() => {
      videoService.encode(command.videoId).catch(console.error)
    }, 0)
  }
)
// #endregion naive

// #region task
export const encodeVideoHandler = handlerFor(
  EncodeVideo,
  async (command, _attributes, ctx) => {
    // Start a container task to do the work, and return straight away
    const taskId = await taskScheduler.runTask('video-encoder', [
      command.videoId
    ])
    await ctx.publish(new VideoEncodingStarted(command.videoId, taskId))
  }
)
// #endregion task
