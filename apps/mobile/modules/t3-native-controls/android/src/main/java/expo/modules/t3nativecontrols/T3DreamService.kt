package expo.modules.t3nativecontrols

import android.content.res.Configuration
import android.os.Handler
import android.os.Looper
import android.service.dreams.DreamService
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import com.facebook.react.fabric.FabricUIManager
import com.facebook.react.interfaces.fabric.ReactSurface
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType
import java.lang.ref.WeakReference

class T3DreamService : DreamService() {
  private var reactHost: ReactHost? = null
  private var surface: ReactSurface? = null
  private var dreaming = false
  private var taskId: Int? = null
  private var taskContext: WeakReference<ReactContext>? = null
  private var renderer: FabricUIManager? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  private val lifecycleListener = object : LifecycleEventListener {
    override fun onHostResume() = Unit

    override fun onHostPause() {
      // Run after every activity-pause listener, including Fabric's own listener.
      mainHandler.post { if (dreaming) resumeRenderer() }
    }

    override fun onHostDestroy() = Unit
  }
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
    // RN refreshes its JS font-scale cache on activity resume; Dreams do not resume one.
    val context = reactHost?.currentReactContext ?: return
    if (context.hasActiveReactInstance()) {
      val deviceInfo = context.getNativeModule("DeviceInfo") as? LifecycleEventListener ?: run {
        Log.w(
          "T3DreamService",
          "React Native DeviceInfo lifecycle is unavailable for the screen saver"
        )
        return
      }
      deviceInfo.onHostResume()
    }
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
    stopTimerLease()
    surface?.stop()
    surface?.detach()
    surface = null
    reactHost = null
  }

  private fun stopTimerLease() {
    taskContext?.get()?.let { context ->
      context.removeLifecycleEventListener(lifecycleListener)
      taskId?.let { id -> HeadlessJsTaskContext.getInstance(context).finishTask(id) }
      if (context.lifecycleState != LifecycleState.RESUMED) {
        renderer?.onHostPause()
        (renderer?.eventDispatcher as? LifecycleEventListener)?.onHostPause()
      }
    }
    renderer = null
    taskId = null
    taskContext = null
  }

  override fun onDestroy() {
    stopSurface()
    super.onDestroy()
  }

  private fun startTimerLease(context: ReactContext) {
    if (!dreaming || (taskId != null && taskContext?.get() === context)) return
    stopTimerLease()
    renderer =
      UIManagerHelper.getUIManager(context, UIManagerType.FABRIC) as? FabricUIManager ?: run {
        Log.e("T3DreamService", "React Native FabricUIManager is unavailable for the screen saver")
        finish()
        return
      }
    taskContext = WeakReference(context)
    context.addLifecycleEventListener(lifecycleListener)
    if (resumeRenderer()) {
      // Keep RN timers running without reporting the background chat activity as resumed.
      taskId = HeadlessJsTaskContext.getInstance(context).startTask(
        HeadlessJsTaskConfig("T3DreamLifetime", Arguments.createMap(), 0, true)
      )
    }
  }

  private fun resumeRenderer(): Boolean {
    // RN 0.88: keep Fabric and its dispatcher active without resuming ReactHost/AppState.
    // On RN upgrades check cold/warm Dreams, context reload, clock advance,
    // font-scale changes, and timer release on exit.
    val currentRenderer = renderer ?: return false
    val dispatcher = currentRenderer.eventDispatcher as? LifecycleEventListener
    return if (dispatcher == null) {
      Log.e(
        "T3DreamService",
        "React Native Fabric dispatcher lifecycle is unavailable for the screen saver"
      )
      finish()
      false
    } else {
      currentRenderer.onHostResume()
      dispatcher.onHostResume()
      true
    }
  }
}
