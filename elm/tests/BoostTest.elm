module BoostTest exposing (suite)

{-| Vectors for slice `boost` (roadmap 2.5 + 2.6), mirroring
`src/shell/JumpToDateSheet.test.tsx` and the `BoostBar` `onAdd` arm:

- pure UTC date/time helpers resolve the same moments as the oracle
  (and reject the same bad calendar days/times);
- the sheet folds seed/open/close/preset/submit through the existing
  `requestTravelTo` machinery;
- the boost bar offers "Add a boost" (opening the existing reaction
  picker) and the topbar offers the jump sheet.
-}

import App exposing (..)
import Boost
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Prefs
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


fixedNow : Float
fixedNow =
    1784484000000


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


testRow : App.ChatMessage
testRow =
    { id = 1
    , from = "alice"
    , body = "hello world"
    , whisper = False
    , audience = Nothing
    , highlight = False
    , outboxId = Nothing
    , pending = False
    , plaintext = Nothing
    , at = 1783611000000
    , msgid = Just "m1"
    , reactions = []
    , edited = False
    , deleted = False
    , redacted = False
    , topic = ""
    , msgType = "msg"
    , replyTo = Nothing
    }


testChannel : App.Channel
testChannel =
    { name = "#c"
    , topic = ""
    , members = Dict.singleton "alice" { nick = "alice", modes = Set.empty, away = False }
    , modes = ""
    , messages = [ testRow ]
    , lastSeen = Nothing
    , unread = 0
    , highlights = 0
    , createdAt = Nothing
    }


threadModel : Model
threadModel =
    { blank
        | activeChannel = Just "#c"
        , channels = Dict.singleton "#c" testChannel
    }


jumpModel : Model
jumpModel =
    { blank
        | nowMs = fixedNow
        , activeChannel = Just "#c"
        , channels = Dict.singleton "#c" testChannel
        , caps = [ "chathistory" ]
        , showJumpToDate = True
        , jumpDate = "2026-06-30"
        , jumpTime = "09:15"
    }


suite : Test
suite =
    describe "Boost"
        [ describe "jump-date helpers"
            [ test "formats and resolves UTC date/time strings" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "2026-07-09" (Boost.formatUtcDate 1783611000000)
                        , \_ -> Expect.equal "15:30" (Boost.formatUtcTime 1783611000000)
                        , \_ -> Expect.equal (Just 1783611000000) (Boost.dateTimeAtUtc "2026-07-09" "15:30")
                        , \_ -> Expect.equal (Just 1783598400000) (Boost.dateTimeAtUtc "2026-07-09" "12:00")
                        ]
                        ()
            , test "blanks time defaults to noon UTC" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just 1783598400000) (Boost.dateTimeAtUtc "2026-07-09" "")
                        , \_ -> Expect.equal (Just 1783598400000) (Boost.dateTimeAtUtc "2026-07-09" "   ")
                        ]
                        ()
            , test "rejects invalid calendar days and bad times" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (Boost.dateTimeAtUtc "2026-02-31" "12:00")
                        , \_ -> Expect.equal Nothing (Boost.dateTimeAtUtc "not-a-date" "12:00")
                        , \_ -> Expect.equal Nothing (Boost.dateTimeAtUtc "2026-07-09" "25:00")
                        , \_ -> Expect.equal Nothing (Boost.dateTimeAtUtc "2026-07-09" "nope")
                        , \_ -> Expect.equal Nothing (Boost.dateTimeAtUtc "2026-07-09" "9:15")
                        , \_ -> Expect.equal Nothing (Boost.dateTimeAtUtc "2026-13-01" "12:00")
                        ]
                        ()
            , test "computes UTC preset days from a fixed now" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "2026-07-19" (Boost.utcDateDaysAgo 0 fixedNow)
                        , \_ -> Expect.equal "2026-07-18" (Boost.utcDateDaysAgo 1 fixedNow)
                        , \_ -> Expect.equal "2026-07-12" (Boost.utcDateDaysAgo 7 fixedNow)
                        , \_ -> Expect.equal "2026-07-19" (Boost.utcDateDaysAgo -3 fixedNow)
                        ]
                        ()
            ]
        , describe "jump-to-date folds"
            [ test "opening seeds today at noon UTC" <|
                \_ ->
                    let
                        ( opened, out ) =
                            update JumpToDateOpen { blank | nowMs = fixedNow }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True opened.showJumpToDate
                        , \_ -> Expect.equal "2026-07-19" opened.jumpDate
                        , \_ -> Expect.equal "12:00" opened.jumpTime
                        , \_ -> Expect.equal Nothing opened.jumpError
                        , \_ -> Expect.equal [] out
                        ]
                        ()
            , test "presets fill the date field at noon" <|
                \_ ->
                    let
                        ( opened, _ ) =
                            update JumpToDateOpen { blank | nowMs = fixedNow }

                        ( preset, _ ) =
                            update (JumpToDatePreset 1) opened
                    in
                    Expect.all
                        [ \_ -> Expect.equal "2026-07-18" preset.jumpDate
                        , \_ -> Expect.equal "12:00" preset.jumpTime
                        ]
                        ()
            , test "submit travels and closes the sheet" <|
                \_ ->
                    let
                        ( traveled, out ) =
                            update JumpToDateSubmit jumpModel

                        travels =
                            List.filterMap
                                (\o ->
                                    case o of
                                        SendLine line ->
                                            Just line

                                        _ ->
                                            Nothing
                                )
                                out
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just { target = "#c", at = 1782810900000 }) traveled.pendingTravel
                        , \_ -> Expect.equal False traveled.showJumpToDate
                        , \_ -> Expect.equal Nothing traveled.jumpError
                        , \_ ->
                            Expect.equal True
                                (List.member
                                    (VaultFetchAround { target = "#c", at = round 1782810900000, limit = 400 })
                                    out
                                )
                        , \_ ->
                            Expect.equal True
                                (List.any (String.startsWith "CHATHISTORY AROUND #c timestamp=") travels)
                        ]
                        ()
            , test "submit with invalid input keeps the sheet with an error" <|
                \_ ->
                    let
                        ( held, out ) =
                            update JumpToDateSubmit { jumpModel | jumpDate = "2026-02-31" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "Enter a valid UTC date and time.") held.jumpError
                        , \_ -> Expect.equal [] out
                        , \_ -> Expect.equal True held.showJumpToDate
                        , \_ -> Expect.equal Nothing held.pendingTravel
                        ]
                        ()
            , test "submit with no conversation reports the empty state" <|
                \_ ->
                    let
                        ( held, out ) =
                            update JumpToDateSubmit { jumpModel | activeChannel = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "Open a room or DM first.") held.jumpError
                        , \_ -> Expect.equal [] out
                        ]
                        ()
            , test "closing hides the sheet and clears the error" <|
                \_ ->
                    let
                        ( closed, _ ) =
                            update JumpToDateClose { jumpModel | jumpError = Just "Enter a valid UTC date and time." }
                    in
                    Expect.all
                        [ \_ -> Expect.equal False closed.showJumpToDate
                        , \_ -> Expect.equal Nothing closed.jumpError
                        ]
                        ()
            , test "copy moment shares the moment clipboard tag" <|
                \_ ->
                    let
                        ( _, out ) =
                            update JumpToDateCopyMoment { jumpModel | origin = "https://example.test/app/" }
                    in
                    case out of
                        [ ClipboardCopy copied ] ->
                            Expect.all
                                [ \_ -> Expect.equal "moment" copied.tag
                                , \_ -> Expect.equal True (String.contains "join=%23c" copied.text)
                                ]
                                ()

                        _ ->
                            Expect.fail ("expected one clipboard copy, got " ++ String.fromInt (List.length out))
            ]
        , describe "boost bar add arm"
            [ test "a row with a msgid offers Add a boost into the picker" <|
                \_ ->
                    query threadModel
                        |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Add a boost") ]
                        |> Event.simulate Event.click
                        |> Event.expect (ReactionPickerOpen { target = "#c", msgid = "m1" })
            , test "a row without a msgid offers no picker" <|
                \_ ->
                    let
                        unkeyed =
                            { testChannel | messages = [ { testRow | msgid = Nothing } ] }
                    in
                    query { threadModel | channels = Dict.singleton "#c" unkeyed }
                        |> Query.findAll [ Selector.attribute (Attr.attribute "aria-label" "Add a boost") ]
                        |> Query.count (Expect.equal 0)
            , test "counts-only density hides the add arm" <|
                \_ ->
                    let
                        prefs =
                            threadModel.prefs

                        compacted =
                            { threadModel | prefs = { prefs | reactionDensity = Prefs.ReactionCountsOnly } }
                    in
                    query compacted
                        |> Query.findAll [ Selector.attribute (Attr.attribute "aria-label" "Add a boost") ]
                        |> Query.count (Expect.equal 0)
            ]
        , describe "jump-to-date sheet view"
            [ test "labels the sheet with date, time, presets, and actions" <|
                \_ ->
                    let
                        q =
                            query jumpModel
                    in
                    Expect.all
                        [ \_ -> q |> Query.has [ Selector.text "Jump to date" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "jump-to-date-sheet") ]
                                |> Query.has [ Selector.text "Choose a date and time to view messages in #c. Times are entered in UTC." ]
                        , \_ ->
                            q
                                |> Query.findAll [ Selector.class "jump-to-date__preset" ]
                                |> Query.count (Expect.equal 3)
                        , \_ -> q |> Query.has [ Selector.text "Today", Selector.text "Yesterday", Selector.text "7 days ago" ]
                        , \_ -> q |> Query.has [ Selector.text "View messages", Selector.text "Copy moment link" ]
                        ]
                        ()
            , test "links the active room to the public room ledger" <|
                \_ ->
                    query jumpModel
                        |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Room ledger for #c") ]
                        |> Query.has [ Selector.attribute (Attr.href "/stats/?room=%23c") ]
            , test "omits the room ledger from a DM jump" <|
                \_ ->
                    let
                        q =
                            query { jumpModel | activeChannel = Just "alice" }
                    in
                    Expect.all
                        [ \_ ->
                            q
                                |> Query.findAll [ Selector.attribute (Attr.attribute "aria-label" "Room ledger for alice") ]
                                |> Query.count (Expect.equal 0)
                        , \_ -> q |> Query.has [ Selector.text "Choose a date and time to view messages in @alice. Times are entered in UTC." ]
                        ]
                        ()
            , test "shows an empty state when no conversation is active" <|
                \_ ->
                    let
                        q =
                            query { jumpModel | activeChannel = Nothing }
                    in
                    Expect.all
                        [ \_ -> q |> Query.has [ Selector.text "Open a room or direct message first, then choose when to view its messages." ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "jump-to-date-sheet") ]
                                |> Query.findAll [ Selector.tag "input" ]
                                |> Query.count (Expect.equal 0)
                        ]
                        ()
            , test "keeps invalid input actionable and recovers" <|
                \_ ->
                    let
                        held =
                            { jumpModel | jumpDate = "2026-02-31" }

                        q =
                            query held
                    in
                    Expect.all
                        [ \_ -> q |> Query.has [ Selector.text "Enter a valid UTC date and time." ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "View messages" ] ]
                                |> Query.has [ Selector.disabled True ]
                        ]
                        ()
            , test "communicates offline and loading states" <|
                \_ ->
                    let
                        offline =
                            query { jumpModel | connection = Offline }

                        loading =
                            query { jumpModel | historyLoading = Set.singleton "#c" }
                    in
                    Expect.all
                        [ \_ -> offline |> Query.has [ Selector.text "History is unavailable while you are offline. Reconnect to continue." ]
                        , \_ ->
                            offline
                                |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "View messages" ] ]
                                |> Query.has [ Selector.disabled True ]
                        , \_ -> loading |> Query.has [ Selector.text "Loading messages around this moment…" ]
                        , \_ ->
                            loading
                                |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "View messages" ] ]
                                |> Query.has [ Selector.disabled True ]
                        ]
                        ()
            , test "closes through the sheet close control" <|
                \_ ->
                    query jumpModel
                        |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Close jump to date") ]
                        |> Event.simulate Event.click
                        |> Event.expect JumpToDateClose
            ]
        , describe "topbar jump entry"
            [ test "opens the sheet from the room header's More menu" <|
                \_ ->
                    -- v3/frame: the entry moved into the room header overflow.
                    query { threadModel | roomMenuOpen = True }
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "topbar-jump-to-date") ]
                        |> Event.simulate Event.click
                        |> Event.expect JumpToDateOpen
            , test "offers no entry with no conversation" <|
                \_ ->
                    -- v3/frame: no room, no room header — the entry is absent.
                    query { blank | roomMenuOpen = True }
                        |> Query.hasNot [ Selector.attribute (Attr.attribute "data-testid" "topbar-jump-to-date") ]
            ]
        ]
