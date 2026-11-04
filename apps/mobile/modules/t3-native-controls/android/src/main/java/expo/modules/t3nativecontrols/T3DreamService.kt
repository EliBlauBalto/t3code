package expo.modules.t3nativecontrols

import android.content.res.Configuration
import android.service.dreams.DreamService
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.interfaces.fabric.ReactSurface
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.lang.ref.WeakReference

class T3DreamService : DreamService() {
  private var reactHost: ReactHost? = null
  private var surface: ReactSurface? = null
  private var dreaming = false
  private var taskId: Int? = null
  private var taskContext: WeakReference<ReactContext>? = null
  private val instanceListener = object : ReactInstanceEventListener {
    override fun onReactContextInitialized(context: ReactContext) {
      startTimerLease(context)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    isInteractive = false
    isFullscreen = true
    isScreenBright = false
    val host = (application as ReactApplication).reactHost ?: run {
      finish()
      return
    }
    reactHost = host
    host.addReactInstanceEventListener(instanceListener)
    val dreamSurface = host.createSurface(this, "T3Dream", null)
    surface = dreamSurface
    setContentView(requireNotNull(dreamSurface.view))
    dreamSurface.start()
  }

  override fun onDreamingStarted() {
    super.onDreamingStarted()
    dreaming = true
    reactHost?.currentReactContext?.let { startTimerLease(it) }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    reactHost?.onConfigurationChanged(this)
  }

  override fun onDreamingStopped() {
    stopSurface()
    super.onDreamingStopped()
  }

  override fun onDetachedFromWindow() {
    stopSurface()
    super.onDetachedFromWindow()
  }

  private fun stopSurface() {
    dreaming = false
    reactHost?.removeReactInstanceEventListener(instanceListener)
    taskContext?.get()?.let { context ->
      taskId?.let { id -> HeadlessJsTaskContext.getInstance(context).finishTask(id) }
    }
    taskId = null
    taskContext = null
    surface?.stop()
    surface?.detach()
    surface = null
    reactHost = null
  }

  override fun onDestroy() {
    stopSurface()
    super.onDestroy()
  }

  private fun startTimerLease(context: ReactContext) {
    if (!dreaming || taskId != null) return
    taskContext = WeakReference(context)
    // Keep RN timers running without reporting the background chat activity as resumed.
    taskId = HeadlessJsTaskContext.getInstance(context).startTask(
      HeadlessJsTaskConfig("T3DreamLifetime", Arguments.createMap(), 0, true)
    )
  }
}
