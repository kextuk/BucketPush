# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# WorkManager instancie sa base Room générée (WorkDatabase_Impl) par réflexion
# (constructeur sans argument) dès l'init du ContentProvider, avant MainActivity.
# R8 full mode garde la classe mais peut retirer ce constructeur -> crash immédiat
# au premier lancement (NoSuchMethodException: ...WorkDatabase_Impl.<init>).
# Observé avec enableProguardInReleaseBuilds=true le 11/11/2026 ; ces règles sont
# prêtes mais PAS validées - retester sur device réel avant de réactiver R8.
-keep class * extends androidx.room.RoomDatabase
-keepclassmembers class * extends androidx.room.RoomDatabase {
    <init>();
}
-keep class **_Impl {
    <init>();
}
