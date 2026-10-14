import java.util.Properties

// Release signing, loaded from android/key.properties — which is gitignored,
// because it holds passwords and the path to a keystore that lives outside
// this repo entirely.
//
// Absent, a release build FAILS rather than quietly signing with the debug key.
// A debug-signed APK installs fine, so the mistake goes unnoticed until it
// matters: Play rejects it, and a copy sideloaded to phones can never be updated
// by the properly signed one (the signatures differ, so Android refuses and the
// user has to uninstall and lose their data).
//
// For a throwaway local build, opt in on purpose:
//   ALLOW_DEBUG_SIGNED_RELEASE=1 flutter build apk --release
// Debug builds never need the keystore. See docs/RELEASE.md.
val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val hasReleaseSigning = keystoreProperties.getProperty("storeFile") != null
val allowDebugSignedRelease = System.getenv("ALLOW_DEBUG_SIGNED_RELEASE") == "1"

// Checked when the task graph is known, not while configuring: the release
// build type is configured for EVERY build, so throwing there would break
// `flutter run` too. Only an actual assemble/bundle/package Release task trips it.
gradle.taskGraph.whenReady {
    val buildsRelease = allTasks.any {
        it.project.name == "app" && Regex("^(assemble|bundle|package)Release$").matches(it.name)
    }
    if (buildsRelease && !hasReleaseSigning && !allowDebugSignedRelease) {
        throw GradleException(
            "No android/key.properties, so this release build would be signed " +
                "with the DEBUG key. Create the file (see key.properties.example), " +
                "or set ALLOW_DEBUG_SIGNED_RELEASE=1 if a debug-signed build is " +
                "really what you want."
        )
    }
}

plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.punx.plexus"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Required by flutter_local_notifications.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        applicationId = "com.punx.plexus"
        // flutter.minSdkVersion (24) already satisfies Firebase's minSdk-23 floor.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Reaching the debug branch means ALLOW_DEBUG_SIGNED_RELEASE=1 was
            // set — the graph check above refuses it otherwise. To see which key
            // an artefact actually carries:
            //   unzip -l app-release.aab | grep META-INF
            // ANDROIDD.RSA is the debug key; your own alias means it is signed
            // for release.
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

flutter {
    source = "../.."
}
