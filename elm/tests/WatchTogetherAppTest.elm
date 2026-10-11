module WatchTogetherAppTest exposing (suite)

{-| v3/gap-watch — Watch Together through the real `App.update` and
`View.view`: the outbound `PROP` lines, the server's answers folded in
`settleStepWatch`, the card and the start sheet that render from them,
and the preference toggle.
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Isupport
import Prefs
import PrefsPanel
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View
import WatchTogether as WT


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


stepOut : Msg -> Model -> ( Model, List Outbound )
stepOut =
    update


wt : WT.Msg -> Msg
wt =
    WatchMsg


{-| Live, IRCX, `me` an operator in `#c` with `alice` beside, the
preference on. -}
room : Model
room =
    let
        base =
            { blank
                | ourNick = "me"
                , connection = Live
                , isupport = (\s -> { s | ircx = True }) Isupport.defaultSupport
                , prefs = (\p -> { p | watchTogether = True }) blank.prefs
                , nowMs = 1700000000000
            }
    in
    base
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":alice!u@h JOIN #c")
        |> (\m -> feed m ":s 353 me = #c :@me +alice")
        |> step (ChannelSelect "#c")


viewer : Model
viewer =
    let
        base =
            { blank
                | ourNick = "me"
                , connection = Live
                , isupport = (\s -> { s | ircx = True }) Isupport.defaultSupport
                , prefs = (\p -> { p | watchTogether = True }) blank.prefs
                , nowMs = 1700000000000
            }
    in
    base
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":s 353 me = #c :@alice me")
        |> step (ChannelSelect "#c")


value : String
value =
    "title=Movie+night&url=https%3A%2F%2Fexample.test%2Fv&host=alice&state=paused&position=90&duration=300&participants=alice"


withValue : Model -> Model
withValue model =
    feed model (":alice!u@h PROP #c ocean.watch :" ++ value)


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


sentLines : List Outbound -> List String
sentLines outs =
    List.filterMap
        (\o ->
            case o of
                SendLine l ->
                    Just l

                _ ->
                    Nothing
        )
        outs


propLines : List Outbound -> List String
propLines =
    sentLines >> List.filter (String.startsWith "PROP #c ocean.watch")


{-| The start editor, filled in and sent for review. -}
reviewing : Model
reviewing =
    room
        |> step (wt (WT.MenuSelect "#c"))
        |> step (wt (WT.EditTitle "Movie night"))
        |> step (wt (WT.EditUrl "https://example.test/v"))
        |> step (wt (WT.EditDuration "5:00"))
        |> step (wt WT.EditorReview)


{-| A value of exactly 512 bytes: the server's cap, so one more name
cannot be published. -}
tightValue : String
tightValue =
    let
        nicks =
            List.map (\i -> String.fromInt i ++ String.repeat 58 "n") (List.range 1 6)

        build k =
            WT.serialize
                { title = String.repeat k "x"
                , url = Nothing
                , host = Just "alice"
                , state = WT.Paused
                , position = Just 0
                , duration = Nothing
                , at = Nothing
                , participants = "alice" :: nicks
                , handoffTo = Nothing
                }
    in
    build (clamp 1 160 (512 - String.length (build 1) + 1))


suite : Test
suite =
    describe "v3/gap-watch App integration"
        [ describe "the preference"
            [ test "the tight value really is 512 bytes" <|
                \_ ->
                    Expect.equal 512 (String.length tightValue)
            , test "it ships off, and the toggle writes it through the shared preference path" <|
                \_ ->
                    Expect.equal ( False, True, False )
                        ( blank.prefs.watchTogether
                        , (step (AppearanceSetPref { key = "watchTogether", value = "true" }) blank).prefs.watchTogether
                        , (step (AppearanceSetPref { key = "watchTogether", value = "false" }) room).prefs.watchTogether
                        )
            , test "it survives the preference codec" <|
                \_ ->
                    Prefs.updatePreference Prefs.defaultPreferences "watchTogether" "true"
                        |> .watchTogether
                        |> Expect.equal True
            , test "the Preferences panel shows a real switch for it, and pressing it flips the flag" <|
                \_ ->
                    let
                        open =
                            room |> step PrefsOpen |> step (PrefsSelectCategory PrefsPanel.Conversation)
                    in
                    Expect.all
                        [ \m ->
                            query m
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "pref-toggle-watchTogether") ]
                                |> Expect.all
                                    [ Query.has [ Selector.attribute (Attr.attribute "role" "switch") ]
                                    , Query.has [ Selector.attribute (Attr.attribute "aria-checked" "true") ]
                                    , Query.has [ Selector.text "never streams or controls the video" ]
                                    ]
                        , \m -> Expect.equal False (step (PrefsTogglePref "watchTogether") m).prefs.watchTogether
                        ]
                        open
            ]
        , describe "the card"
            [ test "an activity another operator published shows the card with its title, host site and clock" <|
                \_ ->
                    query (withValue room)
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "watch-card") ]
                        |> Expect.all
                            [ Query.has [ Selector.text "Movie night" ]
                            , Query.has [ Selector.text "example.test" ]
                            , Query.has [ Selector.text "1:30 / 5:00" ]
                            , Query.has [ Selector.text "Paused" ]
                            ]
            , test "nothing renders while the preference is off" <|
                \_ ->
                    let
                        off =
                            withValue { room | prefs = (\p -> { p | watchTogether = False }) room.prefs }
                    in
                    query off
                        |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "watch-card") ]
                        |> Query.count (Expect.equal 0)
            , test "nothing renders for a room without an activity" <|
                \_ ->
                    query room
                        |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "watch-card") ]
                        |> Query.count (Expect.equal 0)
            , test "an unreadable value renders nothing rather than a broken card" <|
                \_ ->
                    query (feed room ":alice!u@h PROP #c ocean.watch :state=playing")
                        |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "watch-card") ]
                        |> Query.count (Expect.equal 0)
            , test "the card's Open link is a safe http(s) link that names its host" <|
                \_ ->
                    query (withValue room)
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "watch-open") ]
                        |> Expect.all
                            [ Query.has [ Selector.attribute (Attr.href "https://example.test/v") ]
                            , Query.has [ Selector.attribute (Attr.target "_blank") ]
                            , Query.has [ Selector.attribute (Attr.rel "noopener noreferrer") ]
                            , Query.has [ Selector.attribute (Attr.attribute "aria-label" "Open example.test in a new tab") ]
                            ]
            , test "a javascript: link published by a hostile client never becomes an href" <|
                \_ ->
                    query (feed room ":alice!u@h PROP #c ocean.watch :title=Hi&url=javascript%3Aalert(1)&host=alice&participants=alice")
                        |> Query.findAll [ Selector.tag "a", Selector.attribute (Attr.attribute "data-testid" "watch-open") ]
                        |> Query.count (Expect.equal 0)
            , test "the activity going away removes the card" <|
                \_ ->
                    query (feed (withValue room) ":alice!u@h PROP #c ocean.watch :")
                        |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "watch-card") ]
                        |> Query.count (Expect.equal 0)
            , test "Hide turns the preference off and drops the card" <|
                \_ ->
                    let
                        hidden =
                            step (wt WT.Hide) (withValue room)
                    in
                    Expect.all
                        [ \m -> Expect.equal False m.prefs.watchTogether
                        , \m ->
                            query m
                                |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "watch-card") ]
                                |> Query.count (Expect.equal 0)
                        ]
                        hidden
            , test "the details disclosure shows the host, the roster and the plain-words note" <|
                \_ ->
                    withValue room
                        |> step (wt WT.ToggleExpanded)
                        |> step (wt WT.ToggleRoster)
                        |> query
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "watch-details") ]
                        |> Expect.all
                            [ Query.has [ Selector.text "Hosted by " ]
                            , Query.has [ Selector.text "alice" ]
                            , Query.has [ Selector.text "Hide 1 participant" ]
                            , Query.has [ Selector.text "It doesn't stream, embed or control the video" ]
                            ]
            , test "an operator who is not the host can join; a host sees no Join" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            withValue room
                                |> step (wt WT.ToggleExpanded)
                                |> query
                                |> Query.has [ Selector.attribute (Attr.attribute "data-testid" "watch-join-button") ]
                        , \_ ->
                            let
                                mine =
                                    feed room (":me!u@h PROP #c ocean.watch :" ++ String.replace "host=alice" "host=me" (String.replace "participants=alice" "participants=me" value))
                            in
                            mine
                                |> step (wt WT.ToggleExpanded)
                                |> query
                                |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "watch-join-button") ]
                                |> Query.count (Expect.equal 0)
                        ]
                        ()
            , test "someone without operator rights sees no join button, only why" <|
                \_ ->
                    let
                        watcher =
                            viewer |> (\m -> feed m (":alice!u@h PROP #c ocean.watch :" ++ value)) |> step (wt WT.ToggleExpanded)
                    in
                    Expect.all
                        [ \m ->
                            query m
                                |> Query.has [ Selector.text "Only room operators can join or control this activity on Onyx Server" ]
                        , \m ->
                            query m
                                |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "watch-join-button") ]
                                |> Query.count (Expect.equal 0)
                        ]
                        watcher
            ]
        , describe "starting"
            [ test "the room's More menu offers it to operators" <|
                \_ ->
                    room
                        |> step RoomMenuToggle
                        |> query
                        |> Query.has [ Selector.attribute (Attr.attribute "data-testid" "room-watch-together") ]
            , test "choosing it opens the start sheet with the room named" <|
                \_ ->
                    room
                        |> step (wt (WT.MenuSelect "#c"))
                        |> query
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "watch-start") ]
                        |> Query.has [ Selector.text "#c" ]
            , test "a non-operator is told, with a toast, and gets no sheet" <|
                \_ ->
                    let
                        refused =
                            step (wt (WT.MenuSelect "#c")) viewer
                    in
                    Expect.equal ( True, 1 )
                        ( refused.watch.editor == Nothing
                        , List.length refused.toasts
                        )
            , test "the sheet is on the overlay stack so Escape closes it" <|
                \_ ->
                    overlayStack (step (wt (WT.MenuSelect "#c")) room)
                        |> List.filter (\( name, _ ) -> name == "watch-start")
                        |> List.map Tuple.second
                        |> Expect.equal [ wt WT.EditorClose ]
            , test "review publishes nothing" <|
                \_ ->
                    Expect.equal ( True, [] )
                        ( case reviewing.watch.editor |> Maybe.map .step of
                            Just (WT.Reviewing _) ->
                                True

                            _ ->
                                False
                        , propLines (Tuple.second (stepOut (wt WT.EditorReview) reviewing))
                        )
            , test "confirming sends one PROP with the reviewed value, exactly as the wire carries it" <|
                \_ ->
                    stepOut (wt WT.EditorConfirm) reviewing
                        |> Tuple.second
                        |> propLines
                        |> Expect.equal
                            [ "PROP #c ocean.watch title=Movie+night&url=https%3A%2F%2Fexample.test%2Fv&host=me&state=paused&position=0&duration=300&participants=me\r\n" ]
            , test "the server's 818 confirms it: the card appears, the sheet is gone, a toast says so" <|
                \_ ->
                    let
                        sent =
                            step (wt WT.EditorConfirm) reviewing

                        confirmed =
                            feed sent ":s 818 me #c ocean.watch :title=Movie+night&url=https%3A%2F%2Fexample.test%2Fv&host=me&state=paused&position=0&duration=300&participants=me"
                    in
                    Expect.all
                        [ \m -> Expect.equal Nothing m.watch.pending
                        , \m -> Expect.equal True (List.any (\t -> t.title == "Watch together") m.toasts)
                        , \m ->
                            query m
                                |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "watch-card") ]
                                |> Query.count (Expect.equal 1)
                        , \m -> Expect.equal Nothing m.watch.editor
                        ]
                        confirmed
            , test "a 913 refusal is explained, never silent" <|
                \_ ->
                    let
                        refused =
                            feed (step (wt WT.EditorConfirm) reviewing) ":s 913 me #c :Insufficient access to set property"
                    in
                    Expect.equal ( Nothing, True )
                        ( refused.watch.pending
                        , List.any (\t -> t.title == "Watch activity not started") refused.toasts
                        )
            , test "starting while offline is refused before any line is sent" <|
                \_ ->
                    let
                        offline =
                            { reviewing | connection = Offline }
                    in
                    Expect.equal [] (propLines (Tuple.second (stepOut (wt WT.EditorConfirm) offline)))
            ]
        , describe "handoff, participation and ending on the card"
            [ test "the person offered hosting sees who offered and an Accept button" <|
                \_ ->
                    feed room ":alice!u@h PROP #c ocean.watch :title=Night&host=alice&state=handoff&position=90&participants=alice%2Cme&handoff=me"
                        |> step (wt WT.ToggleExpanded)
                        |> query
                        |> Expect.all
                            [ Query.has [ Selector.text "alice offered you hosting." ]
                            , Query.has [ Selector.attribute (Attr.attribute "data-testid" "watch-accept") ]
                            , Query.has [ Selector.text "Handing over to me" ]
                            ]
            , test "the host with an offer out sees who is pending and can cancel, not play" <|
                \_ ->
                    feed room ":me!u@h PROP #c ocean.watch :title=Night&host=me&state=handoff&position=90&participants=me%2Calice&handoff=alice"
                        |> step (wt WT.ToggleExpanded)
                        |> query
                        |> Expect.all
                            [ Query.has [ Selector.text "Waiting for alice to accept hosting. Playback is paused." ]
                            , Query.has [ Selector.attribute (Attr.attribute "data-testid" "watch-cancel-handoff") ]
                            , \q -> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "watch-play") ] q |> Query.count (Expect.equal 0)
                            ]
            , test "a participant who is not the host can leave" <|
                \_ ->
                    feed room ":alice!u@h PROP #c ocean.watch :title=Night&host=alice&state=paused&participants=alice%2Cme"
                        |> step (wt WT.ToggleExpanded)
                        |> query
                        |> Query.has [ Selector.attribute (Attr.attribute "data-testid" "watch-leave-button") ]
            , test "the host is told to hand hosting over instead of leaving" <|
                \_ ->
                    feed room ":me!u@h PROP #c ocean.watch :title=Night&host=me&state=paused&participants=me"
                        |> step (wt WT.ToggleExpanded)
                        |> query
                        |> Expect.all
                            [ Query.has [ Selector.text "Hand hosting to someone else before you leave." ]
                            , \q -> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "watch-leave-button") ] q |> Query.count (Expect.equal 0)
                            ]
            , test "when the 512 byte value has no room for another name Join is shown as full" <|
                \_ ->
                    feed room (":alice!u@h PROP #c ocean.watch :" ++ tightValue)
                        |> step (wt WT.ToggleExpanded)
                        |> query
                        |> Expect.all
                            [ Query.has [ Selector.text "Activity full" ]
                            , Query.has [ Selector.text "This activity has no room for another name." ]
                            ]
            , test "End activity asks first; the question names the activity and how many it ends for" <|
                \_ ->
                    let
                        mine =
                            feed room ":me!u@h PROP #c ocean.watch :title=Night&host=me&state=paused&participants=me%2Calice"

                        raw =
                            Dict.get "#c" mine.props.channelProps |> Maybe.andThen (Dict.get "ocean.watch") |> Maybe.withDefault ""
                    in
                    mine
                        |> step (wt WT.ToggleExpanded)
                        |> step (wt (WT.AskEnd { channel = "#c", raw = raw, self = "me" }))
                        |> query
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "watch-end-confirmation") ]
                        |> Expect.all
                            [ Query.has [ Selector.text "End \u{201C}Night\u{201D}?" ]
                            , Query.has [ Selector.text "2 participants" ]
                            , Query.has [ Selector.text "End for everyone" ]
                            , Query.has [ Selector.text "Keep it running" ]
                            ]
            , test "Play on the card sends the published value, once" <|
                \_ ->
                    let
                        mine =
                            feed room ":me!u@h PROP #c ocean.watch :title=Night&host=me&state=paused&participants=me"
                    in
                    query mine
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "watch-play") ]
                        |> Event.simulate Event.click
                        |> Event.expect
                            (wt
                                (WT.Play
                                    { channel = "#c"
                                    , raw = "title=Night&host=me&state=paused&participants=me"
                                    , self = "me"
                                    }
                                )
                            )
            ]
        , describe "running it"
            [ test "the host plays: PROP carries state=playing with an at anchor" <|
                \_ ->
                    let
                        mine =
                            feed room (":me!u@h PROP #c ocean.watch :" ++ String.replace "host=alice" "host=me" (String.replace "participants=alice" "participants=me" value))

                        raw =
                            Dict.get "#c" mine.props.channelProps
                                |> Maybe.andThen (Dict.get "ocean.watch")
                                |> Maybe.withDefault ""
                    in
                    stepOut (wt (WT.Play { channel = "#c", raw = raw, self = "me" })) mine
                        |> Tuple.second
                        |> propLines
                        |> List.map (\l -> String.contains "state=playing" l && String.contains "at=1700000000000" l)
                        |> Expect.equal [ True ]
            , test "ending sends an empty trailing value and the 819 removes the card" <|
                \_ ->
                    let
                        mine =
                            feed room (":me!u@h PROP #c ocean.watch :" ++ String.replace "host=alice" "host=me" (String.replace "participants=alice" "participants=me" value))

                        raw =
                            Dict.get "#c" mine.props.channelProps
                                |> Maybe.andThen (Dict.get "ocean.watch")
                                |> Maybe.withDefault ""

                        r =
                            { channel = "#c", raw = raw, self = "me" }

                        asked =
                            step (wt (WT.AskEnd r)) mine

                        ( ending, outs ) =
                            stepOut (wt (WT.ConfirmEnd r)) asked

                        ended =
                            feed ending ":s 819 me #c :End of properties"
                    in
                    Expect.equal ( [ "PROP #c ocean.watch :\r\n" ], True, Nothing )
                        ( propLines outs
                        , Dict.get "#c" ended.props.channelProps |> Maybe.andThen (Dict.get "ocean.watch") |> (==) Nothing
                        , ended.watch.pending
                        )
            , test "switching rooms drops the open details and any draft" <|
                \_ ->
                    let
                        open =
                            withValue room |> step (wt WT.ToggleExpanded) |> step (wt WT.ToggleRoster)

                        moved =
                            open
                                |> (\m -> feed m ":me!u@h JOIN #d")
                                |> (\m -> feed m ":s 353 me = #d :@me")
                                |> step (ChannelSelect "#d")
                    in
                    Expect.equal ( False, False ) ( moved.watch.expanded, moved.watch.rosterOpen )
            , test "the shared clock is anchored once, when the value is first seen" <|
                \_ ->
                    let
                        seen =
                            withValue room
                    in
                    Expect.equal [ "#c" ] (Dict.keys seen.watch.anchors)
            ]
        ]
