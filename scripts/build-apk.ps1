$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AndroidSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\android-build\sdk' }
$JdkCandidates = @(
  'D:\android-build\jdk21\jdk-21.0.12.1+1',
  'D:\Program Files\Android\Android Studio\jbr',
  'D:\Program Files\Java\jdk17'
)
$JavaHome = $JdkCandidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'bin\java.exe') } | Select-Object -First 1
if (-not $JavaHome) { throw 'No JDK found. Install JDK 21 or use Android Studio JBR.' }
if (-not (Test-Path -LiteralPath (Join-Path $AndroidSdk 'platform-tools'))) { throw "Android SDK not found: $AndroidSdk" }

function Update-AndroidManifest {
  param([Parameter(Mandatory = $true)][string]$ManifestPath)

  $content = Get-Content -LiteralPath $ManifestPath -Raw

  # Keep the APK offline-only: Capacitor sync may add INTERNET permission back.
  $content = $content -replace '\r?\n\s*<!-- Permissions -->\s*\r?\n\s*<uses-permission android:name="android\.permission\.INTERNET" />', ''
  $content = $content -replace '\r?\n\s*<uses-permission android:name="android\.permission\.INTERNET"\s*/>', ''

  # Recreate our PDF intent-filter block so repeated builds do not duplicate it.
  $content = [regex]::Replace(
    $content,
    '(?s)\s*<!-- PDF_OPEN_INTENT_FILTERS_START -->.*?<!-- PDF_OPEN_INTENT_FILTERS_END -->',
    ''
  )

  $pdfIntentFilters = @"

            <!-- PDF_OPEN_INTENT_FILTERS_START -->
            <!-- Allows the app to appear in WeChat / file-manager "Open with" for PDF files. -->
            <intent-filter android:label="@string/app_name">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" android:mimeType="application/pdf" />
            </intent-filter>

            <intent-filter android:label="@string/app_name">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="file" android:mimeType="application/pdf" />
            </intent-filter>

            <intent-filter android:label="@string/app_name">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" android:mimeType="application/x-pdf" />
            </intent-filter>

            <intent-filter android:label="@string/app_name">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="file" android:mimeType="application/x-pdf" />
            </intent-filter>

            <intent-filter android:label="@string/app_name">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" android:host="*" android:pathPattern=".*\\.pdf" />
                <data android:scheme="content" android:host="*" android:pathPattern=".*\\.PDF" />
            </intent-filter>

            <intent-filter android:label="@string/app_name">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="file" android:pathPattern=".*\\.pdf" />
                <data android:scheme="file" android:pathPattern=".*\\.PDF" />
            </intent-filter>

            <intent-filter android:label="@string/app_name">
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/x-pdf" />
            </intent-filter>

            <intent-filter android:label="@string/app_name">
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/x-pdf" />
            </intent-filter>
            <!-- PDF_OPEN_INTENT_FILTERS_END -->
"@

  $activityPattern = '(?s)(<activity\b(?=[^>]*android:name="\.MainActivity")(?:(?!</activity>).)*?)(\s*</activity>)'
  $regex = [regex]::new($activityPattern)
  if (-not $regex.IsMatch($content)) {
    throw 'MainActivity not found in AndroidManifest.xml'
  }
  $content = $regex.Replace($content, { param($m) $m.Groups[1].Value + $pdfIntentFilters + $m.Groups[2].Value }, 1)

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($ManifestPath, $content, $utf8NoBom)
}

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidSdk
$env:ANDROID_SDK_ROOT = $AndroidSdk
# Work around Windows/Codex environments where Java Unix-domain loopback pipes fail.
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=Z:\no-such-dir $env:JAVA_TOOL_OPTIONS"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:Path"

Push-Location $ProjectRoot
try {
  npm test
  if ($LASTEXITCODE -ne 0) { throw "npm test failed with exit code $LASTEXITCODE" }
  npx cap sync android
  if ($LASTEXITCODE -ne 0) { throw "capacitor sync failed with exit code $LASTEXITCODE" }

  $manifest = Join-Path $ProjectRoot 'android\app\src\main\AndroidManifest.xml'
  Update-AndroidManifest -ManifestPath $manifest

  Push-Location (Join-Path $ProjectRoot 'android')
  try {
    .\gradlew.bat --no-daemon assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }

  $dist = Join-Path $ProjectRoot 'dist'
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  $srcApk = Join-Path $ProjectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
  $dstApk = Join-Path $dist 'pdf-exam-splitter-v1.3.1-debug.apk'
  $cnName = 'PDF' + [char]0x8BD5 + [char]0x5377 + [char]0x5207 + [char]0x5206 + [char]0x52A9 + [char]0x624B + '-v1.3.1-debug.apk'
  $dstApkCn = Join-Path $dist $cnName
  Copy-Item -LiteralPath $srcApk -Destination $dstApk -Force
  Copy-Item -LiteralPath $srcApk -Destination $dstApkCn -Force
  Write-Host "APK generated: $dstApk"
  Write-Host "APK generated: $dstApkCn"
} finally {
  Pop-Location
}


