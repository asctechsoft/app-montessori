import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("com.google.gms.google-services")
    id("com.google.firebase.crashlytics")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Optional store signing (git-ignored): android/key.properties with keyAlias,
// keyPassword, storeFile (relative to android/) and storePassword. Without it
// every build is signed with the debug key.
val keyProperties = Properties()
val keyPropertiesFile = rootProject.file("key.properties")
if (keyPropertiesFile.exists()) {
    FileInputStream(keyPropertiesFile).use { keyProperties.load(it) }
}

android {
    namespace = "com.asc.app_montessori"
    // permission_handler_android (via asc_common) needs compileSdk 37; same as muvik.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.asc.app_montessori"
        // Firebase Auth/Firestore/Messaging need API 23+.
        minSdk = maxOf(flutter.minSdkVersion, 23)
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("store") {
            if (keyPropertiesFile.exists()) {
                keyAlias = keyProperties["keyAlias"] as String
                keyPassword = keyProperties["keyPassword"] as String
                storeFile = rootProject.file(keyProperties["storeFile"] as String)
                storePassword = keyProperties["storePassword"] as String
            }
        }
    }

    // Flavor names are read in Dart by asc_common AscBuildFlavor (`appFlavor`).
    // alpha = test options/debug screens, dev = test options/logs,
    // product = store build, claude = builds driven by Claude Code.
    // Same applicationId for all, so google-services.json matches every flavor.
    flavorDimensions += "environment"
    productFlavors {
        create("alpha") {
            dimension = "environment"
            versionNameSuffix = "-alpha"
        }
        create("dev") {
            dimension = "environment"
            versionNameSuffix = "-dev"
        }
        create("product") {
            dimension = "environment"
        }
        create("claude") {
            dimension = "environment"
            versionNameSuffix = "-claude"
        }
    }

    buildTypes {
        release {
            signingConfig = if (keyPropertiesFile.exists()) {
                signingConfigs.getByName("store")
            } else {
                signingConfigs.getByName("debug")
            }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

flutter {
    source = "../.."
}
