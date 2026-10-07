module IrcxTest exposing (suite)

{-| IRCX extensions: ACCESS levels/masks/entries and the 801–805 fold
with its channel-known gate and list/buffer caps, PROP 818/819 with
registry bounds, WHISPER self-echo suppression, DATA tag validation,
and the fail-closed builders. Oracles `lib/irc/channelAccess.ts`,
`store.ts` IRCX folds, protocol §10.
-}

import Dict
import Expect
import Ircx exposing (..)
import Set
import Test exposing (Test, describe, test)
import Wire


known : Set.Set String
known =
    Set.fromList [ "#c" ]


feedAccess : AccessState -> String -> AccessFold
feedAccess state line =
    foldAccessLine known state (Wire.parseIrcMessage line)


listsOf : AccessState -> String -> List AccessEntry
listsOf state channel =
    Maybe.withDefault [] (Dict.get channel state.lists)


suite : Test
suite =
    describe "Ircx"
        [ describe "ACCESS levels and masks"
            [ test "parses levels case-insensitively" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just Host) (parseAccessLevel (Just "host"))
                        , \_ -> Expect.equal (Just Deny) (parseAccessLevel (Just " DENY "))
                        , \_ -> Expect.equal Nothing (parseAccessLevel (Just "op"))
                        , \_ -> Expect.equal Nothing (parseAccessLevel Nothing)
                        ]
                        ()
            , test "bare nicks expand to nick!*@*" <|
                \_ ->
                    Expect.equal (Just "alice!*@*") (normalizeAccessMask (Just "alice"))
            , test "full masks pass through validated" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "a!b@c") (normalizeAccessMask (Just "a!b@c"))
                        , \_ -> Expect.equal Nothing (normalizeAccessMask (Just "!b@c"))
                        , \_ -> Expect.equal Nothing (normalizeAccessMask (Just "a!@c"))
                        , \_ -> Expect.equal Nothing (normalizeAccessMask (Just "a b"))
                        ]
                        ()
            , test "durations treat 0 as permanent and reject range" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just 25) (parseAccessDuration (Just "25"))
                        , \_ -> Expect.equal Nothing (parseAccessDuration (Just "0"))
                        , \_ -> Expect.equal Nothing (parseAccessDuration (Just "99999999"))
                        , \_ -> Expect.equal Nothing (parseAccessDuration (Just "soon"))
                        ]
                        ()
            , test "durations mirror parseInt prefixes" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just 3600) (parseAccessDuration (Just " 3600"))
                        , \_ -> Expect.equal (Just 60) (parseAccessDuration (Just "+60"))
                        , \_ -> Expect.equal (Just 12) (parseAccessDuration (Just "12abc"))
                        , \_ -> Expect.equal Nothing (parseAccessDuration (Just "-5"))
                        , \_ -> Expect.equal Nothing (parseAccessDuration (Just "0x10"))
                        , \_ -> Expect.equal Nothing (parseAccessDuration (Just "+"))
                        ]
                        ()
            , test "entries need a valid level and mask" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal True
                                (normalizeAccessEntry
                                    { level = Just "host"
                                    , mask = Just "alice"
                                    , setBy = Just "op"
                                    , duration = Just "25"
                                    }
                                    /= Nothing
                                )
                        , \_ ->
                            Expect.equal Nothing
                                (normalizeAccessEntry
                                    { level = Just "op", mask = Just "alice", setBy = Nothing, duration = Nothing }
                                )
                        ]
                        ()
            , test "upserts replace by level+mask and cap length" <|
                \_ ->
                    let
                        entry mask =
                            { level = Host, mask = mask, setBy = Nothing, duration = Nothing }

                        filled =
                            List.foldl (\i acc -> upsertAccessEntry acc (entry ("u" ++ String.fromInt i))) [] (List.range 1 300)
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal 1
                                (List.length
                                    (upsertAccessEntry [ entry "a!*@*" ] (entry "a!*@*"))
                                )
                        , \_ -> Expect.equal 256 (List.length filled)
                        ]
                        ()
            , test "durations format largest-first" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "Permanent" (formatAccessDuration Nothing)
                        , \_ -> Expect.equal "1 day" (formatAccessDuration (Just 86400))
                        , \_ -> Expect.equal "3 hours" (formatAccessDuration (Just 10800))
                        , \_ -> Expect.equal "90s" (formatAccessDuration (Just 90))
                        ]
                        ()
            ]
        , describe "ACCESS fold"
            [ test "801 upserts rows for known channels only" <|
                \_ ->
                    let
                        forKnown =
                            feedAccess blankAccessState ":s 801 me #c HOST alice"

                        forUnknown =
                            foldAccessLine Set.empty blankAccessState (Wire.parseIrcMessage ":s 801 me #x HOST alice")
                    in
                    Expect.all
                        [ \_ ->
                            case forKnown of
                                AccessUpdated state ->
                                    Expect.equal [ "alice!*@*" ]
                                        (List.map .mask (listsOf state "#c"))

                                _ ->
                                    Expect.fail "expected AccessUpdated"
                        , \_ -> Expect.equal AccessNoChange forUnknown
                        ]
                        ()
            , test "802 removes the matching row" <|
                \_ ->
                    let
                        withRow =
                            case feedAccess blankAccessState ":s 801 me #c HOST alice" of
                                AccessUpdated state ->
                                    state

                                _ ->
                                    blankAccessState

                        removed =
                            feedAccess withRow ":s 802 me #c HOST alice"
                    in
                    case removed of
                        AccessUpdated state ->
                            Expect.equal [] (listsOf state "#c")

                        _ ->
                            Expect.fail "expected AccessUpdated"
            , test "803 marks loading, 804 buffers, 805 commits" <|
                \_ ->
                    let
                        step state line =
                            case foldAccessLine known state (Wire.parseIrcMessage line) of
                                AccessUpdated next ->
                                    next

                                _ ->
                                    state

                        committed =
                            blankAccessState
                                |> (\s -> step s ":s 803 me #c")
                                |> (\s -> step s ":s 804 me #c HOST alice!*@* op 25")
                                |> (\s -> step s ":s 805 me #c")
                    in
                    Expect.all
                        [ \_ -> Expect.equal False (Set.member "#c" committed.loading)
                        , \_ ->
                            Expect.equal [ "alice!*@*" ]
                                (List.map .mask (listsOf committed "#c"))
                        , \_ ->
                            Expect.equal (Just 25)
                                (listsOf committed "#c"
                                    |> List.head
                                    |> Maybe.andThen .duration
                                )
                        ]
                        ()
            , test "805 refuses a new bucket past the channel cap" <|
                \_ ->
                    let
                        entry =
                            { level = Host, mask = "a!b@c", setBy = Nothing, duration = Nothing }

                        fullLists =
                            List.range 0 31
                                |> List.map (\i -> "#c" ++ String.fromInt i)
                                |> List.map (\ch -> ( ch, [ entry ] ))
                                |> Dict.fromList

                        full =
                            { blankAccessState
                                | lists = fullLists
                                , buffers = Dict.singleton "#new" [ entry ]
                                , loading = Set.singleton "#new"
                            }

                        knownMany =
                            Set.insert "#new" (Set.fromList (Dict.keys fullLists))
                    in
                    case foldAccessLine knownMany full (Wire.parseIrcMessage ":s 805 me #new") of
                        AccessUpdated next ->
                            Expect.all
                                [ \_ -> Expect.equal 32 (Dict.size next.lists)
                                , \_ -> Expect.equal Nothing (Dict.get "#new" next.lists)
                                , \_ -> Expect.equal Dict.empty next.buffers
                                , \_ -> Expect.equal False (Set.member "#new" next.loading)
                                ]
                                ()

                        _ ->
                            Expect.fail "expected AccessUpdated"
            , test "775 and 776 surface service notices" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (AccessServiceNote { kind = "Channel", text = "#c ACCESS alice!*@* HOST" })
                                (feedAccess blankAccessState ":s 775 me #c alice!*@* HOST")
                        , \_ ->
                            Expect.equal
                                (AccessServiceNote { kind = "Channel", text = "#c access list complete" })
                                (feedAccess blankAccessState ":s 776 me #c")
                        ]
                        ()
            ]
        , describe "PROP registry"
            [ test "818 stores channel and user props separately" <|
                \_ ->
                    let
                        step state line =
                            foldPropLine "#&" state (Wire.parseIrcMessage line)

                        props =
                            blankPropState
                                |> (\s -> step s ":s 818 me #c ocean.display-name :Lounge")
                                |> (\s -> step s ":s 818 me alice STATUS :busy")
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just "Lounge")
                                (Dict.get "#c" props.channelProps
                                    |> Maybe.andThen (Dict.get "ocean.display-name")
                                )
                        , \_ ->
                            Expect.equal (Just "busy")
                                (Dict.get "alice" props.userProps
                                    |> Maybe.andThen (Dict.get "STATUS")
                                )
                        ]
                        ()
            , test "818 refuses unsafe names and 819 marks sync" <|
                \_ ->
                    let
                        refused =
                            foldPropLine "#&" blankPropState (Wire.parseIrcMessage ":s 818 me #c __proto__ :x")

                        synced =
                            foldPropLine "#&" blankPropState (Wire.parseIrcMessage ":s 819 me #c")
                    in
                    Expect.all
                        [ \_ -> Expect.equal Dict.empty refused.channelProps
                        , \_ -> Expect.equal True (Set.member "#c" synced.synced)
                        ]
                        ()
            ]
        , describe "WHISPER"
            [ test "renders inbound whispers, never self-echo" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (WhisperReceived { channel = "#c", from = "alice", body = "psst" })
                                (foldWhisperLine "me" (Wire.parseIrcMessage ":alice!u@h WHISPER #c :psst"))
                        , \_ ->
                            Expect.equal WhisperNoChange
                                (foldWhisperLine "me" (Wire.parseIrcMessage ":me!u@h WHISPER #c :echo"))
                        ]
                        ()
            , test "builder joins multi-nicks with commas" <|
                \_ ->
                    Expect.equal
                        (Just "WHISPER #c alice,bob psst\r\n")
                        (whisper "#c" [ "alice", "bob" ] "psst")
            ]
        , describe "builders"
            [ test "DATA tags keep the strict shape" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "tag") (validateDataTag "tag")
                        , \_ -> Expect.equal (Just "a.b2") (validateDataTag "a.b2")
                        , \_ -> Expect.equal Nothing (validateDataTag "1abc")
                        , \_ -> Expect.equal Nothing (validateDataTag "toolongtagname12345")
                        , \_ -> Expect.equal Nothing (validateDataTag "hy-phen")
                        ]
                        ()
            , test "DATA REQUEST REPLY shape target tag text" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "DATA #c tag hi\r\n") (sendData "#c" "tag" "hi")
                        , \_ -> Expect.equal (Just "REQUEST #c tag hi\r\n") (sendRequest "#c" "tag" "hi")
                        , \_ -> Expect.equal (Just "REPLY #c tag hi\r\n") (sendReply "#c" "tag" "hi")
                        , \_ -> Expect.equal Nothing (sendData "#c" "1bad" "hi")
                        ]
                        ()
            , test "ACCESS builders shape subcommands" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "ACCESS #c LIST\r\n") (accessList "#c" Nothing Nothing)
                        , \_ -> Expect.equal (Just "ACCESS #c LIST HOST\r\n") (accessList "#c" (Just "host") Nothing)
                        , \_ -> Expect.equal (Just "ACCESS #c ADD HOST alice!*@*\r\n") (accessAdd "#c" "host" "alice" Nothing Nothing)
                        , \_ ->
                            Expect.equal (Just "ACCESS #c ADD HOST alice!*@* 25 spammer\r\n")
                                (accessAdd "#c" "host" "alice" (Just "25") (Just "spammer"))
                        , \_ -> Expect.equal Nothing (accessAdd "#c" "host" "alice" Nothing (Just "reason"))
                        , \_ -> Expect.equal (Just "ACCESS #c DELETE HOST alice!*@*\r\n") (accessDelete "#c" "host" "alice")
                        , \_ -> Expect.equal (Just "ACCESS #c CLEAR\r\n") (accessClear "#c" Nothing)
                        ]
                        ()
            , test "PROP builders shape entity key value" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "PROP #c\r\n") (propList "#c")
                        , \_ -> Expect.equal (Just "PROP #c ocean.display-name\r\n") (propGet "#c" [ "ocean.display-name" ])
                        , \_ -> Expect.equal (Just "PROP #c ocean.display-name Lounge\r\n") (propSet "#c" "ocean.display-name" "Lounge")
                        , \_ -> Expect.equal Nothing (propSet "#c" "__proto__" "x")
                        ]
                        ()
            , test "800 captures state with raw params" <|
                \_ ->
                    Expect.equal { state = Just "ON", raw = [ "me", "ON", "1.0" ] }
                        (parseIrcx800 [ "me", "ON", "1.0" ])
            , test "LISTX takes an optional filter" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "LISTX\r\n") (listx Nothing)
                        , \_ -> Expect.equal (Just "LISTX *secret*\r\n") (listx (Just "*secret*"))
                        ]
                        ()
            ]
        ]
