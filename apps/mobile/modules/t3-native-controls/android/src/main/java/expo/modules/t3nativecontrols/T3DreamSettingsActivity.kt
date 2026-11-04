package expo.modules.t3nativecontrols

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

class T3DreamSettingsActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      launch.action = Intent.ACTION_VIEW
      launch.data = Uri.parse(getString(R.string.t3_dream_settings_url))
      launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      startActivity(launch)
    }
    finish()
  }
}
