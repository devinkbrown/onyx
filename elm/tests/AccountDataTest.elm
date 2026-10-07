module AccountDataTest exposing (suite)

{-| Vectors for the Account data verbs, mirroring
`src/lib/export/accountDataVerbs.ts`: the export scrubber, filename
safety, founder/owner room ownership over the client roster, the
account store record, and the device history copy (tail-kept,
never re-importable). The DOM download and the vault dump stay behind
ports.
-}

import App exposing (..)
import Dict
import Expect
import Set
import Test exposing (Test, describe, test)


ownedChannel : String -> List ( String, List Char ) -> Channel
ownedChannel name members =
    { name = name
    , topic = ""
    , members =
        Dict.fromList
            (List.map
                (\( nick, modes ) ->
                    ( String.toLower nick
                    , { nick = nick, modes = Set.fromList modes, away = False }
                    )
                )
                members
            )
    , modes = ""
    , messages = []
    , lastSeen = Nothing
    , unread = 0
    , highlights = 0
    , createdAt = Nothing
    }


suite : Test
suite =
    describe "account data verbs"
        [ describe "scrubExportText"
            [ test "strips controls but keeps newlines" <|
                \_ -> Expect.equal "a\nb" (scrubExportText "a\u{0000}\nb\u{007F}" 8192)
            , test "truncates to max" <|
                \_ -> Expect.equal "abc" (scrubExportText "abcdef" 3)
            ]
        , describe "safeExportFilenamePart"
            [ test "replaces hostile chars" <|
                \_ -> Expect.equal "a_b_c" (safeExportFilenamePart "a/b:c")
            , test "empty falls back to file" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "___" (safeExportFilenamePart "///")
                        , \_ -> Expect.equal "file" (safeExportFilenamePart "")
                        ]
                        ()
            ]
        , describe "roomsOwnedByNick"
            [ test "founder and owner count, ops do not" <|
                \_ ->
                    let
                        rooms =
                            [ ownedChannel "#a" [ ( "kai", [ 'Q' ] ) ]
                            , ownedChannel "#b" [ ( "kai", [ 'q' ] ) ]
                            , ownedChannel "#c" [ ( "kai", [ 'o' ] ) ]
                            ]
                    in
                    Expect.equal [ "#a", "#b" ] (roomsOwnedByNick rooms "Kai")
            , test "empty nick owns nothing" <|
                \_ -> Expect.equal [] (roomsOwnedByNick [ ownedChannel "#a" [ ( "kai", [ 'Q' ] ) ] ] "  ")
            , test "duplicate names dedupe case-insensitively" <|
                \_ ->
                    Expect.equal [ "#a" ]
                        (roomsOwnedByNick
                            [ ownedChannel "#a" [ ( "kai", [ 'Q' ] ) ]
                            , ownedChannel "#A" [ ( "kai", [ 'q' ] ) ]
                            ]
                            "kai"
                        )
            ]
        , describe "buildAccountStoreRecord"
            [ test "account falls back to nick; email omitted when blank" <|
                \_ ->
                    let
                        record =
                            buildAccountStoreRecord
                                { nick = Just "kai"
                                , account = Nothing
                                , email = Just "   "
                                , registeredAt = Nothing
                                , rooms = [ ownedChannel "#a" [ ( "kai", [ 'Q' ] ) ] ]
                                , exportedAt = "2026-01-02T03:04:05.000Z"
                                }
                    in
                    Expect.all
                        [ \_ -> Expect.equal "kai" record.account
                        , \_ -> Expect.equal Nothing record.email
                        , \_ -> Expect.equal [ "#a" ] record.roomsOwned
                        , \_ -> Expect.equal accountStoreRecordKind record.kind
                        , \_ -> Expect.equal 1 record.version
                        ]
                        ()
            , test "control bytes scrub out of fields" <|
                \_ ->
                    let
                        record =
                            buildAccountStoreRecord
                                { nick = Just "k\na\ri"
                                , account = Just "k\na\ri"
                                , email = Nothing
                                , registeredAt = Nothing
                                , rooms = []
                                , exportedAt = "2026-01-02T03:04:05.000Z"
                                }
                    in
                    -- Newlines survive the export scrubber (only
                    -- C0-without-whitespace, DEL strip).
                    Expect.equal "k\na\ri" record.nick
            ]
        , describe "buildDeviceHistoryCopy"
            [ test "keeps the tail and counts honestly" <|
                \_ ->
                    let
                        rows =
                            List.map
                                (\n ->
                                    { id = "m" ++ String.fromInt n
                                    , at = 0
                                    , from = "kai"
                                    , kind = "msg"
                                    , body = "hello"
                                    }
                                )
                                (List.range 1 5)

                        copy =
                            buildDeviceHistoryCopy "2026-01-02T03:04:05.000Z" 2 [ { target = "#a", rows = rows } ]
                    in
                    case copy.rooms of
                        [ room ] ->
                            Expect.all
                                [ \_ -> Expect.equal 2 room.messageCount
                                , \_ -> Expect.equal [ "m4", "m5" ] (List.map .id room.messages)
                                , \_ -> Expect.equal False copy.reimportable
                                , \_ -> Expect.equal 2 copy.keepPerRoom
                                ]
                                ()

                        _ ->
                            Expect.fail "expected one room"
            , test "vault rows copy as msg kind with iso time" <|
                \_ ->
                    let
                        message =
                            copyHistoryMessage
                                (vaultRowHistorySource
                                    { id = "r1", target = "#a", from = "kai", body = "hi", at = 0, rowType = "msg", deleted = False, redacted = False }
                                )
                    in
                    Expect.all
                        [ \_ -> Expect.equal "msg" message.type_
                        , \_ -> Expect.equal "1970-01-01T00:00:00.000Z" message.time
                        ]
                        ()
            ]
        , describe "verbs machinery"
            [ test "record download dispatches with status" <|
                \_ ->
                    let
                        model =
                            { blank
                                | ourNick = "kai"
                                , nowMs = 1000
                                , channels =
                                    Dict.fromList
                                        [ ( "#a", ownedChannel "#a" [ ( "kai", [ 'Q' ] ) ] ) ]
                            }

                        ( done, outs ) =
                            update DownloadAccountRecord model
                    in
                    Expect.all
                        [ \_ -> Expect.equal "Downloaded the account record." done.accountVerbsStatus
                        , \_ ->
                            case outs of
                                [ AccountDownload req ] ->
                                    Expect.all
                                        [ \_ -> Expect.equal True (String.startsWith "onyx-account-record-kai-" req.filename)
                                        , \_ -> Expect.equal True (String.contains "\"kind\": \"onyx.account-store-record\"" req.json)
                                        , \_ -> Expect.equal True (String.contains "#a" req.json)
                                        , \_ -> Expect.equal False (String.contains "\"email\"" req.json)
                                        , \_ -> Expect.equal True (String.endsWith "\n" req.json)
                                        ]
                                        ()

                                _ ->
                                    Expect.fail "expected one download"
                        ]
                        ()
            , test "record download respects busy" <|
                \_ ->
                    let
                        ( idle, outs ) =
                            update DownloadAccountRecord { blank | accountVerbsBusy = Just AccountHistoryBusy }
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] outs
                        , \_ -> Expect.equal "" idle.accountVerbsStatus
                        ]
                        ()
            , test "history request arms the single flight" <|
                \_ ->
                    let
                        ( armed, outs ) =
                            update DownloadDeviceHistory blank

                        ( again, againOuts ) =
                            update DownloadDeviceHistory armed
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just AccountHistoryBusy) armed.accountVerbsBusy
                        , \_ -> Expect.equal 1 armed.accountVerbsSeq
                        , \_ -> Expect.equal [ DeviceHistoryCopyRequest { seq = 1 } ] outs
                        , \_ -> Expect.equal [] againOuts
                        ]
                        ()
            , test "history rows land the copy download" <|
                \_ ->
                    let
                        ( armed, _ ) =
                            update DownloadDeviceHistory blank

                        ( done, outs ) =
                            update
                                (DeviceHistoryRowsReceived
                                    { seq = 1
                                    , exportedAt = "2026-01-02T03:04:05.000Z"
                                    , json = "[{\"target\":\"#a\",\"rows\":[{\"id\":\"m1\",\"at\":0,\"from\":\"kai\",\"body\":\"hi\"}]}]"
                                    }
                                )
                                armed
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing done.accountVerbsBusy
                        , \_ -> Expect.equal "Saved this device's history." done.accountVerbsStatus
                        , \_ ->
                            case outs of
                                [ AccountDownload req ] ->
                                    Expect.all
                                        [ \_ -> Expect.equal "onyx-device-history-2026-01-02.json" req.filename
                                        , \_ -> Expect.equal True (String.contains "\"kind\": \"onyx.device-history-copy\"" req.json)
                                        , \_ -> Expect.equal True (String.contains "\"id\": \"m1\"" req.json)
                                        ]
                                        ()

                                _ ->
                                    Expect.fail "expected one download"
                        ]
                        ()
            , test "stale history rows are ignored" <|
                \_ ->
                    let
                        ( armed, _ ) =
                            update DownloadDeviceHistory blank

                        ( kept, outs ) =
                            update
                                (DeviceHistoryRowsReceived { seq = 7, exportedAt = "", json = "[]" })
                                armed
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just AccountHistoryBusy) kept.accountVerbsBusy
                        , \_ -> Expect.equal [] outs
                        ]
                        ()
            , test "undecodable rows report failure" <|
                \_ ->
                    let
                        ( armed, _ ) =
                            update DownloadDeviceHistory blank

                        ( failed, outs ) =
                            update
                                (DeviceHistoryRowsReceived { seq = 1, exportedAt = "", json = "nope" })
                                armed
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing failed.accountVerbsBusy
                        , \_ -> Expect.equal "Could not save this device's history." failed.accountVerbsStatus
                        , \_ -> Expect.equal [] outs
                        ]
                        ()
            , test "history copy encodes the full shape" <|
                \_ ->
                    let
                        json =
                            encodeDeviceHistoryCopy
                                (buildDeviceHistoryCopy "2026-01-02T03:04:05.000Z"
                                    400
                                    [ { target = "#a"
                                      , rows =
                                            [ { id = "m1", at = 0, from = "kai", kind = "msg", body = "hi" } ]
                                      }
                                    ]
                                )
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (String.contains "\"reimportable\": false" json)
                        , \_ -> Expect.equal True (String.contains "\"keepPerRoom\": 400" json)
                        , \_ -> Expect.equal True (String.contains "\"messageCount\": 1" json)
                        ]
                        ()
            ]
        , describe "filenames"
            [ test "account record names who and day" <|
                \_ ->
                    Expect.equal "onyx-account-record-kai-2026-01-02.json"
                        (accountStoreRecordFilename
                            (buildAccountStoreRecord
                                { nick = Just "kai"
                                , account = Nothing
                                , email = Nothing
                                , registeredAt = Nothing
                                , rooms = []
                                , exportedAt = "2026-01-02T03:04:05.000Z"
                                }
                            )
                        )
            , test "history copy names the day" <|
                \_ ->
                    Expect.equal "onyx-device-history-2026-01-02.json"
                        (deviceHistoryCopyFilename
                            (buildDeviceHistoryCopy "2026-01-02T03:04:05.000Z" 400 [])
                        )
            ]
        ]
