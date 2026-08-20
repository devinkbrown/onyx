/* GROK_OWNED_SOURCE_SLOT: Win11 Advapi32 SaferRecordEventLogEntry
 * Oracle SHA256=1fadfb87252207ce5ccbbdd1ed8ed22c310c2bb73140dcb0e2a9764a97a48abd
 * RVA=0x37f80  ENTRY=0x180037f80  (also export SaferiRecordEventLogEntry same leaf)
 * Decompile SHA256=9813a7b5780a1f3aabb840adecda9af3c57fa2ee23e3aba0c5d50cc7359fe44a
 * Evidence: build-re/decompile/WIN11-x64/advapi32/SaferRecordEventLogEntry.c
 *           DECOMP_STATUS=COMPLETE
 *
 * Oracle body:
 *   1. HeapAlloc(GetProcessHeap, HEAP_ZERO_MEMORY=8, 0x4c0); fail → FALSE
 *   2. buffer[1] (DWORD @ +4) = 0x20
 *   3. GetInformationCodeAuthzLevelW(hLevel, 0xf, buf, 0x4c0, &need)
 *      On fail with GetLastError==8: free, realloc need, retry once.
 *   4. Compare GUID at buf+8 against three oracle .rdata GUIDs
 *      (RVA 0x870e8 / 0x870d8 / 0x870c8) and select NTSTATUS + optional GUID
 *      argument for write helper.
 *   5. OnyxSaferWriteEventLogEntry @ RVA 0x381ac (opaque private CALL).
 *   6. HeapFree; return (helper==0) as BOOL success.
 *
 * Oracle GUID block @ RVA 0x870c8 (three consecutive 16-byte GUIDs):
 *   {C71B5435-1293-4848-B0A3-B53066C76CA2}
 *   {11015445-D282-4F86-96A2-9E485F593302}
 *   {C59E7B5A-AF71-4595-B8DB-46B491E89007}
 *
 * Global flag dword @ .data RVA 0xa1198 bit 0x2000 adjusts one NTSTATUS path.
 *
 * FOLLOW-UP: GetInformationCodeAuthzLevelW is a separate export; helper 0x381ac
 * and full Safer level buffer layout fidelity need the Safer helper wave.
 */

#ifndef ONYX_WIN11_SAFER_RECORD_EVENT_LOG_ENTRY_EXPORT
#error "ONYX_WIN11_SAFER_RECORD_EVENT_LOG_ENTRY_EXPORT required"
#endif

#include "eventlog_internal.h"
#include <winsafer.h>
#include <evntprov.h>

/* Oracle .rdata GUIDs (byte-exact from advapi32.dll @ 0x870c8). */
static const GUID OnyxSaferGuid_870c8 = {
    0xC71B5435, 0x1293, 0x4848,
    { 0xB0, 0xA3, 0xB5, 0x30, 0x66, 0xC7, 0x6C, 0xA2 }
};
static const GUID OnyxSaferGuid_870d8 = {
    0x11015445, 0xD282, 0x4F86,
    { 0x96, 0xA2, 0x9E, 0x48, 0x5F, 0x59, 0x33, 0x02 }
};
static const GUID OnyxSaferGuid_870e8 = {
    0xC59E7B5A, 0xAF71, 0x4595,
    { 0xB8, 0xDB, 0x46, 0xB4, 0x91, 0xE8, 0x90, 0x07 }
};

/* Oracle .data flag dword @ RVA 0xa1198 */
volatile DWORD *OnyxSaferEffectiveFlagsSlot(VOID);

ULONG NTAPI EtwEventRegister(LPCGUID, PENABLECALLBACK, PVOID, PREGHANDLE);
ULONG NTAPI EtwEventWrite(REGHANDLE, PCEVENT_DESCRIPTOR, ULONG,
                          PEVENT_DATA_DESCRIPTOR);
VOID OnyxSaferEnterCs(VOID);
VOID OnyxSaferLeaveCs(VOID);

static const GUID OnyxSaferEtwProviderGuid = {
    0x7D29D58A, 0x931A, 0x40AC,
    { 0x87, 0x43, 0x48, 0xC7, 0x33, 0x04, 0x55, 0x48 }
};
static const EVENT_DESCRIPTOR OnyxSaferEvt0362 =
    { 0x0362, 0, 9, 3, 0, 0, 0x8000000000000000ULL };
static const EVENT_DESCRIPTOR OnyxSaferEvt0364 =
    { 0x0364, 0, 9, 3, 0, 0, 0x8000000000000000ULL };
static const EVENT_DESCRIPTOR OnyxSaferEvt0032 =
    { 0x0032, 0, 9, 4, 0, 0, 0x8000000000000000ULL };
static const EVENT_DESCRIPTOR OnyxSaferEvt0372 =
    { 0x0372, 0, 9, 3, 0, 0, 0x8000000000000000ULL };
static const EVENT_DESCRIPTOR OnyxSaferEvt0361 =
    { 0x0361, 0, 9, 3, 0, 0, 0x8000000000000000ULL };
static REGHANDLE OnyxSaferEtwRegHandle;

static ULONG
OnyxSaferWideBytes(_In_ PCWSTR String)
{
    ULONG Characters = 0;

    while (String[Characters] != UNICODE_NULL)
        Characters++;
    return Characters * sizeof(WCHAR) + sizeof(WCHAR);
}

NTSTATUS
NTAPI
OnyxSaferWriteEventLogEntry(
    _In_ ULONG NtStatusCode,
    _In_opt_ PCWSTR TargetPath,
    _In_opt_ const GUID *LevelGuid,
    _In_opt_ PVOID Extra)
{
    EVENT_DATA_DESCRIPTOR Data[3] = {{0}};
    PCEVENT_DESCRIPTOR Descriptor;
    ULONG Count;
    NTSTATUS Status = STATUS_SUCCESS;

    OnyxSaferEnterCs();
    if (OnyxSaferEtwRegHandle == 0)
        Status = (NTSTATUS)EtwEventRegister(&OnyxSaferEtwProviderGuid, NULL,
                                            NULL, &OnyxSaferEtwRegHandle);
    OnyxSaferLeaveCs();
    if (!NT_SUCCESS(Status))
        return Status;

    switch (NtStatusCode)
    {
        case 0xC0000361u:
        case 0xC0000363u:
            Descriptor = &OnyxSaferEvt0361;
            Count = 1;
            break;
        case 0xC0000362u:
            Descriptor = &OnyxSaferEvt0362;
            Count = 3;
            break;
        case 0xC0000364u:
            Descriptor = &OnyxSaferEvt0364;
            Count = 2;
            break;
        case 0xC0000372u:
            Descriptor = &OnyxSaferEvt0372;
            Count = 2;
            break;
        case 0x40000032u:
            Descriptor = &OnyxSaferEvt0032;
            Count = 2;
            break;
        default:
            return STATUS_INVALID_PARAMETER;
    }

    if (TargetPath == NULL || (Count >= 2 && LevelGuid == NULL) ||
        (Count == 3 && Extra == NULL))
        return Status;

    EventDataDescCreate(&Data[0], TargetPath, OnyxSaferWideBytes(TargetPath));
    if (Count >= 2)
        EventDataDescCreate(&Data[1], LevelGuid, sizeof(*LevelGuid));
    if (Count == 3)
        EventDataDescCreate(&Data[2], Extra, OnyxSaferWideBytes((PCWSTR)Extra));

    (void)EtwEventWrite(OnyxSaferEtwRegHandle, Descriptor, Count, Data);
    return Status;
}

static BOOL
OnyxGuidEqual(
    _In_ const GUID *A,
    _In_ const GUID *B)
{
    return (A->Data1 == B->Data1) &&
           (A->Data2 == B->Data2) &&
           (A->Data3 == B->Data3) &&
           (A->Data4[0] == B->Data4[0]) &&
           (A->Data4[1] == B->Data4[1]) &&
           (A->Data4[2] == B->Data4[2]) &&
           (A->Data4[3] == B->Data4[3]) &&
           (A->Data4[4] == B->Data4[4]) &&
           (A->Data4[5] == B->Data4[5]) &&
           (A->Data4[6] == B->Data4[6]) &&
           (A->Data4[7] == B->Data4[7]);
}

BOOL
WINAPI
SaferRecordEventLogEntry(
    _In_ SAFER_LEVEL_HANDLE hLevel,
    _In_ PCWSTR szTargetPath,
    _Reserved_ PVOID pReserved)
{
    DWORD Need;
    int *Buf;
    BOOL Ok;
    BOOL QueryOk;
    ULONG NtCode;
    const GUID *GuidArg;
    PVOID Extra;
    GUID *LevelGuid;

    (void)pReserved;

    Need = 0x4c0;
    Buf = (int *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, Need);
    Ok = FALSE;
    if (Buf == NULL)
    {
        return FALSE;
    }

    Buf[1] = 0x20;
    QueryOk = GetInformationCodeAuthzLevelW(
        hLevel,
        0xf,
        Buf,
        Need,
        &Need);
    if (!QueryOk)
    {
        if (GetLastError() != ERROR_NOT_ENOUGH_MEMORY)
        {
            goto free_out;
        }
        HeapFree(GetProcessHeap(), 0, Buf);
        Buf = (int *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, Need);
        if (Buf == NULL)
        {
            return FALSE;
        }
        Buf[1] = 0x20;
        QueryOk = GetInformationCodeAuthzLevelW(
            hLevel,
            0xf,
            Buf,
            Need,
            &Need);
        if (!QueryOk)
        {
            goto free_out;
        }
    }

    /* GUID lives at Buf+2 DWORDs → offset +8. */
    LevelGuid = (GUID *)(Buf + 2);
    GuidArg = LevelGuid;
    Extra = NULL;

    if (OnyxGuidEqual(LevelGuid, &OnyxSaferGuid_870e8))
    {
        GuidArg = NULL;
        NtCode = 0xC0000363;
        Ok = (OnyxSaferWriteEventLogEntry(NtCode, szTargetPath, GuidArg, Extra) == 0);
        goto free_out;
    }

    if (OnyxGuidEqual(LevelGuid, &OnyxSaferGuid_870d8))
    {
        GuidArg = &OnyxSaferGuid_870d8;
        NtCode = 0xC0000361;
        if ((*OnyxSaferEffectiveFlagsSlot() & 0x2000) != 0)
        {
            NtCode = 0xC0000361 + 0x11;
        }
        Ok = (OnyxSaferWriteEventLogEntry(NtCode, szTargetPath, GuidArg, Extra) == 0);
        goto free_out;
    }

    if (OnyxGuidEqual(LevelGuid, &OnyxSaferGuid_870c8))
    {
        /* Oracle: match → iVar2 = 0 success without write helper. */
        Ok = TRUE;
        goto free_out;
    }

    if (Buf[0] != 1)
    {
        NtCode = 0xC0000364;
        if ((Buf[0] == 2) && ((Buf[0x11c] & 0x2000) != 0))
        {
            NtCode = 0xC0000372;
        }
        Ok = (OnyxSaferWriteEventLogEntry(NtCode, szTargetPath, GuidArg, Extra) == 0);
        goto free_out;
    }

    /* Buf[0]==1 path: Extra from Buf+0x88 dwords; NtCode from Buf[0x8a]. */
    Extra = *(PVOID *)(Buf + 0x88);
    NtCode = (((ULONG)Buf[0x8a] >> 9) & 0x10) | 0xC0000362;
    Ok = (OnyxSaferWriteEventLogEntry(NtCode, szTargetPath, GuidArg, Extra) == 0);

free_out:
    HeapFree(GetProcessHeap(), 0, Buf);
    return Ok;
}

/*
 * SaferiRecordEventLogEntry — oracle ordinal 1732, same leaf RVA 0x37f80
 * as SaferRecordEventLogEntry (ordinal 1724). Thin alias; not a second body.
 */
BOOL
WINAPI
SaferiRecordEventLogEntry(
    _In_ SAFER_LEVEL_HANDLE hLevel,
    _In_ PCWSTR szTargetPath,
    _Reserved_ PVOID pReserved)
{
    return SaferRecordEventLogEntry(hLevel, szTargetPath, pReserved);
}
