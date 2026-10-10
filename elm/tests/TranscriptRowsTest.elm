module TranscriptRowsTest exposing (suite)

{-| v3/transcript — row view-model, density, jump pill, the scroll
bridge fold, the density preference, and the rendered transcript
(keyed `role=log`, lazy rows keep every selector).
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes
import Prefs
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import TranscriptRows
import View
import View.Appearance


type alias Row =
    { id : Int, msgid : Maybe String, from : String, at : Int, msgType : String }


row : Int -> Maybe String -> String -> Int -> String -> Row
row id msgid from at msgType =
    { id = id, msgid = msgid, from = from, at = at, msgType = msgType }


env : Prefs.TranscriptDensity -> TranscriptRows.RowEnv Row
env density =
    { selfNick = "me"
    , density = density
    , searchCurrentId = Nothing
    , unreadDividerId = Nothing
    , threadParents = Set.empty
    , uncertain = \_ -> False
    , menuButton = \r -> r.msgid /= Nothing
    }


minute : Int
minute =
    60 * 1000


sample : List Row
sample =
    [ row 1 (Just "a1") "alice" 0 "privmsg"
    , row 2 (Just "a2") "alice" minute "privmsg"
    , row 3 Nothing "alice" (2 * minute) "privmsg"
    , row 4 (Just "b1") "bob" (3 * minute) "privmsg"
    , row 5 Nothing "bob" (4 * minute) "join"
    , row 6 (Just "b2") "bob" (5 * minute) "privmsg"
    , row 7 (Just "b3") "bob" (11 * minute) "privmsg"
    , row 8 (Just "m1") "me" (12 * minute) "privmsg"
    ]


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


room : Model
room =
    { blank | nowMs = 1000000 }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":alice!u@h JOIN #c")
        |> (\m -> feed m ":alice!u@h PRIVMSG #c :one")
        |> (\m -> feed m ":alice!u@h PRIVMSG #c :two")
        |> (\m -> Tuple.first (update (ChannelSelect "#c") m))


emptyRoom : Model
emptyRoom =
    blank
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> Tuple.first (update (ChannelSelect "#c") m))


withDensity : Prefs.TranscriptDensity -> Model -> Model
withDensity density model =
    let
        prefs =
            model.prefs
    in
    { model | prefs = { prefs | transcriptDensity = density } }


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


latestAt : Model -> Int
latestAt model =
    Dict.get "#c" model.channels
        |> Maybe.andThen (.messages >> List.head)
        |> Maybe.map .at
        |> Maybe.withDefault 0


suite : Test
suite =
    describe "TranscriptRows"
        [ describe "rowKey"
            [ test "server msgid wins" <|
                \_ -> Expect.equal "m:abc" (TranscriptRows.rowKey (row 9 (Just "abc") "a" 0 "privmsg"))
            , test "no msgid falls back to the local row id" <|
                \_ -> Expect.equal "r:9" (TranscriptRows.rowKey (row 9 Nothing "a" 0 "privmsg"))
            , test "a blank msgid also falls back" <|
                \_ -> Expect.equal "r:9" (TranscriptRows.rowKey (row 9 (Just "  ") "a" 0 "privmsg"))
            ]
        , describe "rowViews (Default)"
            [ test "keys follow the rows" <|
                \_ ->
                    TranscriptRows.rowViews (env Prefs.TranscriptDefault) [] sample
                        |> List.map .key
                        |> Expect.equal [ "m:a1", "m:a2", "r:3", "m:b1", "r:5", "m:b2", "m:b3", "m:m1" ]
            , test "grouping mirrors sameAuthorGroup (author, system rows, five minutes)" <|
                \_ ->
                    TranscriptRows.rowViews (env Prefs.TranscriptDefault) [] sample
                        |> List.map (.flags >> .continuation)
                        |> Expect.equal [ False, True, True, False, False, False, False, False ]
            , test "system and self flags" <|
                \_ ->
                    let
                        views =
                            TranscriptRows.rowViews (env Prefs.TranscriptDefault) [] sample
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ False, False, False, False, True, False, False, False ] (List.map .system views)
                        , \_ -> Expect.equal [ False, False, False, False, False, False, False, True ] (List.map (.flags >> .self) views)
                        , \_ -> Expect.equal [ True, True, False, True, False, True, True, True ] (List.map (.flags >> .menuButton) views)
                        ]
                        ()
            , test "duplicate msgids get a unique key" <|
                \_ ->
                    TranscriptRows.rowViews (env Prefs.TranscriptDefault) [] [ row 1 (Just "x") "a" 0 "privmsg", row 2 (Just "x") "a" 0 "privmsg" ]
                        |> List.map .key
                        |> Expect.equal [ "m:x", "m:x#2" ]
            , test "day labels pair 1:1, missing labels read as none" <|
                \_ ->
                    TranscriptRows.rowViews (env Prefs.TranscriptDefault) [ Just "Today", Nothing ] (List.take 3 sample)
                        |> List.map .dayLabel
                        |> Expect.equal [ Just "Today", Nothing, Nothing ]
            , test "unread divider, search-current, thread, and uncertainty flags" <|
                \_ ->
                    let
                        e =
                            env Prefs.TranscriptDefault

                        views =
                            TranscriptRows.rowViews
                                { e
                                    | unreadDividerId = Just 4
                                    , searchCurrentId = Just 2
                                    , threadParents = Set.fromList [ 1 ]
                                    , uncertain = \r -> r.id == 8
                                }
                                []
                                sample
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ 4 ] (List.filterMap identity (List.map2 (\v r -> if v.unreadAbove then Just r.id else Nothing) views sample))
                        , \_ -> Expect.equal [ 2 ] (List.filterMap identity (List.map2 (\v r -> if v.flags.searchCurrent then Just r.id else Nothing) views sample))
                        , \_ -> Expect.equal [ 1 ] (List.filterMap identity (List.map2 (\v r -> if v.flags.hasThread then Just r.id else Nothing) views sample))
                        , \_ -> Expect.equal [ 8 ] (List.filterMap identity (List.map2 (\v r -> if v.flags.uncertain then Just r.id else Nothing) views sample))
                        ]
                        ()
            ]
        , describe "rowViews (Compact)"
            [ test "compact never groups and marks every row compact" <|
                \_ ->
                    let
                        views =
                            TranscriptRows.rowViews (env Prefs.TranscriptCompact) [] sample
                    in
                    Expect.all
                        [ \_ -> Expect.equal False (List.any (.flags >> .continuation) views)
                        , \_ -> Expect.equal True (List.all (.flags >> .compact) views)
                        ]
                        ()
            ]
        , describe "flag packing"
            [ test "all 128 flag combinations round-trip" <|
                \_ ->
                    List.range 0 127
                        |> List.map (\n -> TranscriptRows.flagsToBits (TranscriptRows.flagsFromBits n))
                        |> Expect.equal (List.range 0 127)
            , test "continuation is bit 0, menuButton bit 6" <|
                \_ ->
                    let
                        f =
                            TranscriptRows.flagsFromBits 0
                    in
                    Expect.equal ( 1, 64 )
                        ( TranscriptRows.flagsToBits { f | continuation = True }
                        , TranscriptRows.flagsToBits { f | menuButton = True }
                        )
            ]
        , describe "needsRichRow"
            [ test "plain text stays lazy" <|
                \_ -> Expect.equal False (TranscriptRows.needsRichRow { body = "hello there", menuOpen = False })
            , test "links, file receipts, and open menus render eagerly" <|
                \_ ->
                    Expect.equal [ True, True, True, True ]
                        [ TranscriptRows.needsRichRow { body = "see https://x.test", menuOpen = False }
                        , TranscriptRows.needsRichRow { body = "HTTP://X.TEST", menuOpen = False }
                        , TranscriptRows.needsRichRow { body = "[file] a.png", menuOpen = False }
                        , TranscriptRows.needsRichRow { body = "hi", menuOpen = True }
                        ]
            ]
        , describe "jump to latest"
            [ test "leaving the bottom records the baseline once" <|
                \_ ->
                    let
                        away =
                            TranscriptRows.awayAfterReport { key = "#c", atBottom = False } 100 Nothing
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just { key = "#c", seenAt = 100 }) away
                        , \_ -> Expect.equal away (TranscriptRows.awayAfterReport { key = "#c", atBottom = False } 500 away)
                        , \_ -> Expect.equal (Just { key = "#d", seenAt = 500 }) (TranscriptRows.awayAfterReport { key = "#d", atBottom = False } 500 away)
                        , \_ -> Expect.equal Nothing (TranscriptRows.awayAfterReport { key = "#c", atBottom = True } 500 away)
                        ]
                        ()
            , test "pill copy mirrors the oracle" <|
                \_ ->
                    let
                        pill times =
                            TranscriptRows.jumpPill { activeKey = "#c", hiddenAfter = 0, rowTimes = times } (Just { key = "#c", seenAt = 100 })
                                |> Maybe.map .label
                    in
                    Expect.equal
                        [ Just "Jump to latest messages"
                        , Just "1 new message below — jump to latest"
                        , Just "2 new messages below — jump to latest"
                        ]
                        [ pill [ 100, 50 ], pill [ 150, 100 ], pill [ 300, 150, 100 ] ]
            , test "no pill at the bottom, for another room, or on a historical page" <|
                \_ ->
                    Expect.equal [ Nothing, Nothing, Nothing ]
                        [ TranscriptRows.jumpPill { activeKey = "#c", hiddenAfter = 0, rowTimes = [ 1 ] } Nothing
                        , TranscriptRows.jumpPill { activeKey = "#c", hiddenAfter = 0, rowTimes = [ 1 ] } (Just { key = "#d", seenAt = 0 })
                        , TranscriptRows.jumpPill { activeKey = "#c", hiddenAfter = 3, rowTimes = [ 1 ] } (Just { key = "#c", seenAt = 0 })
                        ]
            ]
        , describe "density preference"
            [ test "defaults to Default and round-trips through onyx:preferences" <|
                \_ ->
                    let
                        prefs =
                            Prefs.defaultPreferences

                        compact =
                            { prefs | transcriptDensity = Prefs.TranscriptCompact }
                    in
                    Expect.all
                        [ \_ -> Expect.equal Prefs.TranscriptDefault prefs.transcriptDensity
                        , \_ -> Expect.equal Prefs.TranscriptCompact (Prefs.decodePreferences (Prefs.encodePreferences compact) Nothing).transcriptDensity
                        , \_ -> Expect.equal Prefs.TranscriptDefault (Prefs.decodePreferences "{\"transcriptDensity\":\"bogus\"}" Nothing).transcriptDensity
                        ]
                        ()
            , test "the Appearance setter persists the choice" <|
                \_ ->
                    let
                        ( next, out ) =
                            update (AppearanceSetPref { key = "transcriptDensity", value = "irc" }) blank
                    in
                    Expect.all
                        [ \_ -> Expect.equal Prefs.TranscriptCompact next.prefs.transcriptDensity
                        , \_ -> Expect.equal [ AppearanceStorePrefs { json = Prefs.encodePreferences next.prefs } ] (List.take 1 out)
                        ]
                        ()
            , test "arrow keys in the Message layout group move to the other value" <|
                \_ ->
                    let
                        ( next, _ ) =
                            update (AppearanceRadioKey { ids = [ "grouped", "irc" ], current = "grouped", key = "ArrowRight" }) blank
                    in
                    Expect.equal ( Prefs.TranscriptCompact, Prefs.DensityCozy ) ( next.prefs.transcriptDensity, next.prefs.density )
            ]
        , describe "scroll bridge fold"
            [ test "an away report records the room's newest row time" <|
                \_ ->
                    let
                        ( next, out ) =
                            update (TranscriptScrolled { key = "#c", atBottom = False }) room
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just { key = "#c", seenAt = latestAt room }) next.transcriptAway
                        , \_ -> Expect.equal [] out
                        ]
                        ()
            , test "jump to latest clears the away state, trails the window, and asks for the bottom" <|
                \_ ->
                    let
                        ( away, _ ) =
                            update (TranscriptScrolled { key = "#c", atBottom = False }) { room | threadPageStart = Just 0 }

                        ( next, out ) =
                            update TranscriptJumpLatest away
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing next.transcriptAway
                        , \_ -> Expect.equal Nothing next.threadPageStart
                        , \_ -> Expect.equal True next.ignoreUnreadAnchor
                        , \_ -> Expect.equal [ TranscriptScroll { action = "bottom", key = "#c" } ] out
                        ]
                        ()
            ]
        , describe "rendered transcript"
            [ test "the log region carries role, politeness, and the bridge key" <|
                \_ ->
                    query room
                        |> Query.find [ Selector.class "onyx-transcript" ]
                        |> Query.has
                            [ Selector.attribute (Html.Attributes.attribute "role" "log")
                            , Selector.attribute (Html.Attributes.attribute "aria-live" "polite")
                            , Selector.attribute (Html.Attributes.attribute "aria-relevant" "additions")
                            , Selector.attribute (Html.Attributes.attribute "aria-label" "Message history")
                            , Selector.attribute (Html.Attributes.attribute "data-transcript-key" "#c")
                            ]
            , test "the log is present before the first message" <|
                \_ ->
                    query emptyRoom
                        |> Query.findAll [ Selector.attribute (Html.Attributes.attribute "role" "log") ]
                        |> Query.count (Expect.equal 1)
            , test "no pill while pinned; the pill shows its oracle copy when away" <|
                \_ ->
                    let
                        ( away, _ ) =
                            update (TranscriptScrolled { key = "#c", atBottom = False }) room

                        arrived =
                            feed { away | nowMs = away.nowMs + 1000 } ":alice!u@h PRIVMSG #c :three"
                    in
                    Expect.all
                        [ \_ -> Query.hasNot [ Selector.class "onyx-jump-latest" ] (query room)
                        , \_ ->
                            query away
                                |> Query.find [ Selector.class "onyx-jump-latest" ]
                                |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-label" "Jump to latest messages"), Selector.text "Jump to latest" ]
                        , \_ ->
                            query arrived
                                |> Query.find [ Selector.class "onyx-jump-latest" ]
                                |> Query.has
                                    [ Selector.class "onyx-jump-latest--unread"
                                    , Selector.attribute (Html.Attributes.attribute "aria-label" "1 new message below — jump to latest")
                                    ]
                        , \_ ->
                            query away
                                |> Query.find [ Selector.class "onyx-jump-latest" ]
                                |> Event.simulate Event.click
                                |> Event.expect TranscriptJumpLatest
                        ]
                        ()
            , test "Compact drops avatars and names every line" <|
                \_ ->
                    let
                        q =
                            query (withDensity Prefs.TranscriptCompact room)
                    in
                    Expect.all
                        [ \_ -> Query.findAll [ Selector.class "onyx-row-avatar" ] q |> Query.count (Expect.equal 0)
                        , \_ -> Query.findAll [ Selector.class "onyx-continuation" ] q |> Query.count (Expect.equal 0)
                        , \_ -> Query.findAll [ Selector.class "onyx-message--compact" ] q |> Query.count (Expect.equal 2)
                        , \_ -> Query.findAll [ Selector.class "onyx-sender" ] q |> Query.count (Expect.equal 2)
                        , \_ ->
                            Query.find [ Selector.class "onyx-transcript" ] q
                                |> Query.has [ Selector.class "onyx-transcript--compact", Selector.attribute (Html.Attributes.attribute "data-density" "irc") ]
                        ]
                        ()
            , test "Appearance offers the Message layout radiogroup" <|
                \_ ->
                    let
                        group =
                            View.Appearance.view (withDensity Prefs.TranscriptCompact blank)
                                |> Query.fromHtml
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Message layout") ]
                    in
                    Expect.all
                        [ \_ ->
                            group
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-checked" "true") ]
                                |> Query.has [ Selector.text "Compact" ]
                        , \_ ->
                            group
                                |> Query.find [ Selector.containing [ Selector.text "Default" ], Selector.tag "button" ]
                                |> Event.simulate Event.click
                                |> Event.expect (AppearanceSetPref { key = "transcriptDensity", value = "grouped" })
                        ]
                        ()
            , test "Default keeps grouping with one avatar per group" <|
                \_ ->
                    let
                        q =
                            query room
                    in
                    Expect.all
                        [ \_ -> Query.findAll [ Selector.class "onyx-row-avatar" ] q |> Query.count (Expect.equal 1)
                        , \_ -> Query.findAll [ Selector.class "onyx-continuation" ] q |> Query.count (Expect.equal 1)
                        , \_ -> Query.findAll [ Selector.class "onyx-message--compact" ] q |> Query.count (Expect.equal 0)
                        ]
                        ()
            ]
        ]
