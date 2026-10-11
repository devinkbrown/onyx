module HistoryImportTest exposing (suite)

{-| v3/gap-import — the Elm half of third-party history import: the
strict staged-payload decoder (the port is never trusted), destination
normalization, the review → confirm plan (new rows only, grouped,
chunked, ledgered), cancel / owner-change abort, and remove / undo.
The parsers themselves are pinned by `historyImport.smoke.mjs`.
-}

import Dict
import Expect
import HistoryImport exposing (Effect(..), Msg(..), Phase(..), Source(..))
import Json.Encode as E
import Test exposing (Test, describe, test)
import VaultImport


row : String -> Int -> Bool -> E.Value
row id time dup =
    E.object
        [ ( "id", E.string id )
        , ( "from", E.string "ana" )
        , ( "text", E.string ("text " ++ id) )
        , ( "type", E.string "msg" )
        , ( "time", E.int time )
        , ( "print", E.string "0123abcd" )
        , ( "dup", E.bool dup )
        , ( "replyTo", E.null )
        ]


conversation : String -> String -> Bool -> List E.Value -> E.Value
conversation key suggested dm rows =
    E.object
        [ ( "key", E.string key )
        , ( "source", E.string ("Source " ++ key) )
        , ( "suggested", E.string suggested )
        , ( "dm", E.bool dm )
        , ( "rows", E.list identity rows )
        ]


payload : Int -> String -> List E.Value -> E.Value
payload job kind conversations =
    E.object
        [ ( "job", E.int job )
        , ( "result"
          , E.object
                [ ( "kind", E.string kind )
                , ( "label", E.string "Synthetic Guild" )
                , ( "files", E.int 2 )
                , ( "skipped", E.int 3 )
                , ( "systemSkipped", E.int 1 )
                , ( "conversations", E.list identity conversations )
                ]
          )
        ]


sample : Int -> E.Value
sample job =
    payload job
        "discord"
        [ conversation "discord:1" "#general" False [ row "d:1" 1000 False, row "d:2" 2000 True, row "d:3" 3000 False ]
        , conversation "discord:2" "bo" True [ row "d:4" 4000 False ]
        ]


ctx : HistoryImport.Ctx
ctx =
    { nowMs = 1700000000000, owner = Just "srv|ana" }


run : List Msg -> HistoryImport.State -> ( HistoryImport.State, List Effect )
run msgs state =
    List.foldl (\m ( s, effects ) -> HistoryImport.update ctx m s |> Tuple.mapSecond ((++) effects)) ( state, [] ) msgs


reviewing : HistoryImport.State
reviewing =
    Tuple.first (run [ Choose Discord, GotStaged (sample 1) ] HistoryImport.blank)


suite : Test
suite =
    describe "HistoryImport"
        [ describe "staged payload decoder"
            [ test "decodes conversations with counts, dup tallies and date range" <|
                \_ ->
                    Expect.equal
                        (HistoryImport.decodeStaged (sample 7)
                            |> Maybe.map (\s -> ( ( s.job, s.source, s.label ), ( s.files, s.skipped ), List.map (\c -> ( c.key, c.count, ( c.dupCount, c.oldest, c.newest ) )) s.conversations ))
                        )
                        (Just ( ( 7, Discord, "Synthetic Guild" ), ( 2, 3 ), [ ( "discord:1", 3, ( 1, 1000, 3000 ) ), ( "discord:2", 1, ( 0, 4000, 4000 ) ) ] ))
            , test "rows breaking a vault bound are dropped and counted" <|
                \_ ->
                    let
                        bad =
                            [ E.object [ ( "id", E.string "has space" ), ( "from", E.string "a" ), ( "text", E.string "t" ), ( "type", E.string "msg" ), ( "time", E.int 5 ) ]
                            , E.object [ ( "id", E.string "x1" ), ( "from", E.string "a b" ), ( "text", E.string "t" ), ( "type", E.string "msg" ), ( "time", E.int 5 ) ]
                            , E.object [ ( "id", E.string "x2" ), ( "from", E.string "a" ), ( "text", E.string "   " ), ( "type", E.string "msg" ), ( "time", E.int 5 ) ]
                            , E.object [ ( "id", E.string "x3" ), ( "from", E.string "a" ), ( "text", E.string "t" ), ( "type", E.string "script" ), ( "time", E.int 5 ) ]
                            , E.object [ ( "id", E.string "x4" ), ( "from", E.string "a" ), ( "text", E.string "t" ), ( "type", E.string "msg" ), ( "time", E.int -5 ) ]
                            , E.object [ ( "id", E.string "x5" ), ( "from", E.string "a" ), ( "text", E.string (String.repeat (VaultImport.maxMessageTextLength + 1) "a") ), ( "type", E.string "msg" ), ( "time", E.int 5 ) ]
                            , E.object [ ( "id", E.string "x6" ), ( "from", E.string "a" ), ( "text", E.string "ONYXDM1 forged" ), ( "type", E.string "msg" ), ( "time", E.int 5 ) ]
                            , E.object [ ( "id", E.string "x7" ), ( "from", E.string "a" ), ( "text", E.string "t" ), ( "type", E.string "msg" ), ( "time", E.int 5 ), ( "print", E.string "<script>" ) ]
                            , E.string "not a row"
                            , row "ok" 10 False
                            ]
                    in
                    Expect.equal
                        (HistoryImport.decodeStaged (payload 1 "irc" [ conversation "irc:#x" "#x" False bad ]) |> Maybe.map (\s -> ( s.invalid, List.map .count s.conversations )))
                        (Just ( 9, [ 1 ] ))
            , test "portable rows keep their own envelope text" <|
                \_ ->
                    Expect.equal
                        (HistoryImport.decodeStaged (payload 1 "portable" [ conversation "vault:bo" "bo" True [ E.object [ ( "id", E.string "bo:1" ), ( "from", E.string "bo" ), ( "text", E.string "ONYXDM1 AAAA" ), ( "type", E.string "msg" ), ( "time", E.int 5 ) ] ] ])
                            |> Maybe.map (\s -> List.map .count s.conversations)
                        )
                        (Just [ 1 ])
            , test "an unknown kind, a missing job, or nothing valid decodes to Nothing" <|
                \_ ->
                    Expect.equal
                        [ HistoryImport.decodeStaged (payload 1 "myspace" [ conversation "a" "#a" False [ row "r" 5 False ] ])
                        , HistoryImport.decodeStaged (E.object [ ( "result", E.object [] ) ])
                        , HistoryImport.decodeStaged (payload 1 "discord" [ conversation "a" "#a" False [ E.string "x" ] ])
                        ]
                        [ Nothing, Nothing, Nothing ]
            , test "an invalid suggested destination becomes blank, labels lose controls" <|
                \_ ->
                    Expect.equal
                        (HistoryImport.decodeStaged
                            (payload 1 "discord" [ E.object [ ( "key", E.string "k" ), ( "source", E.string "evil\u{202E}name\u{0007}" ), ( "suggested", E.string "#has space" ), ( "rows", E.list identity [ row "r" 5 False ] ) ] ])
                            |> Maybe.map (\s -> List.map (\c -> ( c.source, c.suggested )) s.conversations)
                        )
                        (Just [ ( "evil name", "" ) ])
            , test "a row id seen twice keeps the first" <|
                \_ ->
                    Expect.equal
                        (HistoryImport.decodeStaged (payload 1 "discord" [ conversation "a" "#a" False [ row "same" 5 False, row "same" 6 False ] ]) |> Maybe.map (\s -> List.map .count s.conversations))
                        (Just [ 1 ])
            , test "batches decode defensively" <|
                \_ ->
                    Expect.equal
                        (HistoryImport.decodeBatches
                            (E.object
                                [ ( "batches"
                                  , E.list identity
                                        [ E.object [ ( "id", E.string "imp-1" ), ( "kind", E.string "slack" ), ( "label", E.string "Slack · WS" ), ( "at", E.int 9 ), ( "messages", E.int 3 ), ( "targets", E.list E.string [ "#a" ] ) ]
                                        , E.object [ ( "id", E.string "bad id" ) ]
                                        ]
                                  )
                                ]
                            )
                        )
                        [ { id = "imp-1", kind = "slack", label = "Slack · WS", at = 9, messages = 3, targets = [ "#a" ] } ]
            ]
        , describe "destinations"
            [ test "rooms and nicks normalize to lowercase vault targets" <|
                \_ ->
                    Expect.equal
                        (List.map HistoryImport.normalizeDestination [ " #General ", "&Local", "Bo_Test", "[m]" ])
                        [ Ok { target = "#general", dm = False }, Ok { target = "&local", dm = False }, Ok { target = "bo_test", dm = True }, Ok { target = "[m]", dm = True } ]
            , test "bad destinations explain themselves" <|
                \_ ->
                    Expect.equal
                        (List.map HistoryImport.destinationError [ "", "#", "#a b", "#a,b", "#" ++ String.repeat 50 "a", "9lives", "bo test", "ünï" ])
                        [ Just "Choose where these messages go."
                        , Just "Add a room name after the #."
                        , Just "Room names cannot contain spaces or commas."
                        , Just "Room names cannot contain spaces or commas."
                        , Just "Room names are at most 50 characters."
                        , Just "Use a room like #name, or a person's nick."
                        , Just "Use a room like #name, or a person's nick."
                        , Just "Use a room like #name, or a person's nick."
                        ]
            , test "merging into an open room is detected" <|
                \_ -> Expect.equal (HistoryImport.isDestinationRoom [ "#General" ] "#general") True
            ]
        , describe "flow"
            [ test "choose asks ports for a picker with a fresh job" <|
                \_ ->
                    Expect.equal (Tuple.second (run [ Choose Slack ] HistoryImport.blank)) [ Pick { job = 1, kind = "slack" } ]
            , test "progress for the live job shows; a stale job's is ignored" <|
                \_ ->
                    let
                        ( s, _ ) =
                            run [ Choose Discord, Progress { job = 9, phase = "parsing", done = 1, total = 2, files = 1 }, Progress { job = 1, phase = "parsing", done = 1, total = 4, files = 3 } ] HistoryImport.blank
                    in
                    case s.phase of
                        Working w ->
                            Expect.equal ( w.job, HistoryImport.progressPercent w, w.files ) ( 1, 25, 3 )

                        _ ->
                            Expect.fail "not working"
            , test "a staged result for the live job opens the review and focuses it" <|
                \_ ->
                    let
                        ( s, effects ) =
                            run [ Choose Discord, GotStaged (sample 1) ] HistoryImport.blank
                    in
                    Expect.equal ( HistoryImport.busy s, List.member (Focus HistoryImport.reviewTitleId) effects ) ( True, True )
            , test "a staged result for another job is ignored" <|
                \_ ->
                    Expect.equal (Tuple.first (run [ Choose Discord, GotStaged (sample 4) ] HistoryImport.blank)).phase (Picking { job = 1, source = Discord })
            , test "cancel while working terminates the job and writes nothing" <|
                \_ ->
                    let
                        ( s, effects ) =
                            run [ Choose IrcLog, Progress { job = 1, phase = "parsing", done = 1, total = 9, files = 1 }, Cancel ] HistoryImport.blank
                    in
                    Expect.equal ( s.phase, effects ) ( Idle, [ Pick { job = 1, kind = "irc" }, CancelJob { job = 1 } ] )
            , test "cancel in review writes nothing" <|
                \_ ->
                    Expect.equal (Tuple.second (HistoryImport.update ctx Cancel reviewing)) []
            , test "a picker dismissed without files returns quietly; a failure explains" <|
                \_ ->
                    Expect.equal
                        ( (Tuple.first (run [ Choose Discord, Failed { job = 1, message = "" } ] HistoryImport.blank)).status
                        , Maybe.map .message (Tuple.first (run [ Choose Discord, Failed { job = 1, message = "Too big." } ] HistoryImport.blank)).status
                        )
                        ( Nothing, Just "Too big." )
            , test "confirm writes only new rows, grouped by destination, and ledgers the batch" <|
                \_ ->
                    let
                        ( s, effects ) =
                            HistoryImport.update ctx Confirm reviewing

                        persists =
                            List.filterMap
                                (\e ->
                                    case e of
                                        Persist p ->
                                            Just ( p.target, List.map .id p.rows )

                                        _ ->
                                            Nothing
                                )
                                effects

                        records =
                            List.filterMap
                                (\e ->
                                    case e of
                                        Record r ->
                                            Just ( r.batch.id, r.batch.messages, ( r.batch.targets, r.ids ) )

                                        _ ->
                                            Nothing
                                )
                                effects
                    in
                    Expect.equal
                        ( persists, records, ( s.phase, Maybe.map .message s.status ) )
                        ( [ ( "#general", [ "d:1", "d:3" ] ), ( "bo", [ "d:4" ] ) ]
                        , [ ( "imp-1700000000000-1", 3, ( [ "#general", "bo" ], [ "d:1", "d:3", "d:4" ] ) ) ]
                        , ( Idle, Just "Imported 3 messages into 2 conversations (1 message already here, skipped). Open a room to read them, or search from anywhere." )
                        )
            , test "remapping and leaving out conversations changes the plan" <|
                \_ ->
                    let
                        ( _, effects ) =
                            run [ SetDest "discord:1" "#Old-General", Toggle "discord:2", Confirm ] reviewing
                    in
                    Expect.equal
                        (List.filterMap
                            (\e ->
                                case e of
                                    Persist p ->
                                        Just p.target

                                    _ ->
                                        Nothing
                            )
                            effects
                        )
                        [ "#old-general" ]
            , test "an invalid included destination blocks the import and focuses its field" <|
                \_ ->
                    let
                        ( s, effects ) =
                            run [ SetDest "discord:2" "not a nick", Confirm ] reviewing
                    in
                    Expect.equal ( Maybe.map .failure s.status, effects ) ( Just True, [ Focus "history-import-dest-discord:2" ] )
            , test "two conversations into one destination merge in time order" <|
                \_ ->
                    let
                        p =
                            case (Tuple.first (run [ SetDest "discord:2" "#general" ] reviewing)).phase of
                                Reviewing staged ->
                                    HistoryImport.plan (Tuple.first (run [ SetDest "discord:2" "#general" ] reviewing)) staged

                                _ ->
                                    HistoryImport.plan reviewing { job = 0, source = Discord, label = "", files = 0, rejectedFiles = 0, skipped = 0, systemSkipped = 0, duplicatesInFile = 0, droppedOverCap = 0, overBudget = 0, datesEstimated = False, invalid = 0, conversations = [] }
                    in
                    Expect.equal ( p.targets, List.map (.rows >> List.map .id) p.persists ) ( [ "#general" ], [ [ "d:1", "d:3", "d:4" ] ] )
            , test "everything already present writes nothing" <|
                \_ ->
                    let
                        allDup =
                            payload 1 "discord" [ conversation "a" "#a" False [ row "x" 5 True ] ]

                        ( s, effects ) =
                            run [ Choose Discord, GotStaged allDup, Confirm ] HistoryImport.blank
                    in
                    Expect.equal ( List.length (List.filter (\e -> e /= Pick { job = 1, kind = "discord" } && e /= Focus HistoryImport.reviewTitleId) effects), Maybe.map .message s.status )
                        ( 0, Just "Nothing new to import: 1 message already on this device." )
            , test "large conversations are chunked" <|
                \_ ->
                    let
                        many =
                            payload 1 "discord" [ conversation "a" "#a" False (List.map (\i -> row ("r" ++ String.fromInt i) (i + 1) False) (List.range 1 1000)) ]

                        ( _, effects ) =
                            run [ Choose Discord, GotStaged many, Confirm ] HistoryImport.blank
                    in
                    Expect.equal
                        (List.filterMap
                            (\e ->
                                case e of
                                    Persist p ->
                                        Just (List.length p.rows)

                                    _ ->
                                        Nothing
                            )
                            effects
                        )
                        [ 400, 400, 200 ]
            , test "undo removes the just-imported batch" <|
                \_ ->
                    let
                        ( imported, _ ) =
                            HistoryImport.update ctx Confirm reviewing

                        ( undoing, effects ) =
                            HistoryImport.update ctx Undo imported

                        ( done, after ) =
                            HistoryImport.update ctx (Removed { batch = "imp-1700000000000-1", removed = 3, ok = True, targets = [ "#general", "bo" ], prints = [] }) undoing
                    in
                    Expect.equal ( effects, ( done.lastBatch, Maybe.map .message done.status ), after )
                        ( [ RemoveBatch { batch = "imp-1700000000000-1" } ]
                        , ( Nothing, Just "Removed 3 imported messages from this device." )
                        , [ Touched { targets = [ "#general", "bo" ] } ]
                        )
            , test "removing a listed batch takes two steps" <|
                \_ ->
                    let
                        ( asked, none ) =
                            HistoryImport.update ctx (RemoveAsk "imp-9") HistoryImport.blank

                        ( _, effects ) =
                            HistoryImport.update ctx (RemoveConfirm "imp-9") asked

                        ( _, stray ) =
                            HistoryImport.update ctx (RemoveConfirm "imp-8") asked
                    in
                    Expect.equal ( none, effects, stray ) ( [], [ RemoveBatch { batch = "imp-9" } ], [] )
            , test "an owner change aborts a running or staged import" <|
                \_ ->
                    let
                        ( working, _ ) =
                            run [ Choose Discord, Progress { job = 1, phase = "reading", done = 0, total = 1, files = 1 } ] HistoryImport.blank
                    in
                    Expect.equal
                        ( Tuple.second (HistoryImport.ownerChanged working), (Tuple.first (HistoryImport.ownerChanged reviewing)).phase, Tuple.second (HistoryImport.ownerChanged HistoryImport.blank) )
                        ( [ CancelJob { job = 1 } ], Idle, [] )
            , test "choose is ignored while an import is running" <|
                \_ -> Expect.equal (Tuple.second (HistoryImport.update ctx (Choose Slack) reviewing)) []
            , test "include none / all toggles every conversation" <|
                \_ ->
                    let
                        ( s, _ ) =
                            run [ IncludeAll False ] reviewing
                    in
                    Expect.equal (Dict.values s.dests |> List.map .include) [ False, False ]
            ]
        , describe "fingerprint"
            [ test "matches the ports-side FNV-1a over UTF-16 units" <|
                \_ ->
                    Expect.equal
                        [ HistoryImport.fingerprint 1704189660000 "Ana" "Hi \u{1F44B} there", HistoryImport.fingerprint 0 "" "", HistoryImport.fingerprint 5 "bo" "x\u{0000}y" ]
                        [ "0b4e86a2", "15f295c7", "e8d5c228" ]
            ]
        , describe "copy"
            [ test "counts group thousands" <|
                \_ -> Expect.equal [ HistoryImport.countLabel 1 "message", HistoryImport.countLabel 1234567 "message", HistoryImport.countLabel 0 "room" ] [ "1 message", "1,234,567 messages", "0 rooms" ]
            ]
        ]
