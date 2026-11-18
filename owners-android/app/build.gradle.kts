plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val run = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "com.modaqqeq.owners"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.modaqqeq.owners"
        minSdk = 26
        targetSdk = 34
        versionCode = run
        versionName = "1.0.$run"
    }
    signingConfigs {
        create("release") {
            val ks = System.getenv("OWNERS_KEYSTORE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("OWNERS_KS_PASS")
                keyAlias = "owners"
                keyPassword = System.getenv("OWNERS_KS_PASS")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (System.getenv("OWNERS_KEYSTORE") != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
