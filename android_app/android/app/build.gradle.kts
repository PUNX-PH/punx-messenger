import java.util.Properties

// Release signing, loaded from android/key.properties — which is gitignored,
// because it holds passwords and the path to a keystore that lives outside
// this repo entirely.
//
// Absent, the release build falls back to the debug key. That keeps
// `flutter run --release` and sideloadable APKs working for anyone without the
// keystore (CI, a fresh clone, another machine) instead of failing the build —
// but a debug-signed artefact is rejected by Play, so a real release needs the
// file present. See docs/RELEASE.md.
val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val hasReleaseSigning = keystoreProperties.getProperty("storeFile") != null

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
            // The debug fallback is deliberate — see the note at the top of this
            // file. Play refuses a debug-signed upload, so check which key an
            // artefact actually carries before uploading one:
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
