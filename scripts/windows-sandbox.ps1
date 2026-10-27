# Runs inside a fresh Windows Sandbox. No Node.js, npm or Excel is required.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$inputDirectory = 'C:\PriceListInput'
$outputDirectory = 'C:\PriceListResults'
$installDirectory = 'C:\Тест приложения\Price List'
$executable = Join-Path $installDirectory 'Price List.exe'
$script:sequence = 0
$script:frame = $null
$script:checks = @()
$script:connections = @()
$script:application = $null
Start-Transcript -Path (Join-Path $outputDirectory 'transcript.txt') -Force

function Check($condition, [string]$description) {
    if (-not $condition) {
        throw "FAIL: $description"
    }
    $script:checks += $description
    Write-Output "PASS: $description"
}

function Send-Protocol($socket, [string]$method, $parameters = @{}) {
    $script:sequence++
    $requestId = $script:sequence
    $json = @{ id = $requestId; method = $method; params = $parameters } | ConvertTo-Json -Depth 30 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $deadline = New-Object Threading.CancellationTokenSource
    $deadline.CancelAfter(30000)
    try {
        $null = $socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, $deadline.Token).GetAwaiter().GetResult()
        while ($true) {
            $stream = New-Object IO.MemoryStream
            try {
                do {
                    $buffer = New-Object byte[] 65536
                    $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $deadline.Token).GetAwaiter().GetResult()
                    if ($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) {
                        throw 'Debugger disconnected'
                    }
                    $stream.Write($buffer, 0, $received.Count)
                } until ($received.EndOfMessage)
                $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
            } finally {
                $stream.Dispose()
            }
            if ($message.method -eq 'Debugger.paused') {
                $script:frame = $message.params.callFrames[0].callFrameId
            }
            if ($message.id -eq $requestId) {
                if ($message.error) {
                    throw ($message.error | ConvertTo-Json -Compress)
                }
                return $message.result
            }
        }
    } finally {
        $deadline.Dispose()
    }
}

function Connect-Debugger([int]$port, [bool]$page = $false) {
    for ($attempt = 0; $attempt -lt 200; $attempt++) {
        try {
            $targets = Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 2
            $target = $targets | Where-Object { -not $page -or ($_.type -eq 'page' -and $_.url.StartsWith('file:')) } | Select-Object -First 1
            if ($target) {
                $socket = New-Object Net.WebSockets.ClientWebSocket
                $null = $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
                $script:connections += $socket
                return $socket
            }
        } catch {
            if ($script:application.HasExited) {
                throw 'Application exited while starting'
            }
        }
        Start-Sleep -Milliseconds 100
    }
    throw "Debugger unavailable on port $port"
}

function Evaluate($socket, [string]$expression) {
    $response = Send-Protocol $socket 'Runtime.evaluate' @{ expression = $expression; returnByValue = $true; awaitPromise = $true }
    if ($response.exceptionDetails) {
        throw ($response.exceptionDetails | ConvertTo-Json -Depth 20)
    }
    return $response.result.value
}

function Api([string]$method, $argument = $null) {
    $json = ConvertTo-Json -InputObject $argument -Depth 20 -Compress
    $result = Evaluate $script:renderer "window.api.$method($json)"
    if (-not $result.ok) {
        throw "${method}: $($result.error)"
    }
    return $result.value
}

function Wait-Pause {
    for ($attempt = 0; $attempt -lt 200; $attempt++) {
        # Runtime commands drain debugger events without resuming execution.
        $null = Send-Protocol $script:main 'Runtime.enable'
        if ($script:frame) {
            return
        }
        Start-Sleep -Milliseconds 50
    }
    throw 'Debugger did not pause at application entry'
}

function Start-Application {
    $script:application = Start-Process -FilePath $executable -ArgumentList '--inspect-brk=127.0.0.1:19229', '--remote-debugging-port=19230', '--remote-debugging-address=127.0.0.1' -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $outputDirectory 'electron-stderr.txt')
    # Keep a process handle open so Windows PowerShell can read ExitCode later.
    $null = $script:application.Handle
    $script:main = Connect-Debugger 19229
    $null = Send-Protocol $script:main 'Debugger.enable'
    $null = Send-Protocol $script:main 'Debugger.setBreakpointByUrl' @{ urlRegex = '[/\\]out[/\\]main[/\\]main\.js$'; lineNumber = 0 }
    $null = Send-Protocol $script:main 'Runtime.runIfWaitingForDebugger'
    Wait-Pause
    $script:frame = $null
    $null = Send-Protocol $script:main 'Debugger.resume'
    Wait-Pause
    Check ([bool]$script:frame) 'Main entry point reached'
    $binding = Send-Protocol $script:main 'Debugger.evaluateOnCallFrame' @{ callFrameId = $script:frame; expression = 'globalThis.__validation = {app, BrowserWindow, dialog}; undefined'; returnByValue = $true }
    if ($binding.exceptionDetails) {
        throw ($binding.exceptionDetails | ConvertTo-Json -Depth 10)
    }
    $null = Send-Protocol $script:main 'Debugger.disable'
    $script:renderer = Connect-Debugger 19230 $true
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        if (Evaluate $script:renderer "Boolean(window.api) && document.readyState === 'complete' && Boolean(document.querySelector('button'))") {
            return
        }
        Start-Sleep -Milliseconds 100
    }
    throw 'Renderer did not load'
}

function Close-Application {
    $null = Evaluate $script:main '__validation.BrowserWindow.getAllWindows()[0].close()'
    # Node waits for the inspector to disconnect before completing shutdown.
    foreach ($connection in $script:connections) {
        $connection.Dispose()
    }
    $script:connections = @()
    Check ($script:application.WaitForExit(15000)) 'Application closes normally'
    Write-Output "Application exit code: $($script:application.ExitCode)"
    Check ($script:application.ExitCode -eq 0) 'Application exit code is zero'
    $script:application = $null
    $script:frame = $null
}

function Open-Table([string]$path, [string]$delimiter = ',') {
    $encoded = ConvertTo-Json -InputObject $path -Compress
    $null = Evaluate $script:main "__validation.dialog.showOpenDialog = async () => ({canceled:false,filePaths:[$encoded]})"
    $source = Api 'openFile'
    $sheet = ''
    if ($source.sheets.Count -gt 0) {
        $sheet = $source.sheets[0]
    }
    return Api 'importTable' @{ source = 'file'; sourceId = $source.id; options = @{ delimiter = $delimiter; encoding = 'utf-8'; sheet = $sheet; headerRow = 1 } }
}

function Uninstall-Entries {
    return @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Price List' })
}

try {
    $os = Get-CimInstance Win32_OperatingSystem
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $environment = @{
        os = $os.Caption; version = $os.Version; build = $os.BuildNumber
        user = $identity.Name; administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        nodePresent = [bool](Get-Command node -ErrorAction SilentlyContinue)
        npmPresent = [bool](Get-Command npm -ErrorAction SilentlyContinue)
        excelPresent = [bool](Test-Path 'Registry::HKEY_CLASSES_ROOT\Excel.Application')
        started = (Get-Date).ToString('o')
    }
    $environment | ConvertTo-Json | Set-Content (Join-Path $outputDirectory 'environment.json') -Encoding UTF8
    Check (-not $environment.nodePresent -and -not $environment.npmPresent -and -not $environment.excelPresent) 'Clean guest: no Node.js, npm or Excel'
    Check (-not (Test-Path $installDirectory)) 'No previous installation'
    Check ((Uninstall-Entries).Count -eq 0) 'No previous uninstall registration'
    $installer = Join-Path $inputDirectory 'Setup.exe'
    $hash = (Get-FileHash $installer -Algorithm SHA256).Hash
    Check ($hash -eq (Get-Content (Join-Path $inputDirectory 'sha256.txt')).Trim()) 'Installer SHA256 matches host'
    $setup = Start-Process $installer -ArgumentList "/S /currentuser /D=$installDirectory" -Wait -PassThru -WindowStyle Hidden
    Check ($setup.ExitCode -eq 0) 'NSIS installation succeeded'
    Check (Test-Path $executable) 'Executable installed to a path with spaces and Cyrillic'
    $entries = @(Uninstall-Entries)
    Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*Price*' } | Select-Object DisplayName,DisplayVersion,PSPath,UninstallString | ConvertTo-Json | Set-Content (Join-Path $outputDirectory 'registration.json') -Encoding UTF8
    Check ($entries.Count -eq 1 -and $entries[0].DisplayVersion -eq '1.0.0') 'Per-user uninstall registration and version'
    $shortcuts = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Price List.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Price List.lnk'))
    $shell = New-Object -ComObject WScript.Shell
    foreach ($shortcut in $shortcuts) {
        Check (Test-Path $shortcut) "Shortcut exists: $shortcut"
        Check ($shell.CreateShortcut($shortcut).TargetPath -eq $executable) 'Shortcut points to installed executable'
    }
    Start-Application
    $metadata = Evaluate $script:main '({packaged:__validation.app.isPackaged,version:__validation.app.getVersion(),userData:__validation.app.getPath("userData")})'
    Check ($metadata.packaged -and $metadata.version -eq '1.0.0') 'Installed production application and renderer start offline'
    Check ((Evaluate $script:renderer 'typeof window.require') -eq 'undefined') 'Renderer Node integration is disabled'
    $screenshot = Send-Protocol $script:renderer 'Page.captureScreenshot' @{ format = 'png' }
    [IO.File]::WriteAllBytes((Join-Path $outputDirectory 'installed-app.png'), [Convert]::FromBase64String($screenshot.data))
    $table = Open-Table (Join-Path $inputDirectory 'samples\csv\supplier-basic.csv')
    Check ($table.totalRows -eq 10 -and $table.rows[0][0] -eq '001') 'CSV imports ten products and preserves leading zeroes'
    $mapping = @{sku = 0; name = 1; price = 2}
    $profile = Api 'saveProfile' @{name = 'Поставщик — Sandbox'; importId = $table.id; mapping = $mapping; settings = @{markup = 20}}
    $profileId = $profile.activeProfileId
    $processed = Api 'processTable' @{importId = $table.id; mapping = $mapping; markup = 20}
    Check ($processed.productCount -eq 10 -and $processed.errorCount -eq 0) 'Installed worker processes ten products'
    $exportDirectory = 'C:\Результаты проверки'
    $null = New-Item -ItemType Directory -Path $exportDirectory -Force
    foreach ($format in @('csv', 'xlsx')) {
        $path = Join-Path $exportDirectory "Прайс.$format"
        $encoded = ConvertTo-Json -InputObject $path -Compress
        $null = Evaluate $script:main "__validation.dialog.showSaveDialog = async () => ({canceled:false,filePath:$encoded})"
        $exported = Api 'exportTable' @{resultId = $processed.id; format = $format}
        Check (-not $exported.canceled -and $exported.count -eq 10 -and (Get-Item $path).Length -gt 0) "$format export to Cyrillic path"
    }
    foreach ($format in @('csv', 'xlsx')) {
        $roundtrip = Open-Table (Join-Path $exportDirectory "Прайс.$format") ';'
        Check ($roundtrip.totalRows -eq 10 -and $roundtrip.rows[0][0] -eq '001' -and [decimal]$roundtrip.rows[0][2] -eq 144) "$format roundtrip: ten products, SKU 001, price 144"
        Check (($roundtrip.columns -join '|') -eq 'Артикул|Наименование|Цена') "$format Russian export headers"
    }
    $xlsx = Open-Table (Join-Path $inputDirectory 'samples\xlsx\supplier-basic.xlsx')
    Check ($xlsx.totalRows -eq 3 -and $xlsx.rows[0][0] -eq '000001') 'Supplier XLSX imports with leading zeroes'
    Check (@(Get-ChildItem $exportDirectory -Filter '*.tmp').Count -eq 0) 'No temporary export files remain'
    Close-Application
    Start-Application
    $restored = Api 'getProfiles'
    Check ($restored.activeProfileId -eq $profileId -and $restored.profiles[0].settings.markup -eq 20) 'Profile survives normal close and restart'
    Close-Application
    $profilePath = Join-Path $metadata.userData 'profiles.json'
    Check (Test-Path $profilePath) 'Profile persisted on disk'
    $profileHash = (Get-FileHash $profilePath).Hash
    $exports = @(Get-ChildItem $exportDirectory | ForEach-Object { @{path = $_.FullName; hash = (Get-FileHash $_.FullName).Hash} })
    Copy-Item "$exportDirectory\*" $outputDirectory
    $uninstaller = Join-Path $installDirectory 'Uninstall Price List.exe'
    Check (Test-Path $uninstaller) 'Uninstaller exists'
    $null = Start-Process $uninstaller -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 150; $attempt++) {
        if (-not (Test-Path $executable) -and (Uninstall-Entries).Count -eq 0) {
            break
        }
        Start-Sleep -Milliseconds 200
    }
    Check (-not (Test-Path $executable)) 'Uninstaller removed the executable'
    Check ((Uninstall-Entries).Count -eq 0) 'Uninstaller removed its registry entry'
    foreach ($shortcut in $shortcuts) {
        Check (-not (Test-Path $shortcut)) 'Uninstaller removed shortcut'
    }
    Check ((Get-FileHash $profilePath).Hash -eq $profileHash) 'Uninstall preserves profiles'
    foreach ($export in $exports) {
        Check ((Get-FileHash $export.path).Hash -eq $export.hash) 'Uninstall preserves exported files'
    }
    @{passed = $true; checks = $script:checks; installerSha256 = $hash; environment = $environment; installDirectory = $installDirectory; finished = (Get-Date).ToString('o')} | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $outputDirectory 'result.json') -Encoding UTF8
} catch {
    $_ | Out-String | Write-Output
    @{passed = $false; checks = $script:checks; error = $_.ToString(); detail = $_.ScriptStackTrace} | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $outputDirectory 'result.json') -Encoding UTF8
} finally {
    foreach ($connection in $script:connections) {
        $connection.Dispose()
    }
    if ($script:application -and -not $script:application.HasExited) {
        $script:application.Kill()
    }
    Stop-Transcript
}
