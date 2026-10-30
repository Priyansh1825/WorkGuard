# ==============================================================================
# WorkGuard LAN Remote Workstation Reconnect & Health Engine
# Scans company workstations over office LAN and restarts stalled/closed agents.
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$ScanOnly,
    [string]$TargetHost,
    [System.Management.Automation.PSCredential]$Credential
)

$ErrorActionPreference = "Continue"

$KnownStations = @(
    @{ Code = "GEPL00044"; Name = "Bhavin Harshadbhai Patel";   Host = "WORKSTATION-BHAVIN"; AltHost = "";                IP = "" },
    @{ Code = "GEPL00037"; Name = "Apurv Manubhai Parmar";     Host = "WORKSTATION-APURV";  AltHost = "";                IP = "" },
    @{ Code = "GEPL00061"; Name = "Nirav Prajapati";           Host = "WORKSTATION-NIRAV";  AltHost = "";                IP = "" },
    @{ Code = "GEPL00050"; Name = "Aditi Chandragupt Thavrani"; Host = "WORKSTATION-ADITI";  AltHost = "HR";              IP = "" },
    @{ Code = "TEMP10055"; Name = "Nirzara Dineshbhai Patel";   Host = "DESKTOP-A2MRI14";    AltHost = "";                IP = "192.168.2.140" },
    @{ Code = "GEPL00039"; Name = "Nikunjkumar Arvindbhai Parmar"; Host = "DESKTOP-54MP6PJ"; AltHost = "";              IP = "192.168.2.16" },
    @{ Code = "GEPL00056"; Name = "Neel Ashwinbhai Patel";      Host = "WORKSTATION-NEEL";   AltHost = "";                IP = "" },
    @{ Code = "GEPL00054"; Name = "Bhavik G. Patel";           Host = "WORKSTATION-BHAVIK"; AltHost = "";                IP = "" }
)

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " [WorkGuard] LAN Workstation Reconnect Hub" -ForegroundColor Cyan
Write-Host " Scanning office LAN for disconnected workstations..." -ForegroundColor Gray
Write-Host "======================================================================" -ForegroundColor Cyan

# Ensure TrustedHosts allows LAN peers on the local machine
try {
    $currentTh = (Get-Item WSMan:\localhost\Client\TrustedHosts -ErrorAction SilentlyContinue).Value
    if ($currentTh -ne "*") {
        Set-Item WSMan:\localhost\Client\TrustedHosts -Value "*" -Force -ErrorAction SilentlyContinue
    }
} catch {}

# Read current local ARP entries for fast IP discovery
$arpEntries = @{}
try {
    $arpRaw = arp -a
    foreach ($line in ($arpRaw -split "`r?`n")) {
        if ($line -match '(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F-]+)') {
            $arpEntries[$matches[1]] = $matches[2]
        }
    }
} catch {}

$results = @()

function Test-FastSocket($target, $port = 445, $timeoutMs = 600) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect($target, $port, $null, $null)
        $wh = $iar.AsyncWaitHandle
        if ($wh.WaitOne($timeoutMs, $false)) {
            $tcp.EndConnect($iar)
            $tcp.Close()
            return $true
        }
        $tcp.Close()
    } catch {}
    return $false
}

foreach ($st in $KnownStations) {
    if ($TargetHost -and ($st.Host -ne $TargetHost -and $st.AltHost -ne $TargetHost -and $st.Code -ne $TargetHost -and $st.IP -ne $TargetHost)) {
        continue
    }

    Write-Host "`n[$($st.Code)] $($st.Name) ($($st.Host))" -ForegroundColor Yellow

    # Step 1: Probe reachability via DNS, NetBIOS, IP, or ping
    $activeTarget = $null
    $isOnline = $false
    $resolvedIP = $null

    $rawCandidates = @($st.Host, $st.AltHost, $st.IP) | Where-Object { $_ -and $_.Trim() -ne "" }
    $candidates = @()
    foreach ($c in $rawCandidates) {
        $candidates += $c
        if ($c -notmatch '^\d{1,3}\.' -and $c -notmatch '\.local$') {
            $candidates += ($c + ".local")
        }
    }

    foreach ($cand in $candidates) {
        # Try ping
        $pingOk = Test-Connection -ComputerName $cand -Count 1 -Quiet -ErrorAction SilentlyContinue
        if ($pingOk) {
            $activeTarget = $cand
            $isOnline = $true
            try {
                $dns = Resolve-DnsName $cand -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($dns.IP4Address) { $resolvedIP = $dns.IP4Address }
                elseif ($dns.IPAddress) { $resolvedIP = $dns.IPAddress }
            } catch {}
            break
        }

        # Try fast TCP probe on port 445 (SMB) or 135 (RPC) in case ICMP ping is disabled
        if (Test-FastSocket $cand 445 600 -or Test-FastSocket $cand 135 600) {
            $activeTarget = $cand
            $isOnline = $true
            try {
                $dns = Resolve-DnsName $cand -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($dns.IP4Address) { $resolvedIP = $dns.IP4Address }
                elseif ($dns.IPAddress) { $resolvedIP = $dns.IPAddress }
            } catch {}
            break
        }
    }

    if (-not $isOnline) {
        Write-Host "  [-] Status: OFFLINE (PC powered off, sleeping, or not reachable on LAN)" -ForegroundColor Red
        $results += [PSCustomObject]@{
            Code     = $st.Code
            Name     = $st.Name
            Target   = $st.Host
            Status   = "OFFLINE"
            IP       = "-"
            Action   = "Power-on / Network check required"
        }
        continue
    }

    Write-Host "  [+] Status: ONLINE on LAN (Target: $activeTarget $(if ($resolvedIP) { "[$resolvedIP]" }))" -ForegroundColor Green

    if ($ScanOnly) {
        $results += [PSCustomObject]@{
            Code     = $st.Code
            Name     = $st.Name
            Target   = $activeTarget
            Status   = "ONLINE"
            IP       = $resolvedIP
            Action   = "Scan only"
        }
        continue
    }

    # Step 2: Remote Wake-up Waterfall
    $actionTaken = "None"
    $success = $false

    # Method A: Trigger existing Scheduled Task "WorkGuardAgent" via schtasks.exe
    Write-Host "  -> Attempting wake-up via Scheduled Task 'WorkGuardAgent'..." -NoNewline
    $schArgs = @("/s", $activeTarget, "/run", "/tn", "WorkGuardAgent")
    if ($Credential) {
        $schArgs += @("/u", $Credential.UserName, "/p", $Credential.GetNetworkCredential().Password)
    }
    $schOut = & schtasks.exe $schArgs 2>&1
    if ($LASTEXITCODE -eq 0 -or "$schOut" -match "SUCCESS") {
        Write-Host " SUCCESS!" -ForegroundColor Green
        $actionTaken = "Started via Scheduled Task"
        $success = $true
    } else {
        Write-Host " Task trigger unavailable or permission restricted." -ForegroundColor Gray
    }

    # Method B: CIM / DCOM Win32_Process.Create (Windows 11 compatible, bypasses WinRM)
    if (-not $success) {
        Write-Host "  -> Attempting direct process launch via WMI/DCOM..." -NoNewline
        try {
            $sessionOpt = New-CimSessionOption -Protocol Dcom
            $sessionParams = @{
                ComputerName  = $activeTarget
                SessionOption = $sessionOpt
                ErrorAction   = "Stop"
            }
            if ($Credential) { $sessionParams["Credential"] = $Credential }
            $cimSession = New-CimSession @sessionParams

            $cmd = 'cmd.exe /c start "" "%LOCALAPPDATA%\WorkGuard\start-workguard.vbs"'
            $cimRes = Invoke-CimMethod -CimSession $cimSession -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd } -ErrorAction Stop

            if ($cimRes.ReturnValue -eq 0) {
                Write-Host " SUCCESS! (Process ID: $($cimRes.ProcessId))" -ForegroundColor Green
                $actionTaken = "Started via CIM/DCOM (PID $($cimRes.ProcessId))"
                $success = $true
            } else {
                Write-Host " WMI returned code $($cimRes.ReturnValue)" -ForegroundColor Gray
            }
            Remove-CimSession $cimSession -ErrorAction SilentlyContinue
        } catch {
            Write-Host " DCOM connection failed: $($_.Exception.Message)" -ForegroundColor Gray
        }
    }

    # Method C: WinRM Invoke-Command
    if (-not $success) {
        Write-Host "  -> Attempting launch via WinRM..." -NoNewline
        try {
            $invParams = @{
                ComputerName = $activeTarget
                ScriptBlock  = {
                    Start-Process "wscript.exe" -ArgumentList "$env:LOCALAPPDATA\WorkGuard\start-workguard.vbs"
                }
                ErrorAction  = "Stop"
            }
            if ($Credential) { $invParams["Credential"] = $Credential }
            Invoke-Command @invParams
            Write-Host " SUCCESS!" -ForegroundColor Green
            $actionTaken = "Started via WinRM"
            $success = $true
        } catch {
            Write-Host " WinRM unavailable ($($_.Exception.Message))" -ForegroundColor Gray
        }
    }

    if (-not $success) {
        Write-Host "  [!] Remote execution was blocked by Windows security permissions." -ForegroundColor Yellow
        Write-Host "     Tip: If the remote PC has an admin password, re-run with: .\lan-reconnect.ps1 -Credential (Get-Credential)" -ForegroundColor DarkGray
        $actionTaken = "Requires Credential"
    }

    $results += [PSCustomObject]@{
        Code     = $st.Code
        Name     = $st.Name
        Target   = $activeTarget
        Status   = "ONLINE"
        IP       = $resolvedIP
        Action   = $actionTaken
    }
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " SCAN AND RECONNECT SUMMARY REPORT" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
$results | Format-Table -AutoSize -Property Code, Name, Target, Status, IP, Action
Write-Host "======================================================================" -ForegroundColor Cyan

