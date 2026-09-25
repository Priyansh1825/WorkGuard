@echo off
setlocal
title WorkGuard Master Automated Test Suite

echo ===============================================================================
echo     WORKGUARD ENTERPRISE SUITE - AUTOMATED SYSTEM CERTIFICATION AND AUDIT
echo ===============================================================================
echo.
echo  This diagnostic tool independently verifies every subsystem, database layer,
echo  cryptographic module, and communication protocol without affecting production data.
echo.
echo ===============================================================================
echo.

set FAIL_COUNT=0

echo [1/5] Running SQLite Database Engine and Storage Tests...
node "%~dp0tools\test-database-engine.js"
if errorlevel 1 (
    echo   [FAIL] Database engine test failed!
    set /a FAIL_COUNT+=1
) else (
    echo   [OK] Database engine verified successfully.
)
echo.

echo [2/5] Running Security, Cryptography and Encryption Tests...
node "%~dp0tools\test-security.js"
if errorlevel 1 (
    echo   [FAIL] Security test suite failed!
    set /a FAIL_COUNT+=1
) else (
    echo   [OK] Security and Cryptography layers certified.
)
echo.

echo [3/5] Running Enterprise Subsystems (RBAC, Webhooks and Privacy Shield)...
node "%~dp0tools\test-enterprise-features.js"
if errorlevel 1 (
    echo   [FAIL] Enterprise subsystems test failed!
    set /a FAIL_COUNT+=1
) else (
    echo   [OK] Enterprise subsystems certified.
)
echo.

echo [4/5] Running OTA Remote Update and Cloud Ingestion Tests...
node "%~dp0tools\test-updates.js"
if errorlevel 1 (
    echo   [FAIL] OTA updater test failed!
    set /a FAIL_COUNT+=1
) else (
    echo   [OK] OTA updater engine certified.
)
echo.

echo [5/5] Running Full-Spectrum End-to-End System Integration Test...
node "%~dp0tools\test-system-e2e-all.js"
if errorlevel 1 (
    echo   [FAIL] E2E system test failed!
    set /a FAIL_COUNT+=1
) else (
    echo   [OK] E2E system integration certified.
)
echo.

echo ===============================================================================
if %FAIL_COUNT%==0 (
    echo   ALL TEST SUITES PASSED! 100 PERCENT SYSTEM HEALTH CERTIFIED (0 FAILURES)
    echo.
    echo   Ready for production deployment and handover.
    echo   To test the live user interface visually, run '1-Click-Test-Both.bat'
) else (
    echo   ATTENTION: %FAIL_COUNT% test suite(s) reported issues. Check logs above.
)
echo ===============================================================================
echo.
pause
