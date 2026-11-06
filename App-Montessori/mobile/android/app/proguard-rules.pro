# R8 rules for release builds. Flutter's own rules come from the Flutter Gradle plugin.
-keep class com.asc.app_montessori.** { *; }
-keepattributes SourceFile,LineNumberTable
-keep public class * extends java.lang.Exception
