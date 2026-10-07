module ScheduleTest exposing (suite)

{-| Vectors for the scheduled-message queue core, mirroring
`src/lib/schedule/dispatch.test.ts`,
`src/lib/composer/scheduledSend.test.ts`, and
`src/lib/store/store.scheduled.test.ts` (parse guards, due split,
enqueue/cancel, classify, create).
-}

import Expect
import Json.Encode as Encode
import Schedule exposing (..)
import Test exposing (Test, describe, test)


row : List ( String, Encode.Value ) -> Encode.Value
row fields =
    Encode.object fields


validRow : Encode.Value
validRow =
    row
        [ ( "id", Encode.string "s1" )
        , ( "channel", Encode.string "#c" )
        , ( "text", Encode.string "hello" )
        , ( "sendAt", Encode.int 1700000000000 )
        ]


suite : Test
suite =
    describe "Schedule"
        [ describe "decodeScheduledMessages"
            [ test "junk inputs decode to empty" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal [] (decodeScheduledMessages (Encode.string "null"))
                        , \_ -> Expect.equal [] (decodeScheduledMessages (Encode.list identity []))
                        , \_ -> Expect.equal [] (decodeScheduledMessages (Encode.object []))
                        , \_ -> Expect.equal [] (decodeScheduledMessages (Encode.list identity [ Encode.int 1 ]))
                        , \_ -> Expect.equal [] (decodeScheduledMessages (Encode.string "not json"))
                        ]
                        ()
            , test "a valid row decodes exactly" <|
                \_ ->
                    Expect.equal
                        [ { id = "s1"
                          , channel = "#c"
                          , text = "hello"
                          , sendAt = 1700000000000
                          , owner = Nothing
                          , claim = Nothing
                          , generation = Nothing
                          , clearEpoch = Nothing
                          }
                        ]
                        (decodeScheduledMessages (Encode.list identity [ validRow ]))
            , test "bad ids drop the row, first id wins" <|
                \_ ->
                    let
                        withId id =
                            row
                                [ ( "id", Encode.string id )
                                , ( "channel", Encode.string "#c" )
                                , ( "text", Encode.string "hi" )
                                , ( "sendAt", Encode.int 10 )
                                ]

                        decoded =
                            decodeScheduledMessages
                                (Encode.list identity
                                    [ withId ""
                                    , withId (String.repeat 129 "i")
                                    , withId "dup"
                                    , withId "dup"
                                    , withId "ok"
                                    ]
                                )
                    in
                    Expect.equal [ "dup", "ok" ] (List.map .id decoded)
            , test "bad channel/text/sendAt drop the row" <|
                \_ ->
                    let
                        mk channel text sendAt =
                            row
                                [ ( "id", Encode.string "x" )
                                , ( "channel", channel )
                                , ( "text", text )
                                , ( "sendAt", sendAt )
                                ]

                        decoded =
                            decodeScheduledMessages
                                (Encode.list identity
                                    [ mk (Encode.string "") (Encode.string "hi") (Encode.int 10)
                                    , mk (Encode.string (String.repeat 257 "c")) (Encode.string "hi") (Encode.int 10)
                                    , mk (Encode.string "#c") (Encode.string "   ") (Encode.int 10)
                                    , mk (Encode.string "#c") (Encode.string (String.repeat 65537 "t")) (Encode.int 10)
                                    , mk (Encode.string "#c") (Encode.string "hi") (Encode.int 0)
                                    , mk (Encode.string "#c") (Encode.string "hi") (Encode.int -5)
                                    , mk (Encode.string "#c") (Encode.string "hi") (Encode.float 1.5)
                                    , mk (Encode.string "#c") (Encode.string "hi") (Encode.string "10")
                                    , mk (Encode.string "#c") (Encode.string "hi") (Encode.float 9007199254740992)
                                    , mk (Encode.string "#c") (Encode.string "hi") (Encode.int 10)
                                    ]
                                )
                    in
                    Expect.equal 1 (List.length decoded)
            , test "max safe integer is accepted" <|
                \_ ->
                    Expect.equal 1
                        (List.length
                            (decodeScheduledMessages
                                (Encode.list identity
                                    [ row
                                        [ ( "id", Encode.string "x" )
                                        , ( "channel", Encode.string "#c" )
                                        , ( "text", Encode.string "hi" )
                                        , ( "sendAt", Encode.float 9007199254740991 )
                                        ]
                                    ]
                                )
                            )
                        )
            , test "present-but-bad generation/clearEpoch drop the row" <|
                \_ ->
                    let
                        mk extra =
                            row
                                ([ ( "id", Encode.string "x" )
                                 , ( "channel", Encode.string "#c" )
                                 , ( "text", Encode.string "hi" )
                                 , ( "sendAt", Encode.int 10 )
                                 ]
                                    ++ extra
                                )

                        decoded =
                            decodeScheduledMessages
                                (Encode.list identity
                                    [ mk [ ( "generation", Encode.int -1 ) ]
                                    , mk [ ( "generation", Encode.float 2.5 ) ]
                                    , mk [ ( "clearEpoch", Encode.string "3" ) ]
                                    , mk [ ( "generation", Encode.int 2 ), ( "clearEpoch", Encode.int 3 ) ]
                                    ]
                                )
                    in
                    Expect.all
                        [ \_ -> Expect.equal 1 (List.length decoded)
                        , \_ -> Expect.equal (Just 2) (Maybe.andThen .generation (List.head decoded))
                        , \_ -> Expect.equal (Just 3) (Maybe.andThen .clearEpoch (List.head decoded))
                        ]
                        ()
            , test "bad owner/claim clear the slot, keep the row" <|
                \_ ->
                    let
                        badOwner =
                            row
                                [ ( "id", Encode.string "a" )
                                , ( "channel", Encode.string "#c" )
                                , ( "text", Encode.string "hi" )
                                , ( "sendAt", Encode.int 10 )
                                , ( "owner", Encode.object [ ( "serverUrl", Encode.string "wss://x " ), ( "identity", Encode.string "ALICE" ) ] )
                                , ( "claim", Encode.object [ ( "token", Encode.string "" ), ( "claimedAt", Encode.int 5 ) ] )
                                ]

                        goodOwner =
                            row
                                [ ( "id", Encode.string "b" )
                                , ( "channel", Encode.string "#c" )
                                , ( "text", Encode.string "hi" )
                                , ( "sendAt", Encode.int 9 )
                                , ( "owner", Encode.object [ ( "serverUrl", Encode.string "wss://x" ), ( "identity", Encode.string "ALICE" ) ] )
                                , ( "claim", Encode.object [ ( "token", Encode.string "t" ), ( "claimedAt", Encode.int 5 ) ] )
                                ]

                        decoded =
                            decodeScheduledMessages (Encode.list identity [ badOwner, goodOwner ])
                    in
                    Expect.all
                        [ \_ -> Expect.equal 2 (List.length decoded)
                        , \_ -> Expect.equal Nothing (Maybe.andThen .owner (List.head (List.filter (\m -> m.id == "a") decoded)))
                        , \_ -> Expect.equal Nothing (Maybe.andThen .claim (List.head (List.filter (\m -> m.id == "a") decoded)))
                        , \_ -> Expect.equal (Just { serverUrl = "wss://x", identity = "alice" }) (Maybe.andThen .owner (List.head (List.filter (\m -> m.id == "b") decoded)))
                        , \_ -> Expect.equal (Just { token = "t", claimedAt = 5 }) (Maybe.andThen .claim (List.head (List.filter (\m -> m.id == "b") decoded)))
                        , \_ -> Expect.equal [ "b", "a" ] (List.map .id decoded)
                        ]
                        ()
            , test "queue caps at 256 rows" <|
                \_ ->
                    let
                        mk i =
                            row
                                [ ( "id", Encode.string ("s" ++ String.fromInt i) )
                                , ( "channel", Encode.string "#c" )
                                , ( "text", Encode.string "hi" )
                                , ( "sendAt", Encode.int i )
                                ]
                    in
                    Expect.equal 256
                        (List.length
                            (decodeScheduledMessages
                                (Encode.list identity (List.map mk (List.range 1 257)))
                            )
                        )
            ]
        , describe "selectDueMessages"
            [ test "boundary is due online, everything holds offline" <|
                \_ ->
                    let
                        queue =
                            [ { id = "a", channel = "#c", text = "x", sendAt = 100, owner = Nothing, claim = Nothing, generation = Nothing, clearEpoch = Nothing }
                            , { id = "b", channel = "#c", text = "y", sendAt = 101, owner = Nothing, claim = Nothing, generation = Nothing, clearEpoch = Nothing }
                            ]

                        online =
                            selectDueMessages queue 100 True

                        offline =
                            selectDueMessages queue 100000 False
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "a" ] (List.map .id online.due)
                        , \_ -> Expect.equal [ "b" ] (List.map .id online.pending)
                        , \_ -> Expect.equal [] offline.due
                        , \_ -> Expect.equal [ "a", "b" ] (List.map .id offline.pending)
                        ]
                        ()
            ]
        , describe "enqueue/cancel"
            [ test "full or duplicate refuses, else sorted by sendAt" <|
                \_ ->
                    let
                        item sendAt id =
                            { id = id, channel = "#c", text = "x", sendAt = sendAt, owner = Nothing, claim = Nothing, generation = Nothing, clearEpoch = Nothing }

                        full =
                            List.map (\i -> item i ("s" ++ String.fromInt i)) (List.range 1 256)
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing (enqueueScheduled full (item 999 "new"))
                        , \_ -> Expect.equal Nothing (enqueueScheduled [ item 1 "a" ] (item 2 "a"))
                        , \_ -> Expect.equal (Just [ 1, 5, 9 ]) (Maybe.map (List.map .sendAt) (enqueueScheduled [ item 9 "c", item 1 "a" ] (item 5 "b")))
                        , \_ -> Expect.equal [ "a", "c" ] (List.map .id (cancelScheduled [ item 1 "a", item 2 "b", item 3 "c" ] "b"))
                        , \_ -> Expect.equal 2 (List.length (cancelScheduled [ item 1 "a", item 2 "b" ] "missing"))
                        ]
                        ()
            ]
        , describe "classifyScheduledMessage"
            [ test "precedence matches the oracle chain" <|
                \_ ->
                    let
                        base =
                            { sendAt = 100, now = 200, connected = True, protected = False, encryptionRequired = False }
                    in
                    Expect.all
                        [ \_ -> Expect.equal ScheduleDue (classifyScheduledMessage base)
                        , \_ -> Expect.equal ScheduleFuture (classifyScheduledMessage { base | sendAt = 300 })
                        , \_ -> Expect.equal ScheduleOverdueDisconnected (classifyScheduledMessage { base | connected = False })
                        , \_ -> Expect.equal ScheduleProtected (classifyScheduledMessage { base | protected = True, connected = False })
                        , \_ -> Expect.equal ScheduleEncryptionRequired (classifyScheduledMessage { base | encryptionRequired = True, protected = True })
                        ]
                        ()
            ]
        , describe "createScheduledSend"
            [ test "validates every edge" <|
                \_ ->
                    let
                        base =
                            { channel = "  #c  ", text = "hi", sendAt = 1700000000000, owner = Nothing, id = "s1" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal "#c" (Maybe.map .channel (createScheduledSend base) |> Maybe.withDefault "?")
                        , \_ -> Expect.equal Nothing (createScheduledSend { base | channel = "a b" })
                        , \_ -> Expect.equal Nothing (createScheduledSend { base | channel = ":x" })
                        , \_ -> Expect.equal Nothing (createScheduledSend { base | text = "   " })
                        , \_ -> Expect.equal Nothing (createScheduledSend { base | sendAt = 0 })
                        , \_ -> Expect.equal Nothing (createScheduledSend { base | id = "" })
                        , \_ -> Expect.equal Nothing (createScheduledSend { base | id = String.repeat 129 "i" })
                        ]
                        ()
            ]
        , describe "canScheduleAt/canScheduleChannel"
            [ test "bounds mirror the oracle" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (canScheduleAt 1)
                        , \_ -> Expect.equal False (canScheduleAt 0)
                        , \_ -> Expect.equal False (canScheduleAt -3)
                        , \_ -> Expect.equal True (canScheduleChannel "#room")
                        , \_ -> Expect.equal False (canScheduleChannel "")
                        , \_ -> Expect.equal False (canScheduleChannel "   ")
                        , \_ -> Expect.equal False (canScheduleChannel "a,b")
                        , \_ -> Expect.equal False (canScheduleChannel ":lead")
                        , \_ -> Expect.equal False (canScheduleChannel "has space")
                        , \_ -> Expect.equal False (canScheduleChannel "has\ttab")
                        ]
                        ()
            ]
        , describe "parseScheduledMessages"
            [ test "raw storage parses like the oracle" <|
                \_ ->
                    let
                        encoded =
                            Encode.encode 0 (Encode.list identity [ validRow ])
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (parseScheduledMessages "")
                        , \_ -> Expect.equal [] (parseScheduledMessages (String.repeat (maxScheduledStorageLength + 1) " "))
                        , \_ -> Expect.equal [] (parseScheduledMessages "not json")
                        , \_ -> Expect.equal [] (parseScheduledMessages "{\"id\":\"x\"}")
                        , \_ -> Expect.equal 1 (List.length (parseScheduledMessages encoded))
                        , \_ -> Expect.equal (List.map .id (decodeScheduledMessages (Encode.list identity [ validRow ]))) (List.map .id (parseScheduledMessages encoded))
                        ]
                        ()
            ]
        , describe "scheduleOwnerFor/sameScheduleOwner"
            [ test "owner derivation trims and lowercases" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just { serverUrl = "wss://x.test", identity = "alice" }) (scheduleOwnerFor "  wss://x.test " (Just "Alice") "guest")
                        , \_ -> Expect.equal (Just { serverUrl = "wss://x.test", identity = "guest123" }) (scheduleOwnerFor "wss://x.test" Nothing "Guest123")
                        , \_ -> Expect.equal Nothing (scheduleOwnerFor "   " (Just "alice") "guest")
                        , \_ -> Expect.equal Nothing (scheduleOwnerFor "wss://x.test" (Just "  ") "   ")
                        , \_ -> Expect.equal True (sameScheduleOwner (Just { serverUrl = "u", identity = "a" }) { serverUrl = "u", identity = "a" })
                        , \_ -> Expect.equal False (sameScheduleOwner Nothing { serverUrl = "u", identity = "a" })
                        , \_ -> Expect.equal False (sameScheduleOwner (Just { serverUrl = "u", identity = "a" }) { serverUrl = "u", identity = "b" })
                        , \_ -> Expect.equal False (sameScheduleOwner (Just { serverUrl = "u", identity = "a" }) { serverUrl = "v", identity = "a" })
                        ]
                        ()
            ]
        , describe "ownedScheduledMessages/purgeOutgoingScheduled"
            [ test "visibility and logout purge scope by owner" <|
                \_ ->
                    let
                        alice =
                            { serverUrl = "wss://x.test", identity = "alice" }

                        mk id owner =
                            { id = id, channel = "#c", text = "hi", sendAt = 10, owner = owner, claim = Nothing, generation = Nothing, clearEpoch = Nothing }

                        queue =
                            [ mk "a" (Just alice), mk "legacy" Nothing, mk "b" (Just { serverUrl = "wss://x.test", identity = "bob" }) ]

                        purged =
                            purgeOutgoingScheduled queue (Just alice)
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "a" ] (List.map .id (ownedScheduledMessages queue (Just alice)))
                        , \_ -> Expect.equal [] (ownedScheduledMessages queue Nothing)
                        , \_ -> Expect.equal 1 (ownedScheduledMessageCount queue (Just alice))
                        , \_ -> Expect.equal 0 (ownedScheduledMessageCount queue Nothing)
                        , \_ -> Expect.equal [ "legacy", "b" ] (List.map .id purged.kept)
                        , \_ -> Expect.equal True purged.changed
                        , \_ -> Expect.equal False (purgeOutgoingScheduled queue Nothing).changed
                        , \_ -> Expect.equal 3 (List.length (purgeOutgoingScheduled queue Nothing).kept)
                        , \_ -> Expect.equal False (purgeOutgoingScheduled queue (Just { serverUrl = "wss://x.test", identity = "carol" })).changed
                        ]
                        ()
            ]
        , describe "claimToken/claimableRows/trustedOwner"
            [ test "dispatch round selection mirrors the oracle filter" <|
                \_ ->
                    let
                        alice =
                            { serverUrl = "wss://x.test", identity = "alice" }

                        mk id sendAt owner claim =
                            { id = id, channel = "#c", text = "hi", sendAt = sendAt, owner = owner, claim = claim, generation = Nothing, clearEpoch = Nothing }

                        queue =
                            [ mk "future" 900 (Just alice) Nothing
                            , mk "claimed" 10 (Just alice) (Just { token = "claim-0-0", claimedAt = 5 })
                            , mk "bobs" 10 (Just { serverUrl = "wss://x.test", identity = "bob" }) Nothing
                            , mk "legacy" 10 Nothing Nothing
                            , mk "due-b" 20 (Just alice) Nothing
                            , mk "due-a" 10 (Just alice) Nothing
                            ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal "claim-9000-3" (claimToken 9000 3)
                        , \_ -> Expect.equal 15000 scheduledDispatchIntervalMs
                        , \_ -> Expect.equal [ "due-a", "due-b" ] (List.map .id (claimableRows queue (Just alice) 100))
                        , \_ -> Expect.equal [] (claimableRows queue Nothing 100)
                        , \_ -> Expect.equal [] (claimableRows queue (Just alice) 5)
                        , \_ -> Expect.equal (Just { serverUrl = "u", identity = "a" }) (trustedOwner "  u " "A")
                        , \_ -> Expect.equal Nothing (trustedOwner "" "a")
                        , \_ -> Expect.equal Nothing (trustedOwner "u" "   ")
                        ]
                        ()
            ]
        , describe "encodeScheduledMessages"
            [ test "projection round-trips through decode" <|
                \_ ->
                    let
                        full =
                            { id = "s9"
                            , channel = "#c"
                            , text = "later"
                            , sendAt = 4094094094094
                            , owner = Just { serverUrl = "wss://x.test", identity = "alice" }
                            , claim = Just { token = "claim-1", claimedAt = 99 }
                            , generation = Just 3
                            , clearEpoch = Just 7
                            }

                        minimal =
                            { id = "s1", channel = "bob", text = "dm", sendAt = 5, owner = Nothing, claim = Nothing, generation = Nothing, clearEpoch = Nothing }

                        queue =
                            [ minimal, full ]
                    in
                    Expect.equal queue (decodeScheduledMessages (encodeScheduledMessages queue))
            ]
        , describe "isSchedulable"
            [ test "window admits the 30s lead and the 1-year cap, refuses outside" <|
                \_ ->
                    let
                        now =
                            1750000000000

                        year =
                            365 * 24 * 60 * 60 * 1000
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (isSchedulable (now + 30000) now)
                        , \_ -> Expect.equal False (isSchedulable (now + 29999) now)
                        , \_ -> Expect.equal False (isSchedulable now now)
                        , \_ -> Expect.equal False (isSchedulable (now - 1000) now)
                        , \_ -> Expect.equal True (isSchedulable (now + year) now)
                        , \_ -> Expect.equal False (isSchedulable (now + year + 1) now)
                        , \_ -> Expect.equal True (isSchedulable (now + 900000) now)
                        ]
                        ()
            ]
        , describe "schedulePresets"
            [ test "table keeps oracle ids, labels, and relative offsets in order" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                [ "in-15m", "in-1h", "in-3h", "tomorrow-9" ]
                                (List.map .id schedulePresets)
                        , \_ ->
                            Expect.equal
                                [ "In 15 minutes", "In 1 hour", "In 3 hours", "Tomorrow, 9:00" ]
                                (List.map .label schedulePresets)
                        , \_ ->
                            Expect.equal
                                [ Just 900000, Just 3600000, Just 10800000, Nothing ]
                                (List.map .offsetMs schedulePresets)
                        ]
                        ()
            ]
        , describe "canScheduleComposer"
            [ test "gate admits plain drafts and refuses empty, missing-target, and slash bodies" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (canScheduleComposer { target = Just "#c", body = "later" })
                        , \_ -> Expect.equal True (canScheduleComposer { target = Just "bob", body = "  later  " })
                        , \_ -> Expect.equal False (canScheduleComposer { target = Nothing, body = "later" })
                        , \_ -> Expect.equal False (canScheduleComposer { target = Just "", body = "later" })
                        , \_ -> Expect.equal False (canScheduleComposer { target = Just "#c", body = "   " })
                        , \_ -> Expect.equal False (canScheduleComposer { target = Just "#c", body = "/part now" })
                        , \_ -> Expect.equal False (canScheduleComposer { target = Just "#c", body = "  /me x" })
                        ]
                        ()
            , test "refusal copy names the first applicable reason in oracle order" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (scheduleComposerRefusal { target = Just "#c", body = "later" })
                        , \_ -> Expect.equal (Just "Choose a room or message to schedule.") (scheduleComposerRefusal { target = Nothing, body = "later" })
                        , \_ -> Expect.equal (Just "Choose a room or message to schedule.") (scheduleComposerRefusal { target = Just "", body = "later" })
                        , \_ -> Expect.equal (Just "Type a message before scheduling.") (scheduleComposerRefusal { target = Just "#c", body = "  " })
                        , \_ -> Expect.equal (Just "Slash commands cannot be scheduled.") (scheduleComposerRefusal { target = Just "#c", body = "/join #x" })
                        ]
                        ()
            ]
        , describe "scheduledRowStateLabel"
            [ test "labels cover the claim override and all five display states" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "Sending; delivery is uncertain" (scheduledRowStateLabel True ScheduleDue)
                        , \_ -> Expect.equal "Sending; delivery is uncertain" (scheduledRowStateLabel True ScheduleFuture)
                        , \_ -> Expect.equal "Saved; waiting for its time" (scheduledRowStateLabel False ScheduleFuture)
                        , \_ -> Expect.equal "Waiting for connection" (scheduledRowStateLabel False ScheduleOverdueDisconnected)
                        , \_ -> Expect.equal "Waiting for room protection" (scheduledRowStateLabel False ScheduleProtected)
                        , \_ -> Expect.equal "Waiting for encryption" (scheduledRowStateLabel False ScheduleEncryptionRequired)
                        , \_ -> Expect.equal "Due; awaiting send" (scheduledRowStateLabel False ScheduleDue)
                        ]
                        ()
            ]
        ]
